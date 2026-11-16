import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createBridge } from '../worker/browser/bridge.mjs';
import { createAuth } from '../worker/auth.mjs';
import { createTeamforgeServer } from '../worker/server.mjs';
import { TOOLS } from '../worker/browser/tools.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

// ---------- the broker ----------

test('a command waits for the extension, and its answer goes back to the caller', async () => {
  const bridge = createBridge();
  const idle = bridge.poll(50);
  assert.equal(await idle, null, 'nothing to do: the poll ends empty');
  const waiting = bridge.poll(1000);
  const answer = bridge.call({ tool: 'browser_snapshot', args: {}, sites: ['http://a'] });
  const command = await waiting;
  assert.equal(command.tool, 'browser_snapshot');
  assert.deepEqual(command.sites, ['http://a']);
  assert.equal(bridge.result(command.id, { ok: true, text: 'Page: A' }), true);
  assert.deepEqual(await answer, { ok: true, text: 'Page: A' });
  assert.equal(bridge.result(command.id, { ok: true }), false, 'an answer counts once');
});

test('without the extension the team is told at once; a silent browser times out', async () => {
  let clock = 1_000_000;
  const bridge = createBridge({ now: () => clock });
  assert.match((await bridge.call({ tool: 'browser_snapshot' })).error, /extension is not connected/);
  await bridge.poll(1);
  assert.equal(bridge.connected(), true);
  assert.match((await bridge.call({ tool: 'browser_snapshot' }, 30)).error, /did not answer/);
  assert.equal(await bridge.poll(1), null, 'a command that timed out is not handed over later');
  clock += 60_000;
  assert.equal(bridge.connected(), false);
});

// ---------- the worker's routes ----------

const TOKEN = 'b'.repeat(64);
const BRIDGE = createAuth(TOKEN).bridgeToken;
let server; let db; let port; let base;
before(async () => {
  ({ server, db } = createTeamforgeServer({ dbPath: join(mkdtempSync(join(tmpdir(), 'tf-bridge-')), 'b.db'), token: TOKEN, provider: () => ({ provider: null, reason: 'none' }) }));
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});
after(() => server.close());

function request(method, path, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const ext = { 'x-teamforge-bridge': BRIDGE, origin: 'chrome-extension://abcdefghijklmnop' };
const worker = { 'x-teamforge-token': TOKEN };

test('pairing: the dashboard hands out a token that only opens the extension\'s two routes', async () => {
  assert.equal((await request('GET', '/api/bridge/pair')).status, 401, 'pairing needs the dashboard\'s cookie');
  const paired = await request('GET', '/api/bridge/pair', { cookie: `teamforge=${TOKEN}` });
  assert.equal(paired.body.token, BRIDGE);
  assert.notEqual(BRIDGE, TOKEN);
  assert.equal((await request('GET', '/api/state', { 'x-teamforge-token': BRIDGE })).status, 401);
  assert.equal((await request('POST', '/api/chat', { 'x-teamforge-bridge': BRIDGE }, { text: 'hi' })).status, 401);
  assert.equal((await request('GET', '/api/bridge/poll?wait=5', { 'x-teamforge-bridge': 'nope' })).status, 401);
  assert.equal((await request('GET', '/api/bridge/poll?wait=5', { ...ext, host: 'evil.example.com' })).status, 403);
  assert.equal((await request('GET', '/api/bridge/poll?wait=5', ext)).status, 204);
});

test('a tool call reaches the extension with the sites the client allowed, and nothing without them', async () => {
  const none = await request('POST', '/api/bridge/call', worker, { project_path: '/p/none', tool: 'browser_snapshot' });
  assert.match(none.body.error, /has not allowed any site/);
  assert.equal((await request('POST', '/api/bridge/call', worker, { project_path: '/p/x', tool: 'rm_rf' })).status, 400);
  assert.equal((await request('POST', '/api/bridge/call', { 'x-teamforge-bridge': BRIDGE }, { tool: 'browser_snapshot' })).status, 401, 'the extension cannot give itself orders');

  db.setSetting('/p/site', 'browser', 'http://localhost:4200 https://test.example.com');
  await request('GET', '/api/bridge/poll?wait=5', ext); // the extension is there
  const pending = request('GET', '/api/bridge/poll?wait=2000', ext);
  const call = request('POST', '/api/bridge/call', worker, { project_path: '/p/site', tool: 'browser_navigate', args: { url: 'http://localhost:4200/' } });
  const command = (await pending).body;
  assert.equal(command.tool, 'browser_navigate');
  assert.deepEqual(command.sites, ['http://localhost:4200', 'https://test.example.com']);
  assert.deepEqual((await request('POST', '/api/bridge/result', ext, { id: command.id, ok: true, text: 'Opened' })).body, { accepted: true });
  assert.deepEqual((await call).body, { ok: true, text: 'Opened' });
});

// ---------- the tools Copilot starts ----------

test('the MCP server lists TeamForge\'s tools and sends each call through the worker', async () => {
  const shots = mkdtempSync(join(tmpdir(), 'tf-shots-'));
  db.setSetting('/p/mcp', 'browser', 'http://localhost:4200');
  const child = spawn(process.execPath, [join(ROOT, 'worker', 'browser', 'mcp.mjs')], {
    env: { ...process.env, TEAMFORGE_URL: base, TEAMFORGE_TOKEN: TOKEN, TEAMFORGE_PROJECT: '/p/mcp', TEAMFORGE_SHOTS: shots },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const replies = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => { const m = JSON.parse(line); replies.get(m.id)?.(m); });
  let n = 0;
  const rpc = (method, params) => new Promise((resolve) => { n += 1; replies.set(n, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`); });
  try {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.serverInfo.name, 'TeamForge browser');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const { result } = await rpc('tools/list', {});
    assert.deepEqual(result.tools.map((t) => t.name), TOOLS.map((t) => t.name));
    assert.ok(!result.tools.some((t) => /evaluate|run_code|upload/.test(t.name)), 'nothing that runs code or reads files');

    // a stand-in for the extension: answers a snapshot, then a screenshot
    await request('GET', '/api/bridge/poll?wait=5', ext);
    const play = async (outcome) => {
      const command = (await request('GET', '/api/bridge/poll?wait=3000', ext)).body;
      await request('POST', '/api/bridge/result', ext, { id: command.id, ...outcome });
      return command;
    };
    const extension = play({ ok: true, text: 'Page: Home\n[1] link "Orders"' });
    const snap = await rpc('tools/call', { name: 'browser_snapshot', arguments: {} });
    assert.equal((await extension).tool, 'browser_snapshot');
    assert.equal(snap.result.content[0].text, 'Page: Home\n[1] link "Orders"');

    const extension2 = play({ ok: true, text: 'Screenshot of http://localhost:4200/.', image: PNG.toString('base64') });
    const shot = await rpc('tools/call', { name: 'browser_take_screenshot', arguments: {} });
    await extension2;
    assert.equal(shot.result.content[1].type, 'image');
    const [file] = readdirSync(shots);
    assert.match(file, /^page-[\w-]+\.png$/, 'a name the console can fetch');
    assert.deepEqual(readFileSync(join(shots, file)), PNG);

    const extension3 = play({ ok: false, error: 'https://evil.example.com is not a site the client allowed' });
    const refused = await rpc('tools/call', { name: 'browser_navigate', arguments: { url: 'https://evil.example.com/' } });
    await extension3;
    assert.equal(refused.result.isError, true);
    assert.match(refused.result.content[0].text, /not a site the client allowed/);
    assert.equal((await rpc('tools/call', { name: 'browser_run_code_unsafe', arguments: {} })).result.isError, true);
  } finally { child.kill(); }
});
