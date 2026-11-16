import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeamforgeServer } from '../worker/server.mjs';

const H = { 'content-type': 'application/json' };
const allowed = (args) => args.slice(args.indexOf('--allow-tool') + 1);

let server; let db; let base;
const runs = [];
let script = async () => {};

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tf-cmd-'));
  ({ server, db } = createTeamforgeServer({
    dbPath: join(dir, 'cmd.db'),
    provider: () => ({ provider: 'copilot', label: 'GitHub Copilot', model: null }),
    run: async (call) => { runs.push(call); await script(call); return { exitCode: 0, stderr: '' }; },
  }));
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const project = () => mkdtempSync(join(tmpdir(), 'tf-cmdproj-'));
async function api(method, path, body) {
  const res = await fetch(base + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const send = (p, text) => api('POST', '/api/chat', { project_path: p, text });
const history = async (p) => (await api('GET', `/api/chat?project=${encodeURIComponent(p)}`)).body;
const state = async (p) => (await api('GET', `/api/state?project=${encodeURIComponent(p)}`)).body;
async function idle(p) {
  for (let i = 0; i < 200; i += 1) {
    const h = await history(p);
    if (!h.running) return h;
    await new Promise((r) => { setTimeout(r, 10); });
  }
  throw new Error('turn never finished');
}
const say = (text) => async ({ onEvent }) => { onEvent({ type: 'message', text }); };
async function mission(p, phase) {
  script = say('ok');
  await send(p, 'build something');
  await idle(p);
  const { session } = await state(p);
  if (phase) db.setPhase(session.id, phase);
  return session;
}

test('a command is answered by TeamForge and never reaches the agent', async () => {
  const p = project();
  await mission(p);
  const before_ = runs.length;
  assert.equal((await send(p, '/help')).status, 202);
  const h = await history(p);
  const last = h.messages.at(-1);
  assert.equal(last.role, 'system');
  assert.equal(last.command, '/help');
  assert.match(last.text, /\/allow-all/);
  assert.equal(runs.length, before_, 'the agent was not started');
});

test('an unknown command lists the real ones', async () => {
  const p = project();
  await mission(p);
  await send(p, '/frobnicate now');
  const last = (await history(p)).messages.at(-1);
  assert.match(last.text, /Unknown command `\/frobnicate`/);
  assert.match(last.text, /\/clear/);
});

test('/clear empties the conversation, keeps the mission, and the agent is briefed again', async () => {
  const p = project();
  const session = await mission(p, 'plan');
  db.addTask(session.id, 'Keep me', 'backend');
  const firstAgent = runs.at(-1).args[runs.at(-1).args.indexOf('--session-id') + 1];

  await send(p, '/clear');
  const h = await history(p);
  assert.deepEqual(h.messages.map((m) => m.role), ['system'], 'only the confirmation remains');
  const s = await state(p);
  assert.equal(s.session.phase, 'plan');
  assert.equal(s.tasks.length, 1);

  script = say('back');
  await send(p, 'carry on');
  await idle(p);
  const call = runs.at(-1);
  assert.notEqual(call.args[call.args.indexOf('--session-id') + 1], firstAgent, 'a new agent conversation');
  assert.match(call.args[1], /You run TeamForge/);
  assert.match(call.args[1], /already under way \(phase: plan\)/);
});

test('/new closes the mission; the next message opens another one', async () => {
  const p = project();
  const first = await mission(p, 'spec');
  db.upsertAgent(first.id, 'pm', 'working', 'writing');
  await send(p, '/new');
  const closed = await state(p);
  assert.equal(closed.session.phase, 'done');
  assert.equal(closed.agents.find((a) => a.role === 'pm').status, 'idle');
  assert.deepEqual((await history(p)).messages, [], 'the console starts empty');

  script = say('hello again');
  await send(p, 'a second idea');
  await idle(p);
  const next = await state(p);
  assert.notEqual(next.session.id, first.id);
  assert.equal(next.session.phase, 'idea');
});

test('/allow and /deny manage programs; a bad name is refused with the usage', async () => {
  const p = project();
  await mission(p);
  await send(p, '/allow npm');
  await send(p, '/allow node');
  await send(p, '/deny node');
  assert.deepEqual((await history(p)).grants, ['npm']);
  await send(p, '/allow rm;ls');
  const h = await history(p);
  assert.match(h.messages.at(-1).text, /Usage: `\/allow <program>`/);
  assert.deepEqual(h.grants, ['npm']);
});

test('/allow-all opens every shell command from implementation only, and /allow-all off closes it', async () => {
  const p = project();
  const session = await mission(p);
  await send(p, '/allow-all');
  assert.equal((await history(p)).allowAll, true);
  assert.match((await history(p)).messages.at(-1).text, /any shell command/);

  script = say('ok');
  await send(p, 'still before the plan');
  await idle(p);
  let tools = allowed(runs.at(-1).args);
  assert.ok(!tools.includes('shell') && !tools.includes('write'), 'the lock before plan approval is unchanged');

  db.setPhase(session.id, 'implementation');
  await send(p, 'go');
  await idle(p);
  tools = allowed(runs.at(-1).args);
  assert.ok(tools.includes('shell') && tools.includes('write'));
  assert.ok(!runs.at(-1).args.some((a) => a.startsWith('--allow-all')), 'never Copilot\'s allow-everything switch');

  await send(p, '/allow-all off');
  assert.equal((await history(p)).allowAll, false);
  await send(p, 'go on');
  await idle(p);
  assert.ok(!allowed(runs.at(-1).args).includes('shell'));
});

test('/model chooses the model for the project and /model default resets it', async () => {
  const p = project();
  await mission(p);
  await send(p, '/model gpt-5.6-sol');
  assert.equal((await history(p)).model, 'gpt-5.6-sol');
  assert.equal((await api('GET', `/api/provider?project=${encodeURIComponent(p)}`)).body.model, 'gpt-5.6-sol');
  script = say('ok');
  await send(p, 'continue');
  await idle(p);
  assert.equal(runs.at(-1).args[runs.at(-1).args.indexOf('--model') + 1], 'gpt-5.6-sol');

  await send(p, '/model default');
  assert.equal((await history(p)).model, null);
  await send(p, '/model bad!name');
  assert.match((await history(p)).messages.at(-1).text, /does not look like a model name/);
  await send(p, '/model nobody gpt-5.6-sol');
  assert.match((await history(p)).messages.at(-1).text, /Unknown employee `nobody`/);
});

test('/model <employee> gives one employee their own model, as a generated sub-agent', async () => {
  const p = project();
  await mission(p);
  await send(p, '/model backend gpt-5.6-sol');
  assert.deepEqual((await history(p)).models, { default: null, roles: { backend: 'gpt-5.6-sol' } });

  script = say('ok');
  await send(p, 'continue');
  await idle(p);
  const file = join(p, '.github', 'agents', 'teamforge-backend.agent.md');
  const text = readFileSync(file, 'utf8');
  assert.match(text, /^name: teamforge-backend$/m);
  assert.match(text, /^model: gpt-5\.6-sol$/m);
  assert.match(text, /Backend Developer/);
  assert.match(runs.at(-1).args[1], /Backend Developer = teamforge-backend/, 'the coordinator is told to delegate');
  assert.ok(!runs.at(-1).args.includes('--model'), 'the company keeps its own model');

  await send(p, '/model');
  assert.match((await history(p)).messages.at(-1).text, /Backend Developer: `gpt-5.6-sol`/);

  await send(p, '/model backend default');
  await send(p, 'again');
  await idle(p);
  assert.equal(existsSync(file), false, 'the generated file is removed with the setting');
  assert.doesNotMatch(runs.at(-1).args[1], /teamforge-backend/);
});

test('a file of the same name that TeamForge did not generate is never deleted', async () => {
  const p = project();
  mkdirSync(join(p, '.github', 'agents'), { recursive: true });
  const mine = join(p, '.github', 'agents', 'teamforge-qa.agent.md');
  writeFileSync(mine, 'my own agent');
  await mission(p);
  assert.equal(readFileSync(mine, 'utf8'), 'my own agent');
});

test('a sub-agent starting and finishing moves that employee on the dashboard and labels what they say', async () => {
  const p = project();
  await mission(p);
  script = async ({ onEvent }) => {
    onEvent({ type: 'agent_start', role: 'backend', model: 'gpt-5.6-sol', task: 'build the API' });
    onEvent({ type: 'tool_end', id: 't', name: 'bash', summary: 'npm test', path: null, role: 'backend', ok: true, denied: false, error: null, program: null });
    onEvent({ type: 'message', text: 'API done.', role: 'backend' });
    onEvent({ type: 'agent_end', role: 'backend', model: 'gpt-5.6-sol', ok: true, error: null });
    onEvent({ type: 'agent_start', role: 'qa', model: 'claude-haiku-5.5', task: 'test it' });
    onEvent({ type: 'agent_end', role: 'qa', model: 'claude-haiku-5.5', ok: false, error: 'thinking is not supported' });
  };
  await send(p, 'build');
  const h = await idle(p);
  assert.equal(h.messages.find((m) => m.text === 'API done.').agent, 'backend');
  const tool = h.messages.find((m) => m.name === 'bash');
  assert.deepEqual([tool.role, tool.agent], ['tool', 'backend'], 'a tool line stays a tool line, attributed to the employee');
  assert.match(h.messages.at(-1).text, /QA Engineer could not run on claude-haiku-5.5: thinking is not supported/);
  const s = await state(p);
  assert.equal(s.agents.find((a) => a.role === 'backend').status, 'idle');
  assert.equal(s.agents.find((a) => a.role === 'qa').status, 'blocked');
});

test('PUT /api/models sets and resets models; bad input is refused', async () => {
  const p = project();
  const put = (role, model) => api('PUT', '/api/models', { project_path: p, role, model });
  assert.deepEqual((await put('designer', 'gpt-5.6-sol')).body.models, { default: null, roles: { designer: 'gpt-5.6-sol' } });
  assert.deepEqual((await put(null, 'claude-sonnet-5.5')).body.models.default, 'claude-sonnet-5.5');
  assert.deepEqual((await put('ceo', 'auto')).body.models.default, 'auto', 'the CEO is the main agent');
  assert.deepEqual((await put('designer', null)).body.models.roles, {});
  assert.equal((await put('nobody', 'x')).status, 400);
  assert.equal((await put('qa', 'bad name; rm')).status, 400);
});

test('/status and /permissions describe the mission; /stop stops a running turn', async () => {
  const p = project();
  const session = await mission(p, 'spec_gate');
  db.addTask(session.id, 'One', 'qa');
  await api('POST', `/api/sessions/${session.id}/validations`, { gate: 'spec_gate', question: 'Approve the spec?' });
  await send(p, '/status');
  let text = (await history(p)).messages.at(-1).text;
  assert.match(text, /phase `spec_gate`/);
  assert.match(text, /Tasks: 0\/1 done/);
  assert.match(text, /Waiting for you: `spec_gate` — Approve the spec\?/);
  await send(p, '/permissions');
  text = (await history(p)).messages.at(-1).text;
  assert.match(text, /no program yet/);

  script = ({ signal }) => new Promise((resolve) => { signal.addEventListener('abort', resolve); });
  await send(p, 'long job');
  assert.equal((await history(p)).running, true);
  assert.equal((await send(p, '/clear')).status, 409, 'not while the team is working');
  assert.equal((await send(p, '/stop')).status, 202);
  await idle(p);
});

test('commands work without a mission and are refused for a bad project', async () => {
  const p = project();
  assert.equal((await send(p, '/status')).status, 202);
  assert.equal((await send(p, '/new')).status, 202);
  assert.equal((await state(p)).empty, true, 'no mission was created by a command');
  assert.equal((await send('/nonexistent/tf', '/help')).status, 400);
  assert.equal((await api('GET', `/api/provider?project=${encodeURIComponent(p)}`)).body.commands.length >= 8, true);
});
