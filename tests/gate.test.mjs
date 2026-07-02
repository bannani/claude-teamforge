// THE HEADLINE TEST: mechanical proof that brainstorming happens before coding.
// Simulates Claude Code's PreToolUse hook invocation end-to-end through the
// real gate-check.sh shim against a real worker: a Write to src/app.js is
// DENIED during brainstorm and ALLOWED only after both gates are approved.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTeamforgeServer } from '../worker/server.mjs';

const HOOK = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'hooks', 'gate-check.sh');
const PROJECT = mkdtempSync(join(tmpdir(), 'tf-proj-'));

let server; let base; let db;

before(async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'tf-gate-')), 'gate.db');
  ({ server, db } = createTeamforgeServer({ dbPath }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function runHook(stdinJson) {
  return new Promise((resolve) => {
    const child = execFile(HOOK, { env: { ...process.env, TEAMFORGE_URL: base } },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr }));
    child.stdin.end(JSON.stringify(stdinJson));
  });
}

const writeAttempt = {
  hook_event_name: 'PreToolUse',
  tool_name: 'Write',
  tool_input: { file_path: join(PROJECT, 'src', 'app.js'), content: 'code' },
  cwd: PROJECT,
};

test('setup: session in brainstorm phase', async () => {
  const res = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project_path: PROJECT, project_name: 'Gate', title: 'gate demo' }),
  });
  const { session } = await res.json();
  db.setPhase(session.id, 'brainstorm');
  assert.equal(db.getActiveSession(PROJECT).phase, 'brainstorm');
});

test('DENIED: writing src/app.js during brainstorm', async () => {
  const { code, stdout } = await runHook(writeAttempt);
  assert.equal(code, 0, 'hook must exit 0 and speak JSON');
  const out = JSON.parse(stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /brainstorm/);
});

test('docs are still writable during brainstorm', async () => {
  const { code, stdout } = await runHook({
    ...writeAttempt,
    tool_input: { file_path: join(PROJECT, 'docs', 'spec.md') },
  });
  assert.equal(code, 0);
  assert.equal(stdout.trim(), '', 'allow = silent (normal permission flow continues)');
});

test('ALLOWED: after both gates approved and phase = implementation', async () => {
  const session = db.getActiveSession(PROJECT);
  for (const phase of ['questions', 'spec', 'spec_gate']) db.setPhase(session.id, phase);
  db.answerValidation(db.addValidation(session.id, 'spec_gate', 'ok?').id, 'approved');
  db.setPhase(session.id, 'plan');
  db.setPhase(session.id, 'plan_gate');
  db.answerValidation(db.addValidation(session.id, 'plan_gate', 'ok?').id, 'approved');
  db.setPhase(session.id, 'implementation');

  const { code, stdout } = await runHook(writeAttempt);
  assert.equal(code, 0);
  assert.equal(stdout.trim(), '');
});

test('fail-open: worker unreachable never blocks the user', async () => {
  const child = execFile(HOOK, { env: { ...process.env, TEAMFORGE_URL: 'http://127.0.0.1:1' } },
    () => {});
  const result = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
    child.stdin.end(JSON.stringify(writeAttempt));
  });
  assert.equal(result, 0);
});
