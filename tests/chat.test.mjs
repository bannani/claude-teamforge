import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createTeamforgeServer } from '../worker/server.mjs';

const TOKEN = 'c'.repeat(64);
const H = { 'content-type': 'application/json', 'x-teamforge-token': TOKEN };
const allowed = (args) => args.slice(args.indexOf('--allow-tool') + 1);

let server; let db; let base;
let available = true;
const runs = [];          // every call the fake agent received
let script = async () => {}; // what the fake agent does on the next run

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tf-chat-'));
  ({ server, db } = createTeamforgeServer({
    dbPath: join(dir, 'chat.db'),
    token: TOKEN,
    provider: () => (available ? { provider: 'copilot', label: 'GitHub Copilot', model: null } : { provider: null, reason: 'install copilot' }),
    run: async (call) => { runs.push(call); await script(call); return { exitCode: call.exit ?? 0, stderr: call.stderr ?? '' }; },
  }));
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const project = () => mkdtempSync(join(tmpdir(), 'tf-proj-'));
async function api(method, path, body) {
  const res = await fetch(base + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const history = async (p) => (await api('GET', `/api/chat?project=${encodeURIComponent(p)}`)).body;
async function idle(p) {
  for (let i = 0; i < 200; i += 1) {
    const h = await history(p);
    if (!h.running) return h;
    await new Promise((r) => { setTimeout(r, 10); });
  }
  throw new Error('turn never finished');
}
const say = (text) => async ({ onEvent }) => { onEvent({ type: 'text', text }); onEvent({ type: 'message', text }); };

test('no provider: the setup hint is reported and sending is refused', async () => {
  available = false;
  const p = project();
  const info = await api('GET', `/api/provider?project=${encodeURIComponent(p)}`);
  assert.equal(info.body.provider, null);
  assert.equal(info.body.project, p);
  const sent = await api('POST', '/api/chat', { project_path: p, text: 'hello' });
  assert.equal(sent.status, 400);
  assert.match(sent.body.error, /install copilot/);
  available = true;
});

test('first message opens a mission, briefs the agent and saves the exchange', async () => {
  const p = project();
  script = say('On it.');
  assert.equal((await api('POST', '/api/chat', { project_path: p, text: 'build a todo app' })).status, 202);
  const h = await idle(p);
  assert.deepEqual(h.messages.map((m) => [m.role, m.text]), [['user', 'build a todo app'], ['assistant', 'On it.']]);

  const state = (await api('GET', `/api/state?project=${encodeURIComponent(p)}`)).body;
  assert.equal(state.session.title, 'build a todo app');
  assert.equal(state.session.phase, 'idea');

  const call = runs.at(-1);
  const prompt = call.args[1];
  assert.match(prompt, /You run TeamForge/);
  assert.match(prompt, /build a todo app$/);
  assert.equal(call.cwd, p);
  assert.equal(call.env.TEAMFORGE_TOKEN, TOKEN);
  assert.equal(call.env.TEAMFORGE_URL, base);
  assert.equal(call.env.TEAMFORGE_PROJECT, p);
  assert.ok(call.env.PATH.split(':')[0].endsWith(`worker${sep}bin`), 'the teamforge command is first on PATH');
});

test('later messages resume the same agent session without repeating the briefing', async () => {
  const p = project();
  script = say('one');
  await api('POST', '/api/chat', { project_path: p, text: 'first' });
  await idle(p);
  const firstSession = runs.at(-1).args[runs.at(-1).args.indexOf('--session-id') + 1];
  script = say('two');
  await api('POST', '/api/chat', { project_path: p, text: 'second' });
  await idle(p);
  const call = runs.at(-1);
  assert.equal(call.args[call.args.indexOf('--session-id') + 1], firstSession);
  assert.match(call.args[1], /^second/);
  assert.doesNotMatch(call.args[1], /You run TeamForge/);
});

test('one turn at a time; Stop ends it and the conversation stays usable', async () => {
  const p = project();
  script = ({ signal }) => new Promise((resolve) => { signal.addEventListener('abort', resolve); });
  await api('POST', '/api/chat', { project_path: p, text: 'long job' });
  assert.equal((await history(p)).running, true);
  assert.equal((await api('POST', '/api/chat', { project_path: p, text: 'again' })).status, 409);
  assert.equal((await api('POST', '/api/chat/stop', { project_path: p })).body.stopped, true);
  await idle(p);
  script = say('back');
  assert.equal((await api('POST', '/api/chat', { project_path: p, text: 'still there?' })).status, 202);
  assert.equal((await idle(p)).messages.at(-1).text, 'back');
});

test('write lock: source writes and granted programs open only at implementation', async () => {
  const p = project();
  script = say('ok');
  await api('POST', '/api/chat', { project_path: p, text: 'start' });
  await idle(p);
  assert.equal((await api('POST', '/api/grants', { project_path: p, program: 'npm' })).status, 201);
  await idle(p);
  let tools = allowed(runs.at(-1).args);
  assert.ok(!tools.includes('write') && !tools.includes('shell(npm:*)'), 'locked before implementation');

  const { session } = (await api('GET', `/api/state?project=${encodeURIComponent(p)}`)).body;
  db.setPhase(session.id, 'implementation');
  await api('POST', '/api/chat', { project_path: p, text: 'go' });
  await idle(p);
  tools = allowed(runs.at(-1).args);
  assert.ok(tools.includes('write') && tools.includes('shell(npm:*)'));
});

test('approving the plan opens source writes for the turn that follows; a refusal does not', async () => {
  const p = project();
  script = say('plan ready');
  await api('POST', '/api/chat', { project_path: p, text: 'build' });
  await idle(p);
  const { session } = (await api('GET', `/api/state?project=${encodeURIComponent(p)}`)).body;
  db.setPhase(session.id, 'plan_gate');
  const ask = async () => (await api('POST', `/api/sessions/${session.id}/validations`, { gate: 'plan_gate', question: 'OK?' })).body.validation;

  await api('PATCH', `/api/validations/${(await ask()).id}`, { status: 'changes_requested', answer: 'smaller' });
  await idle(p);
  assert.ok(!allowed(runs.at(-1).args).includes('write'), 'still locked after a refusal');

  await api('PATCH', `/api/validations/${(await ask()).id}`, { status: 'approved' });
  await idle(p);
  assert.match(runs.at(-1).args[1], /^\[plan_gate approved\]/);
  assert.ok(allowed(runs.at(-1).args).includes('write'), 'open once the plan is approved');
});

test('answering a gate on the dashboard becomes the agent\'s next message', async () => {
  const p = project();
  script = say('Please validate the spec.');
  await api('POST', '/api/chat', { project_path: p, text: 'build it' });
  await idle(p);
  const { session } = (await api('GET', `/api/state?project=${encodeURIComponent(p)}`)).body;
  const { validation } = (await api('POST', `/api/sessions/${session.id}/validations`, { gate: 'spec_gate', question: 'OK?' })).body;
  script = say('Thanks, moving on.');
  await api('PATCH', `/api/validations/${validation.id}`, { status: 'approved', answer: 'looks good' });
  const h = await idle(p);
  assert.deepEqual(h.messages.slice(-2).map((m) => [m.role, m.text]), [
    ['user', '[spec_gate approved] looks good'], ['assistant', 'Thanks, moving on.'],
  ]);
});

test('allowing a program stores it and tells the agent to continue', async () => {
  const p = project();
  script = async ({ onEvent }) => {
    onEvent({ type: 'tool_start', id: 't', name: 'bash', summary: 'npm test' });
    onEvent({ type: 'tool_end', id: 't', name: 'bash', summary: 'npm test', path: null, ok: false, denied: true, error: 'Permission denied', program: 'npm' });
  };
  await api('POST', '/api/chat', { project_path: p, text: 'run tests' });
  let h = await idle(p);
  const tool = h.messages.find((m) => m.role === 'tool');
  assert.deepEqual([tool.name, tool.summary, tool.denied, tool.program], ['bash', 'npm test', true, 'npm']);

  script = say('Tests pass.');
  assert.equal((await api('POST', '/api/grants', { project_path: p, program: 'npm' })).status, 201);
  h = await idle(p);
  assert.deepEqual(h.grants, ['npm']);
  assert.match(h.messages.at(-2).text, /^\[permission granted: npm\]/);
  assert.equal((await api('POST', '/api/grants', { project_path: p, program: 'rm -rf /' })).status, 400);
});

test('a file the agent wrote shows up in the mission files', async () => {
  const p = project();
  script = async ({ onEvent }) => {
    onEvent({ type: 'tool_end', id: 'w', name: 'create', summary: join(p, 'docs', 'spec.md'), path: join(p, 'docs', 'spec.md'), ok: true, denied: false, error: null, program: null });
    onEvent({ type: 'tool_end', id: 'r', name: 'bash', summary: 'teamforge phase spec', path: null, ok: true, denied: false, error: null, program: null });
  };
  await api('POST', '/api/chat', { project_path: p, text: 'write the spec' });
  const h = await idle(p);
  const state = (await api('GET', `/api/state?project=${encodeURIComponent(p)}`)).body;
  assert.deepEqual(state.files, [join('docs', 'spec.md')]);
  assert.equal(h.messages.find((m) => m.name === 'create').summary, join('docs', 'spec.md'), 'paths are shown relative to the project');
  assert.equal(state.events.filter((e) => e.kind === 'tool').length, 0, 'no duplicate timeline entry for a written file or a status report');
});

test('an agent failure is shown as an error and the conversation stays usable', async () => {
  const p = project();
  script = async (call) => { call.exit = 3; call.stderr = 'not signed in\n'; };
  await api('POST', '/api/chat', { project_path: p, text: 'hello' });
  const h = await idle(p);
  const last = h.messages.at(-1);
  assert.equal(last.role, 'error');
  assert.match(last.text, /exit 3.*not signed in/);
  script = say('ok now');
  assert.equal((await api('POST', '/api/chat', { project_path: p, text: 'retry' })).status, 202);
  await idle(p);
});

test('bad input is refused: empty text, relative or missing project', async () => {
  const p = project();
  assert.equal((await api('POST', '/api/chat', { project_path: p, text: '  ' })).status, 400);
  assert.equal((await api('POST', '/api/chat', { project_path: 'relative/dir', text: 'x' })).status, 400);
  assert.equal((await api('POST', '/api/chat', { project_path: '/nonexistent/tf-project', text: 'x' })).status, 400);
});

test('chat events are streamed as named SSE events', async () => {
  const p = project();
  const ac = new AbortController();
  const res = await fetch(`${base}/events?project=${encodeURIComponent(p)}`, { headers: H, signal: ac.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  script = say('streamed');
  await api('POST', '/api/chat', { project_path: p, text: 'hi' });
  let buf = '';
  while (!buf.includes('"turn_end"')) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value);
  }
  ac.abort();
  const chat = buf.split('\n\n').filter((b) => b.startsWith('event: chat')).map((b) => JSON.parse(b.split('\ndata: ')[1]));
  assert.deepEqual(chat.map((e) => e.type), ['user', 'turn_start', 'text', 'message', 'turn_end']);
  assert.equal(chat.at(-1).status, 'end');
});
