import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTeamforgeServer } from '../worker/server.mjs';

const run = promisify(execFile);
const CLI = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'worker', 'cli.mjs');
const PROJECT = '/proj/cli-demo';

let server; let env;

before(async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'tf-cli-')), 'cli.db');
  ({ server } = createTeamforgeServer({ dbPath }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  env = {
    ...process.env,
    TEAMFORGE_URL: `http://127.0.0.1:${server.address().port}`,
    TEAMFORGE_PROJECT: PROJECT,
  };
});

after(() => server.close());

const cli = (...args) => run(process.execPath, [CLI, ...args], { env });

test('start creates a session', async () => {
  const { stdout } = await cli('start', '--name', 'Demo', '--title', 'CLI demo', '--no-open', '1');
  const out = JSON.parse(stdout);
  assert.equal(out.session.phase, 'idea');
  assert.equal(out.session.project_path, PROJECT);
});

test('phase advances and refusals exit nonzero with readable error', async () => {
  const { stdout } = await cli('phase', 'brainstorm');
  assert.equal(JSON.parse(stdout).session.phase, 'brainstorm');

  await assert.rejects(cli('phase', 'implementation'), (err) => {
    assert.equal(err.code, 1);
    assert.match(err.stderr, /skip/);
    return true;
  });
});

test('agent, task, decide, validate, event round-trip', async () => {
  await cli('agent', 'pm', '--status', 'working', '--note', 'brainstorming');
  const t = JSON.parse((await cli('task', 'add', 'Design header', '--role', 'frontend')).stdout);
  await cli('task', 'set', String(t.task.id), 'done');
  const d = JSON.parse((await cli('decide', 'Use SSE', '--detail', 'simple')).stdout);
  await cli('decide-set', String(d.decision.id), 'approved');
  const v = JSON.parse((await cli('validate', 'ask', 'spec_gate', 'Approve spec?')).stdout);
  await cli('validate', 'set', String(v.validation.id), 'approved', '--answer', 'yes');
  await cli('event', 'note', '--json', '{"text":"hello"}');

  const state = JSON.parse((await cli('state')).stdout);
  assert.equal(state.agents.find((a) => a.role === 'pm').status, 'working');
  assert.equal(state.tasks[0].status, 'done');
  assert.equal(state.validations[0].status, 'approved');
});

test('validate wait blocks until the dashboard answers', async () => {
  const v = JSON.parse((await cli('validate', 'ask', 'plan_gate', 'Approve plan?')).stdout);
  const id = v.validation.id;
  const waiting = cli('validate', 'wait', String(id), '--timeout', '20');
  setTimeout(() => {
    cli('validate', 'set', String(id), 'approved', '--answer', 'clicked ✓');
  }, 400);
  const { stdout } = await waiting;
  const out = JSON.parse(stdout);
  assert.equal(out.validation.status, 'approved');
  assert.equal(out.validation.answer, 'clicked ✓');
});

test('validate wait times out with exit 4', async () => {
  const v = JSON.parse((await cli('validate', 'ask', 'done_gate', 'Ship?')).stdout);
  await assert.rejects(
    cli('validate', 'wait', String(v.validation.id), '--timeout', '0'),
    (err) => { assert.equal(err.code, 4); return true; },
  );
});

test('gate-check exits 2 on deny', async () => {
  await assert.rejects(cli('gate-check', 'src/app.js'), (err) => {
    assert.equal(err.code, 2);
    assert.match(err.stdout, /"allow":false/);
    return true;
  });
  const { stdout } = await cli('gate-check', 'docs/notes.md');
  assert.match(stdout, /"allow":true/);
});
