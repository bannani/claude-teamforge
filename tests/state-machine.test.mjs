import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASES, canTransition, isGate, phaseIndex, gateAllowsWrite,
} from '../worker/state-machine.mjs';

test('phase order is the contract', () => {
  assert.deepEqual(PHASES, [
    'idea', 'brainstorm', 'questions', 'spec', 'spec_gate', 'plan', 'plan_gate',
    'implementation', 'tests', 'review', 'done_gate', 'done',
  ]);
  assert.equal(phaseIndex('idea'), 0);
  assert.ok(isGate('spec_gate') && isGate('plan_gate') && isGate('done_gate'));
  assert.ok(!isGate('plan'));
});

test('advancing one step forward is allowed', () => {
  assert.equal(canTransition('idea', 'brainstorm').ok, true);
  assert.equal(canTransition('brainstorm', 'questions').ok, true);
});

test('skipping phases is rejected', () => {
  const r = canTransition('brainstorm', 'spec');
  assert.equal(r.ok, false);
  assert.match(r.reason, /skip/);
  assert.equal(canTransition('idea', 'implementation').ok, false);
});

test('moving backward (revision) is always allowed', () => {
  assert.equal(canTransition('plan', 'brainstorm').ok, true);
  assert.equal(canTransition('review', 'implementation').ok, true);
});

test('gates require approval to exit forward', () => {
  assert.equal(canTransition('spec_gate', 'plan').ok, false);
  assert.equal(canTransition('spec_gate', 'plan', { gateApproved: true }).ok, true);
  assert.equal(canTransition('plan_gate', 'implementation').ok, false);
  assert.equal(canTransition('plan_gate', 'implementation', { gateApproved: true }).ok, true);
  assert.equal(canTransition('done_gate', 'done').ok, false);
  assert.equal(canTransition('done_gate', 'done', { gateApproved: true }).ok, true);
});

test('unknown phases are rejected', () => {
  assert.equal(canTransition('brainstorm', 'shipping').ok, false);
  assert.equal(canTransition('nope', 'idea').ok, false);
});

test('write gate: source files locked before implementation', () => {
  const r = gateAllowsWrite('brainstorm', 'src/app.js');
  assert.equal(r.allow, false);
  assert.match(r.reason, /brainstorm/);
  assert.equal(gateAllowsWrite('spec', 'lib/util.py').allow, false);
});

test('write gate: docs and markdown always allowed', () => {
  assert.equal(gateAllowsWrite('brainstorm', 'docs/specs/x.md').allow, true);
  assert.equal(gateAllowsWrite('idea', 'NOTES.md').allow, true);
  assert.equal(gateAllowsWrite('spec', '/proj/.claude/settings.json').allow, true);
});

test('write gate: open from implementation onward', () => {
  for (const p of ['implementation', 'tests', 'review', 'done_gate', 'done']) {
    assert.equal(gateAllowsWrite(p, 'src/app.js').allow, true, p);
  }
});
