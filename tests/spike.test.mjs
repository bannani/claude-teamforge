import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeamforgeServer } from '../worker/server.mjs';
import { buildArgs } from '../worker/providers/copilot.mjs';
import { spikePrompt } from '../worker/agent/prompt.mjs';
import { TECH_MARKER, groupSteps, splitAnswer } from '../dashboard/src/spike.js';

const H = { 'content-type': 'application/json' };
const allowed = (args) => args.slice(args.indexOf('--allow-tool') + 1);

let server; let db; let base;
const runs = [];
let script = async () => {};

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tf-spike-'));
  ({ server, db } = createTeamforgeServer({
    dbPath: join(dir, 'spike.db'),
    provider: () => ({ provider: 'copilot', label: 'GitHub Copilot', model: null }),
    run: async (call) => { runs.push(call); await script(call); return { exitCode: 0, stderr: '' }; },
  }));
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const project = () => mkdtempSync(join(tmpdir(), 'tf-spikeproj-'));
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
const ANSWER = `Refills are blocked after three.\n\nConfidence: high — covered by tests\n${TECH_MARKER}\n\`src/refill.js:12\` checks the count.`;

// ---------- the answer format ----------

test('splitAnswer: the functional part, and the technical part behind the marker', () => {
  assert.deepEqual(splitAnswer(ANSWER), {
    functional: 'Refills are blocked after three.',
    confidence: { level: 'high', reason: 'covered by tests' },
    technical: '`src/refill.js:12` checks the count.',
  });
  assert.deepEqual(splitAnswer('Which screen do you mean?'), { functional: 'Which screen do you mean?', confidence: null, technical: null });
  assert.deepEqual(splitAnswer(undefined), { functional: '', confidence: null, technical: null });
});

test('splitAnswer: the confidence line becomes a level and a reason, however it is dressed', () => {
  const read = (line) => splitAnswer(`Rule.\n\n${line}`).confidence;
  assert.deepEqual(read('**Confidence:** medium — un seul cas lu'), { level: 'medium', reason: 'un seul cas lu' });
  assert.deepEqual(read('Confidence: LOW'), { level: 'low', reason: '' });
  assert.equal(read('Confiance : élevée'), null, 'an untranslated level is what the briefing asks for; anything else stays as text');
  assert.equal(splitAnswer('Rule.\n\nConfiance : élevée').functional, 'Rule.\n\nConfiance : élevée');
  assert.equal(splitAnswer('We have high confidence: yes').confidence, null);
});

test('groupSteps: runs of tool lines fold into one entry', () => {
  const t = (key) => ({ role: 'tool', key });
  const grouped = groupSteps([{ role: 'user', key: 'u' }, t('a'), t('b'), { role: 'assistant', key: 'x' }, t('c')]);
  assert.deepEqual(grouped.map((m) => [m.role, m.tools?.map((x) => x.key)]), [
    ['user', undefined], ['steps', ['a', 'b']], ['assistant', undefined], ['steps', ['c']],
  ]);
});

test('splitAnswer: tolerates the marker as models tend to decorate it', () => {
  for (const marker of ['=== TECHNICAL ===', '**===TECHNICAL===**', '  ===technical===  ']) {
    assert.deepEqual(splitAnswer(`Plain.\n${marker}\nDetail.`), { functional: 'Plain.', confidence: null, technical: 'Detail.' }, marker);
  }
});

test('splitAnswer: a marker still being streamed is not shown', () => {
  assert.deepEqual(splitAnswer('Plain.\n===TECH'), { functional: 'Plain.', confidence: null, technical: null });
  assert.deepEqual(splitAnswer(`Plain.\n${TECH_MARKER}`), { functional: 'Plain.', confidence: null, technical: '' });
  assert.equal(splitAnswer('a = b\n= not a marker').functional, 'a = b\n= not a marker');
});

test('the briefing asks for both parts with the marker the console splits on', () => {
  const prompt = spikePrompt({ project: '/p' });
  assert.ok(prompt.includes(`\n${TECH_MARKER}\n`));
  assert.match(prompt, /functional answer/i);
  assert.match(prompt, /language of the client's question/);
});

// ---------- permissions ----------

test('read-only: no write of any kind, no reporting command, grants and allow-all ignored', () => {
  const tools = allowed(buildArgs({ prompt: 'q', sessionId: 's', readOnly: true, writeOpen: true, grants: ['npm'], allowAll: true }));
  assert.ok(tools.includes('shell(cat)') && tools.includes('shell(git log)'));
  assert.deepEqual(tools.filter((t) => t.startsWith('write') || t === 'shell' || /teamforge|npm|mkdir/.test(t)), []);
});

// ---------- the mode ----------

test('/spike: the next message is a read-only question answered by the analysis desk', async () => {
  const p = project();
  assert.equal((await history(p)).mode, 'build');
  await send(p, '/spike');
  assert.equal((await history(p)).mode, 'spike');

  let during;
  script = async ({ onEvent }) => { during = await state(p); onEvent({ type: 'message', text: ANSWER }); };
  await send(p, 'How many refills can a patient get?');
  const h = await idle(p);

  const call = runs.at(-1);
  assert.match(call.args[1], /spike mode/);
  assert.doesNotMatch(call.args[1], /You run TeamForge/);
  assert.match(call.args[1], /How many refills can a patient get\?$/);
  assert.deepEqual(allowed(call.args).filter((t) => t.startsWith('write') || t.includes('teamforge')), []);
  assert.ok(!existsSync(join(p, 'docs')), 'nothing is created in the project');

  const answer = h.messages.at(-1);
  assert.equal(answer.text, ANSWER, 'both parts are kept: the console folds the technical one');

  const working = (s, role) => s.agents.find((a) => a.role === role).status;
  assert.equal(during.session.kind, 'spike');
  assert.equal(working(during, 'architect'), 'working');
  assert.equal(working(during, 'analyst'), 'working');
  const after_ = await state(p);
  assert.equal(working(after_, 'architect'), 'idle');
  assert.equal(after_.session.phase, 'idea', 'a spike has no pipeline');
});

test('follow-up questions stay in the same spike and are reminded of the format', async () => {
  const p = project();
  await send(p, '/spike');
  script = say(ANSWER);
  await send(p, 'first question');
  await idle(p);
  const sid = (c) => c.args[c.args.indexOf('--session-id') + 1];
  const first = runs.at(-1);
  await send(p, 'and for children?');
  await idle(p);
  const second = runs.at(-1);
  assert.equal(sid(second), sid(first));
  assert.match(second.args[1], /^and for children\?/);
  assert.ok(second.args[1].includes(TECH_MARKER));
  assert.doesNotMatch(second.args[1], /Current workflow phase/);
});

test('a mission and a spike live side by side: switching shows the other conversation', async () => {
  const p = project();
  script = say('On it.');
  await send(p, 'build a todo app');
  await idle(p);
  const mission = (await state(p)).session;

  await send(p, '/spike');
  assert.deepEqual((await history(p)).messages, [], 'the spike starts with its own transcript');
  script = say(ANSWER);
  await send(p, 'how are todos sorted?');
  await idle(p);
  const spike = (await state(p)).session;
  assert.notEqual(spike.id, mission.id);
  assert.equal(db.getSession(mission.id).phase, 'idea', 'the mission is untouched');

  await send(p, '/build');
  const back = await history(p);
  assert.equal(back.mode, 'build');
  assert.equal((await state(p)).session.id, mission.id);
  assert.deepEqual(back.messages.slice(0, 2).map((m) => m.text), ['build a todo app', 'On it.']);

  script = say('Continuing.');
  await send(p, 'carry on');
  await idle(p);
  assert.match(runs.at(-1).args[1], /Current workflow phase/, 'the mission resumes as a mission');
});

test('a gate answered while in spike mode does not leak into the spike', async () => {
  const p = project();
  script = say('ok');
  await send(p, 'build it');
  await idle(p);
  const mission = (await state(p)).session;
  const { validation } = (await api('POST', `/api/sessions/${mission.id}/validations`, { gate: 'spec_gate', question: 'ok?' })).body;
  await send(p, '/spike');
  const before_ = runs.length;
  await api('PATCH', `/api/validations/${validation.id}`, { status: 'approved' });
  await idle(p);
  assert.equal(runs.length, before_);
});

test('/spike and /build say so when nothing changes, and wait for a running turn', async () => {
  const p = project();
  script = say('ok');
  await send(p, 'build it');
  await idle(p);
  await send(p, '/build');
  assert.equal((await history(p)).messages.at(-1).text, 'Already in build mode.');
  let release;
  script = () => new Promise((r) => { release = r; });
  await send(p, 'carry on');
  assert.equal((await send(p, '/spike')).status, 409);
  assert.equal((await history(p)).mode, 'build');
  release();
  await idle(p);
});

test('/export saves the spike as a document written by the worker', async () => {
  const p = project();
  await send(p, '/spike');
  script = async ({ onEvent }) => { onEvent({ type: 'message', text: 'Let me look.' }); onEvent({ type: 'message', text: ANSWER }); };
  await send(p, 'Combien de renouvellements\npour un patient ?');
  await idle(p);
  await send(p, '/export');
  const reply = (await history(p)).messages.at(-1).text;
  const path = /`(docs\/spikes\/[^`]+)`/.exec(reply)?.[1];
  assert.match(path, /^docs\/spikes\/\d{4}-\d\d-\d\d-combien-de-renouvellements-pour-un-patient\.md$/);
  const doc = readFileSync(join(p, path), 'utf8');
  assert.match(doc, /## 1\. Combien de renouvellements pour un patient \?\n\nRefills are blocked after three\.\n\n\*\*Confidence: high\*\* — covered by tests/);
  assert.match(doc, /### Technical details\n\n`src\/refill\.js:12`/);
  assert.ok(!doc.includes(TECH_MARKER) && !doc.includes('Let me look'));
  assert.ok((await state(p)).files.includes(path));
});

test('/export has nothing to do outside a spike or before an answer', async () => {
  const p = project();
  script = say('ok');
  await send(p, 'build it');
  await idle(p);
  await send(p, '/export');
  assert.match((await history(p)).messages.at(-1).text, /switch to spike mode/);
  assert.ok(!existsSync(join(p, 'docs', 'spikes')));
});
