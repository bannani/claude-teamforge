import test from 'node:test';
import assert from 'node:assert/strict';
import { TABS, nextTab, countTasks, truncate } from '../dashboard/src/layout.js';

test('TABS lists the three mobile sections in order', () => {
  assert.deepEqual(TABS.map((t) => t.id), ['company', 'console', 'mission']);
});

test('nextTab moves with arrows and wraps around', () => {
  assert.equal(nextTab('company', 'ArrowRight'), 'console');
  assert.equal(nextTab('mission', 'ArrowRight'), 'company');
  assert.equal(nextTab('company', 'ArrowLeft'), 'mission');
  assert.equal(nextTab('console', 'Home'), 'company');
  assert.equal(nextTab('console', 'End'), 'mission');
});

test('nextTab ignores other keys and unknown tabs', () => {
  assert.equal(nextTab('console', 'a'), 'console');
  assert.equal(nextTab('nope', 'ArrowRight'), 'console');
});

test('countTasks groups statuses; unknown ones count as in progress', () => {
  const tasks = [
    { status: 'todo' }, { status: 'todo' }, { status: 'in_progress' },
    { status: 'review' }, { status: 'blocked' }, { status: 'done' },
  ];
  assert.deepEqual(countTasks(tasks), { todo: 2, in_progress: 3, done: 1, total: 6 });
  assert.deepEqual(countTasks([]), { todo: 0, in_progress: 0, done: 0, total: 0 });
});

test('truncate shortens long text with an ellipsis', () => {
  assert.equal(truncate('short', 10), 'short');
  assert.equal(truncate('abcdefghij', 5), 'abcd…');
  assert.equal(truncate(undefined, 5), '');
});
