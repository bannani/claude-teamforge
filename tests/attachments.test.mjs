import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { createTeamforgeServer } from '../worker/server.mjs';
import { sniffImage } from '../worker/attachments.mjs';

const H = { 'content-type': 'application/json' };
let server; let base; let attachDir;
const runs = [];

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tf-att-'));
  attachDir = join(dir, 'attachments');
  ({ server } = createTeamforgeServer({
    dbPath: join(dir, 'att.db'), attachDir,
    provider: () => ({ provider: 'copilot', label: 'GitHub Copilot', model: null }),
    run: async (call) => { runs.push(call); call.onEvent({ type: 'message', text: 'seen' }); return { exitCode: 0, stderr: '' }; },
  }));
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// a real 2×2 PNG
function png() {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(zlib.crc32(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13); head.writeUInt32BE(2, 0); head.writeUInt32BE(2, 4); head.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = png().toString('base64');
const project = () => mkdtempSync(join(tmpdir(), 'tf-attproj-'));
async function api(method, path, body) {
  const res = await fetch(base + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const send = (p, text, images) => api('POST', '/api/chat', { project_path: p, text, images });
async function idle(p) {
  for (let i = 0; i < 200; i += 1) {
    const h = (await api('GET', `/api/chat?project=${encodeURIComponent(p)}`)).body;
    if (!h.running) return h;
    await new Promise((r) => { setTimeout(r, 10); });
  }
  throw new Error('turn never finished');
}

test('the image type comes from the bytes', () => {
  assert.equal(sniffImage(png()).type, 'image/png');
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])).type, 'image/jpeg');
  assert.equal(sniffImage(Buffer.from('GIF89a......')).type, 'image/gif');
  assert.equal(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')).type, 'image/webp');
  assert.equal(sniffImage(Buffer.from('<svg onload=alert(1)>')), null);
  assert.equal(sniffImage(Buffer.from('%PDF-1.7')), null);
});

test('an attached image is stored outside the project, handed to the agent and kept in the transcript', async () => {
  const p = project();
  assert.equal((await send(p, 'make it look like this', [{ name: 'my mockup (1).png', data: PNG }])).status, 202);
  const h = await idle(p);
  const [user] = h.messages;
  assert.equal(user.images.length, 1);
  assert.equal(user.images[0].name, 'my mockup (1).png');
  assert.match(user.images[0].file, /^\d+\/[\w-]+\.png$/);

  const call = runs.at(-1);
  const path = call.args[call.args.indexOf('--attachment') + 1];
  assert.ok(path.startsWith(attachDir), 'not written into the project');
  assert.deepEqual(readFileSync(path), png());
  assert.ok(call.args.indexOf('--attachment') < call.args.indexOf('--allow-tool'), 'before the variadic permission list');
  assert.match(call.args[1], /The client attached 1 image/);
  assert.deepEqual(readdirSync(p).filter((f) => f !== 'docs'), [], 'nothing added to the project');

  const res = await fetch(`${base}/api/attachments/${user.images[0].file}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), png());
});

test('an image alone is a valid message; the next message does not carry it again', async () => {
  const p = project();
  assert.equal((await send(p, '', [{ name: 'a.png', data: PNG }])).status, 202);
  await idle(p);
  assert.ok(runs.at(-1).args.includes('--attachment'));
  await send(p, 'and now?');
  await idle(p);
  assert.ok(!runs.at(-1).args.includes('--attachment'));
});

test('refused: not an image, too many, too large, wrong shape — and nothing is stored or started', async () => {
  const p = project();
  const started = runs.length;
  const text = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  assert.equal((await send(p, 'x', [{ name: 'evil.png', data: text }])).status, 400);
  assert.equal((await send(p, 'x', Array.from({ length: 5 }, () => ({ name: 'a.png', data: PNG })))).status, 400);
  assert.equal((await send(p, 'x', 'not a list')).status, 400);
  assert.equal((await send(p, 'x', [{ name: 'a.png' }])).status, 400);
  const big = Buffer.concat([png(), Buffer.alloc(5 * 1024 * 1024)]).toString('base64');
  assert.equal((await send(p, 'x', [{ name: 'big.png', data: big }])).status, 413);
  assert.equal(runs.length, started);
  assert.equal((await api('GET', `/api/state?project=${encodeURIComponent(p)}`)).body.empty, true, 'no mission was opened');
});

test('only stored attachments can be fetched', async () => {
  for (const id of ['../att.db', '1/../../att.db', '1/x.svg', 'x/y.png', '1/missing.png']) {
    const res = await fetch(`${base}/api/attachments/${encodeURIComponent(id)}`);
    assert.ok([400, 404].includes(res.status), `${id} → ${res.status}`);
  }
  assert.equal(existsSync(join(attachDir, '..', 'att.db')), true);
});
