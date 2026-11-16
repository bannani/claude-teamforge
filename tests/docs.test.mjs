import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeamforgeServer } from '../worker/server.mjs';

const H = { 'content-type': 'application/json' };
let server; let base;
const runs = [];

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tf-docs-'));
  ({ server } = createTeamforgeServer({
    dbPath: join(dir, 'docs.db'),
    provider: () => ({ provider: 'copilot', label: 'GitHub Copilot', model: null }),
    run: async (call) => { runs.push(call); call.onEvent({ type: 'message', text: 'ok' }); return { exitCode: 0, stderr: '' }; },
  }));
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const project = () => mkdtempSync(join(tmpdir(), 'tf-docsproj-'));
async function api(method, path, body) {
  const res = await fetch(base + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const q = (p, path) => `?project=${encodeURIComponent(p)}${path ? `&path=${encodeURIComponent(path)}` : ''}`;
const put = (p, path, content, base_rev) => api('PUT', '/api/docs/file', { project_path: p, path, content, base_rev });
async function idle(p) {
  for (let i = 0; i < 200; i += 1) {
    const h = (await api('GET', `/api/chat${q(p)}`)).body;
    if (!h.running) return h;
    await new Promise((r) => { setTimeout(r, 10); });
  }
  throw new Error('turn never finished');
}

test('the document list says which ones exist', async () => {
  const p = project();
  mkdirSync(join(p, 'docs'));
  writeFileSync(join(p, 'docs', 'spec.md'), '# Spec\n');
  const { docs } = (await api('GET', `/api/docs${q(p)}`)).body;
  assert.deepEqual(docs.map((d) => [d.path, d.exists]), [
    ['docs/spec.md', true], ['docs/stories.md', false], ['docs/design.md', false], ['docs/plan.md', false],
  ]);
  assert.equal(docs[0].title, 'Specification');
});

test('read returns the content and a revision; a missing document is 404', async () => {
  const p = project();
  mkdirSync(join(p, 'docs'));
  writeFileSync(join(p, 'docs', 'plan.md'), '# Plan\n\n- one\n');
  const doc = (await api('GET', `/api/docs/file${q(p, 'docs/plan.md')}`)).body;
  assert.equal(doc.content, '# Plan\n\n- one\n');
  assert.match(doc.rev, /^[0-9a-f]{40}$/);
  assert.equal((await api('GET', `/api/docs/file${q(p, 'docs/spec.md')}`)).status, 404);
});

test('save writes the file when the editor started from the current revision', async () => {
  const p = project();
  mkdirSync(join(p, 'docs'));
  writeFileSync(join(p, 'docs', 'spec.md'), 'v1');
  const { rev } = (await api('GET', `/api/docs/file${q(p, 'docs/spec.md')}`)).body;
  const saved = await put(p, 'docs/spec.md', 'v2 by the client', rev);
  assert.equal(saved.status, 200);
  assert.equal(readFileSync(join(p, 'docs', 'spec.md'), 'utf8'), 'v2 by the client');
  assert.notEqual(saved.body.rev, rev);
});

test('save is refused when the team changed the file in the meantime', async () => {
  const p = project();
  mkdirSync(join(p, 'docs'));
  writeFileSync(join(p, 'docs', 'spec.md'), 'v1');
  const { rev } = (await api('GET', `/api/docs/file${q(p, 'docs/spec.md')}`)).body;
  writeFileSync(join(p, 'docs', 'spec.md'), 'v2 by the team');
  const refused = await put(p, 'docs/spec.md', 'v2 by the client', rev);
  assert.equal(refused.status, 409);
  assert.match(refused.body.rev, /^[0-9a-f]{40}$/, 'the current revision is returned so the editor can overwrite on purpose');
  assert.equal(readFileSync(join(p, 'docs', 'spec.md'), 'utf8'), 'v2 by the team');
  assert.equal((await put(p, 'docs/spec.md', 'v2 by the client', refused.body.rev)).status, 200);
});

test('a document that does not exist yet can be created, docs/ included', async () => {
  const p = project();
  assert.equal((await put(p, 'docs/stories.md', '# Stories', null)).status, 200);
  assert.equal(readFileSync(join(p, 'docs', 'stories.md'), 'utf8'), '# Stories');
  assert.equal((await put(p, 'docs/stories.md', 'again', null)).status, 409, 'creating over an existing file is a conflict');
});

test('only the mission documents can be read or written', async () => {
  const p = project();
  writeFileSync(join(p, 'secret.txt'), 'x');
  for (const path of ['secret.txt', '../outside.md', 'docs/../secret.txt', '/etc/passwd', 'docs/other.md', '']) {
    assert.equal((await api('GET', `/api/docs/file${q(p, path)}`)).status, 400, `read ${path}`);
    assert.equal((await put(p, path, 'x', null)).status, 400, `write ${path}`);
  }
  assert.equal(readFileSync(join(p, 'secret.txt'), 'utf8'), 'x');
  assert.equal((await api('GET', `/api/docs${q('relative/path')}`)).status, 400);
});

test('a symlink cannot be used to leave the project', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'tf-outside-'));
  writeFileSync(join(outside, 'target.md'), 'private');
  const p = project();
  mkdirSync(join(p, 'docs'));
  symlinkSync(join(outside, 'target.md'), join(p, 'docs', 'spec.md'));
  assert.equal((await api('GET', `/api/docs/file${q(p, 'docs/spec.md')}`)).status, 400);
  assert.equal((await put(p, 'docs/spec.md', 'overwritten', null)).status, 400);
  assert.equal(readFileSync(join(outside, 'target.md'), 'utf8'), 'private');

  const p2 = project();
  symlinkSync(outside, join(p2, 'docs'));
  assert.equal((await put(p2, 'docs/plan.md', 'x', null)).status, 400);
  assert.equal(existsSync(join(outside, 'plan.md')), false);
});

test('an oversized document is refused', async () => {
  const p = project();
  assert.equal((await put(p, 'docs/spec.md', 'x'.repeat(600 * 1024), null)).status, 413);
});

test('after the client edits a document, the agent is told on its next turn — once', async () => {
  const p = project();
  await api('POST', '/api/chat', { project_path: p, text: 'build it' });
  await idle(p);
  await put(p, 'docs/spec.md', '# My spec', null);
  let h = await idle(p);
  assert.equal(h.messages.at(-1).role, 'system');
  assert.match(h.messages.at(-1).text, /You edited `docs\/spec.md`/);
  const state = (await api('GET', `/api/state${q(p)}`)).body;
  assert.ok(state.files.includes('docs/spec.md'));

  await api('POST', '/api/chat', { project_path: p, text: 'continue' });
  await idle(p);
  assert.match(runs.at(-1).args[1], /The client edited docs\/spec\.md in the browser/);
  await api('POST', '/api/chat', { project_path: p, text: 'and again' });
  await idle(p);
  assert.doesNotMatch(runs.at(-1).args[1], /The client edited/);
});
