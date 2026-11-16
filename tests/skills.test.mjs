import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeamforgeServer } from '../worker/server.mjs';
import { charter, skill } from '../worker/agent/skills.mjs';
import { agentFile } from '../worker/agent/team.mjs';
import { coordinatorPrompt } from '../worker/agent/prompt.mjs';
import { ROLE_CATALOG } from '../worker/roles.mjs';
import { GATES, PHASES } from '../worker/state-machine.mjs';

test('every working phase has a playbook; gates and the two ends have none', () => {
  for (const phase of PHASES) {
    const expected = !GATES.has(phase) && phase !== 'idea' && phase !== 'done';
    assert.equal(skill(phase).startsWith('# Playbook'), expected, phase);
  }
  assert.equal(skill('../package'), '', 'only plain names are read');
});

test('every employee has a charter: no frontmatter, no plugin-era instructions', () => {
  for (const role of ROLE_CATALOG) {
    const text = charter(role.id);
    assert.match(text, /^You are the \*\*/, role.id);
    assert.doesNotMatch(text, /cli path|^name:|^tools:/m, role.id);
  }
  assert.equal(charter('nobody'), '');
});

test('an employee running as their own agent gets their charter', () => {
  const qa = ROLE_CATALOG.find((r) => r.id === 'qa');
  assert.ok(agentFile(qa, 'some-model').includes(charter('qa')));
});

test('the CEO is told that phase and agent reports answer with instructions', () => {
  const prompt = coordinatorPrompt({ project: '/p' });
  assert.match(prompt, /returns a `playbook`/);
  assert.match(prompt, /`charter` the first time/);
});

let server; let db; let base;
before(async () => {
  ({ server, db } = createTeamforgeServer({ dbPath: join(mkdtempSync(join(tmpdir(), 'tf-skills-')), 's.db') }));
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
const post = async (path, body) => (await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

test('entering a phase hands over its playbook', async () => {
  const s = db.createSession({ project_path: '/p/skills' });
  const entered = await post(`/api/sessions/${s.id}/phase`, { phase: 'brainstorm' });
  assert.equal(entered.session.phase, 'brainstorm');
  assert.equal(entered.playbook, skill('brainstorm'));
  db.setPhase(s.id, 'spec');
  assert.equal((await post(`/api/sessions/${s.id}/phase`, { phase: 'spec_gate' })).playbook, undefined);
});

test('an employee starting work gets their charter once per agent conversation', async () => {
  const s = db.createSession({ project_path: '/p/charter' });
  db.setAgentSession(s.id, 'conversation-1');
  const working = { role: 'pm', status: 'working', note: 'brainstorming' };
  assert.equal((await post(`/api/sessions/${s.id}/agents`, working)).charter, charter('pm'));
  assert.equal((await post(`/api/sessions/${s.id}/agents`, { ...working, status: 'idle' })).charter, undefined);
  assert.equal((await post(`/api/sessions/${s.id}/agents`, working)).charter, undefined, 'not repeated');
  db.setAgentSession(s.id, 'conversation-2'); // what /clear does
  assert.equal((await post(`/api/sessions/${s.id}/agents`, working)).charter, charter('pm'));
});
