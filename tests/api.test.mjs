import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeamforgeServer } from '../worker/server.mjs';

let server; let base;

before(async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'tf-api-')), 'api.db');
  ({ server } = createTeamforgeServer({ dbPath }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

let sid;

test('health and empty state', async () => {
  assert.equal((await api('GET', '/api/health')).body.ok, true);
  assert.equal((await api('GET', '/api/state?project=/nope')).body.empty, true);
});

test('create session', async () => {
  const r = await api('POST', '/api/sessions', {
    project_path: '/proj/todo', project_name: 'Todo', title: 'Build a React todo app',
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.session.phase, 'idea');
  sid = r.body.session.id;
  const state = await api('GET', '/api/state?project=/proj/todo');
  assert.equal(state.body.session.id, sid);
  assert.equal(state.body.agents.length, 7);
});

test('phase skip is rejected with 409', async () => {
  const r = await api('POST', `/api/sessions/${sid}/phase`, { phase: 'implementation' });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /skip/);
});

test('gate blocks until validation approved', async () => {
  for (const p of ['brainstorm', 'questions', 'spec', 'spec_gate']) {
    assert.equal((await api('POST', `/api/sessions/${sid}/phase`, { phase: p })).status, 200, p);
  }
  const blocked = await api('POST', `/api/sessions/${sid}/phase`, { phase: 'plan' });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /validation/);

  const v = await api('POST', `/api/sessions/${sid}/validations`, {
    gate: 'spec_gate', question: 'Approve the spec?',
  });
  assert.equal(v.body.validation.status, 'pending');
  await api('PATCH', `/api/validations/${v.body.validation.id}`, { status: 'approved', answer: 'yes' });
  assert.equal((await api('POST', `/api/sessions/${sid}/phase`, { phase: 'plan' })).status, 200);
});

test('gate-check denies code writes pre-implementation, allows after', async () => {
  const deny = await api('POST', '/api/gate-check', {
    project_path: '/proj/todo', file_path: 'src/App.jsx',
  });
  assert.equal(deny.body.allow, false);
  assert.match(deny.body.reason, /plan/);

  await api('POST', `/api/sessions/${sid}/phase`, { phase: 'plan_gate' });
  const v = await api('POST', `/api/sessions/${sid}/validations`, { gate: 'plan_gate', question: 'Approve plan?' });
  await api('PATCH', `/api/validations/${v.body.validation.id}`, { status: 'approved' });
  await api('POST', `/api/sessions/${sid}/phase`, { phase: 'implementation' });

  const allow = await api('POST', '/api/gate-check', {
    project_path: '/proj/todo', file_path: 'src/App.jsx',
  });
  assert.equal(allow.body.allow, true);
});

test('no active session means gate-check allows', async () => {
  const r = await api('POST', '/api/gate-check', { project_path: '/other', file_path: 'x.js' });
  assert.equal(r.body.allow, true);
});

test('agents, tasks, decisions, events land in snapshot', async () => {
  await api('POST', `/api/sessions/${sid}/agents`, { role: 'frontend', status: 'working', note: 'building UI' });
  const t = await api('POST', `/api/sessions/${sid}/tasks`, { title: 'Header component', role: 'frontend' });
  await api('PATCH', `/api/tasks/${t.body.task.id}`, { status: 'done' });
  const d = await api('POST', `/api/sessions/${sid}/decisions`, { title: 'Use Vite', detail: 'fast' });
  await api('PATCH', `/api/decisions/${d.body.decision.id}`, { status: 'approved' });
  await api('POST', `/api/sessions/${sid}/events`, { kind: 'note', payload: { text: 'hi' } });

  const s = (await api('GET', '/api/state?project=/proj/todo')).body;
  assert.equal(s.agents.find((a) => a.role === 'frontend').status, 'working');
  assert.equal(s.tasks[0].status, 'done');
  const mem = (await api('GET', '/api/decisions?project=/proj/todo')).body;
  assert.equal(mem.decisions[0].title, 'Use Vite');
});

test('validation can be fetched by id (dashboard answer flow)', async () => {
  const v = await api('POST', `/api/sessions/${sid}/validations`, {
    gate: 'done_gate', question: 'Ship it?',
  });
  const id = v.body.validation.id;
  assert.equal((await api('GET', `/api/validations/${id}`)).body.validation.status, 'pending');
  await api('PATCH', `/api/validations/${id}`, { status: 'approved', answer: 'clicked in dashboard' });
  const after = (await api('GET', `/api/validations/${id}`)).body.validation;
  assert.equal(after.status, 'approved');
  assert.equal(after.answer, 'clicked in dashboard');
  assert.equal((await api('GET', '/api/validations/99999')).status, 404);
});

test('SSE stream sends snapshot on connect and on mutation', async () => {
  const res = await fetch(`${base}/events?project=/proj/todo`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const readMessage = async () => {
    while (!buf.includes('\n\n')) {
      const { value } = await reader.read();
      buf += decoder.decode(value, { stream: true });
    }
    const [msg, ...rest] = buf.split('\n\n');
    buf = rest.join('\n\n');
    return JSON.parse(msg.replace(/^data: /, ''));
  };

  const first = await readMessage();
  assert.equal(first.session.id, sid);
  await api('POST', `/api/sessions/${sid}/agents`, { role: 'qa', status: 'working', note: 'running tests' });
  const second = await readMessage();
  assert.equal(second.agents.find((a) => a.role === 'qa').status, 'working');
  await reader.cancel();
});
