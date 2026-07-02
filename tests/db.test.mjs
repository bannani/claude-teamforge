import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../worker/db.mjs';
import { ROLES } from '../worker/state-machine.mjs';

function freshDb() {
  return openDb(join(mkdtempSync(join(tmpdir(), 'tf-')), 'test.db'));
}

test('createSession seeds session in idea phase with 7 idle agents', () => {
  const db = freshDb();
  const s = db.createSession({ project_path: '/p/demo', project_name: 'Demo', title: 'Todo app' });
  assert.equal(s.phase, 'idea');
  const snap = db.snapshot(s.id);
  assert.equal(snap.agents.length, 7);
  assert.deepEqual(snap.agents.map((a) => a.role).sort(), [...ROLES].sort());
  assert.ok(snap.agents.every((a) => a.status === 'idle'));
});

test('getActiveSession returns latest non-done session for project', () => {
  const db = freshDb();
  const a = db.createSession({ project_path: '/p/one', project_name: 'One', title: 't1' });
  db.setPhase(a.id, 'done');
  assert.equal(db.getActiveSession('/p/one'), undefined);
  const b = db.createSession({ project_path: '/p/one', project_name: 'One', title: 't2' });
  assert.equal(db.getActiveSession('/p/one').id, b.id);
});

test('validations gate flow', () => {
  const db = freshDb();
  const s = db.createSession({ project_path: '/p/v', project_name: 'V', title: 't' });
  assert.equal(db.hasApprovedValidation(s.id, 'spec_gate'), false);
  const v = db.addValidation(s.id, 'spec_gate', 'Approve the spec?');
  assert.equal(db.hasApprovedValidation(s.id, 'spec_gate'), false);
  db.answerValidation(v.id, 'approved', 'LGTM');
  assert.equal(db.hasApprovedValidation(s.id, 'spec_gate'), true);
});

test('decisions memory recall by project', () => {
  const db = freshDb();
  const s = db.createSession({ project_path: '/p/mem', project_name: 'M', title: 't' });
  const d = db.addDecision(s.id, '/p/mem', 'Use SSE', 'simpler than ws');
  db.updateDecision(d.id, 'approved');
  db.addDecision(s.id, '/p/mem', 'Rejected idea', '');
  const recall = db.approvedDecisions('/p/mem', 10);
  assert.equal(recall.length, 1);
  assert.equal(recall[0].title, 'Use SSE');
});

test('snapshot shape: tasks, events, files', () => {
  const db = freshDb();
  const s = db.createSession({ project_path: '/p/s', project_name: 'S', title: 't' });
  const task = db.addTask(s.id, 'Build header', 'frontend');
  db.updateTask(task.id, 'in_progress');
  db.addEvent(s.id, 'file', { file: 'src/App.jsx', tool: 'Write' });
  db.addEvent(s.id, 'file', { file: 'src/App.jsx', tool: 'Edit' });
  db.addEvent(s.id, 'note', { text: 'hello' });
  const snap = db.snapshot(s.id);
  assert.equal(snap.session.id, s.id);
  assert.equal(snap.tasks[0].status, 'in_progress');
  assert.deepEqual(snap.files, ['src/App.jsx']);
  assert.ok(snap.events.length >= 3);
  assert.ok(Object.hasOwn(snap, 'validations') && Object.hasOwn(snap, 'decisions'));
});
