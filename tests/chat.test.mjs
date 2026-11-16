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

// ---------- one session per TeamForge tab ----------

test('each TeamForge tab has its own session: a new tab starts fresh, the first keeps its conversation', async () => {
  const p = project();
  const q = (tab) => `/api/chat?project=${encodeURIComponent(p)}&tab=${tab}`;
  const tabHistory = async (tab) => (await api('GET', q(tab))).body;
  const settle = async (tab) => { for (let i = 0; i < 200; i += 1) { const h = await tabHistory(tab); if (!h.running) return h; await new Promise((r) => { setTimeout(r, 10); }); } throw new Error('turn never finished'); };

  script = say('Answer for A.');
  await api('POST', '/api/chat', { project_path: p, tab: 'tabA', text: 'first idea' });
  await settle('tabA');
  assert.deepEqual((await tabHistory('tabB')).messages, [], 'a new tab starts empty');

  script = say('Answer for B.');
  await api('POST', '/api/chat', { project_path: p, tab: 'tabB', text: 'another idea' });
  const b = await settle('tabB');
  const a = await tabHistory('tabA');
  assert.deepEqual(a.messages.map((m) => m.text), ['first idea', 'Answer for A.']);
  assert.deepEqual(b.messages.map((m) => m.text), ['another idea', 'Answer for B.']);
  assert.match(runs.at(-1).args[1], /You run TeamForge/, 'the second tab is briefed from scratch');
  assert.equal(runs.at(-1).env.TEAMFORGE_TAB, 'tabB');

  const stateOf = async (tab) => (await api('GET', `/api/state?project=${encodeURIComponent(p)}&tab=${tab}`)).body;
  assert.equal((await stateOf('tabA')).session.title, 'first idea');
  assert.equal((await stateOf('tabB')).session.title, 'another idea');
  assert.equal((await stateOf('tabC')).empty, true);

  // the mode belongs to the tab too
  await api('POST', '/api/chat', { project_path: p, tab: 'tabB', text: '/spike' });
  assert.equal((await tabHistory('tabB')).mode, 'spike');
  assert.equal((await tabHistory('tabA')).mode, 'build');
  assert.deepEqual((await tabHistory('tabA')).messages.map((m) => m.text), ['first idea', 'Answer for A.']);
});

test('one turn at a time per project: a second tab is told the team is busy elsewhere', async () => {
  const p = project();
  let release;
  script = () => new Promise((r) => { release = r; });
  await api('POST', '/api/chat', { project_path: p, tab: 'tabA', text: 'long work' });
  const other = await api('POST', '/api/chat', { project_path: p, tab: 'tabB', text: 'me too' });
  assert.equal(other.status, 409);
  assert.match(other.body.error, /another TeamForge tab/);
  const view = async (tab) => (await api('GET', `/api/chat?project=${encodeURIComponent(p)}&tab=${tab}`)).body;
  assert.equal((await view('tabA')).running, true);
  assert.equal((await view('tabB')).running, false, 'the other tab does not show a turn it does not own');
  release();
  for (let i = 0; i < 200 && (await view('tabA')).running; i += 1) await new Promise((r) => { setTimeout(r, 10); });
});

test('a tab can take back a session from the list: the conversation moves to it', async () => {
  const p = project();
  const view = async (tab) => (await api('GET', `/api/chat?project=${encodeURIComponent(p)}&tab=${tab}`)).body;
  const settle = async (tab) => { for (let i = 0; i < 200; i += 1) { const h = await view(tab); if (!h.running) return h; await new Promise((r) => { setTimeout(r, 10); }); } throw new Error('turn never finished'); };
  const list = async (tab) => (await api('GET', `/api/sessions?project=${encodeURIComponent(p)}&tab=${tab}`)).body.sessions;

  script = say('Old answer.');
  await api('POST', '/api/chat', { project_path: p, tab: 'closedTab', text: 'the idea I lost' });
  await settle('closedTab');
  await api('POST', '/api/chat', { project_path: p, tab: 'closedTab', text: '/spike' });
  await api('POST', '/api/chat', { project_path: p, tab: 'closedTab', text: 'how does login work?' });
  await settle('closedTab');
  script = say('New answer.');
  await api('POST', '/api/chat', { project_path: p, tab: 'newTab', text: 'something else' });
  await settle('newTab');

  const sessions = await list('newTab');
  assert.deepEqual(sessions.map((s) => [s.title, s.kind, s.here]), [
    ['something else', 'mission', true], ['how does login work?', 'spike', false], ['the idea I lost', 'mission', false],
  ]);
  assert.equal(sessions[0].questions, 1);

  const lost = sessions.find((s) => s.title === 'the idea I lost');
  const adopted = await api('POST', `/api/sessions/${lost.id}/adopt`, { project_path: p, tab: 'newTab' });
  assert.deepEqual(adopted.body, { id: lost.id, mode: 'build' });
  assert.deepEqual((await view('newTab')).messages.map((m) => m.text).slice(0, 2), ['the idea I lost', 'Old answer.']);
  assert.ok((await list('newTab')).some((s) => s.title === 'something else' && !s.here), 'what the tab was showing is set aside, not lost');

  const spike = sessions.find((s) => s.kind === 'spike');
  await api('POST', `/api/sessions/${spike.id}/adopt`, { project_path: p, tab: 'newTab' });
  const now = await view('newTab');
  assert.equal(now.mode, 'spike', 'the tab takes the session\'s mode');
  assert.ok(now.messages.some((m) => m.text === 'how does login work?'));

  script = say('Carrying on.');
  await api('POST', '/api/chat', { project_path: p, tab: 'newTab', text: 'and logout?' });
  await settle('newTab');
  assert.doesNotMatch(runs.at(-1).args[1], /spike mode$|You are TeamForge's analysis desk/, 'the agent conversation is resumed, not started again');
  assert.equal((await api('POST', '/api/sessions/999999/adopt', { project_path: p, tab: 'newTab' })).status, 404);
});
