import test from 'node:test';
import assert from 'node:assert/strict';
import { officeLayout, placeOf, pickVisit } from '../dashboard/src/company.js';

const person = (id, department, status = 'idle') => ({ id, department, status, note: '' });
const roster = [
  person('ceo', 'direction'),
  person('pm', 'product'), person('analyst', 'product'),
  person('frontend', 'engineering'), person('backend', 'engineering'), person('data', 'engineering'),
  person('devops', 'engineering'), person('architect', 'engineering'),
  person('qa', 'quality'), person('scrum', 'delivery'),
];

test('officeLayout builds a room per department plus meeting and cafeteria', () => {
  const { rooms } = officeLayout(roster);
  const ids = rooms.map((r) => r.id);
  for (const id of ['direction', 'product', 'engineering', 'quality', 'delivery', 'meeting', 'cafeteria']) {
    assert.ok(ids.includes(id), `missing room ${id}`);
  }
});

test('every employee gets a desk inside their own department room', () => {
  const { rooms, desks } = officeLayout(roster);
  for (const r of roster) {
    const room = rooms.find((x) => x.id === r.department);
    const d = desks[r.id];
    assert.equal(d.room, room.id);
    assert.ok(d.x > room.x && d.x < room.x + room.w, `${r.id} x outside its room`);
    assert.ok(d.y > room.y && d.y < room.y + room.h, `${r.id} y outside its room`);
  }
});

test('rooms never overlap each other', () => {
  const { rooms } = officeLayout(roster);
  for (const a of rooms) {
    for (const b of rooms) {
      if (a === b) continue;
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      assert.ok(apart, `${a.id} overlaps ${b.id}`);
    }
  }
});

test('unknown departments land in a Team room', () => {
  const { rooms, desks } = officeLayout([person('x', 'weird'), person('y', 'team')]);
  assert.equal(desks.x.room, 'team');
  assert.equal(desks.y.room, 'team');
  assert.ok(rooms.some((r) => r.id === 'team'));
});

test('every employee gets a cafeteria spot inside the cafeteria', () => {
  const { rooms, cafe } = officeLayout(roster);
  const room = rooms.find((r) => r.id === 'cafeteria');
  for (const r of roster) {
    assert.equal(cafe[r.id].room, 'cafeteria');
    assert.ok(cafe[r.id].x > room.x && cafe[r.id].x < room.x + room.w);
    assert.ok(cafe[r.id].y > room.y && cafe[r.id].y < room.y + room.h);
  }
});

test('an empty roster does not crash', () => {
  const { rooms, desks } = officeLayout([]);
  assert.ok(rooms.length >= 2);
  assert.deepEqual(desks, {});
});

test('placeOf: working and blocked sit at their desk, others go to the cafeteria', () => {
  const layout = officeLayout(roster);
  assert.equal(placeOf(person('pm', 'product', 'working'), layout).room, 'product');
  assert.equal(placeOf(person('pm', 'product', 'blocked'), layout).room, 'product');
  assert.equal(placeOf(person('pm', 'product', 'idle'), layout).room, 'cafeteria');
  assert.equal(placeOf(person('pm', 'product', 'done'), layout).room, 'cafeteria');
});

test('placeOf: the CEO waits in the meeting room while a gate is pending', () => {
  const layout = officeLayout(roster);
  const ceo = person('ceo', 'direction', 'working');
  assert.equal(placeOf(ceo, layout, { gatePending: true }).room, 'meeting');
  assert.equal(placeOf(ceo, layout, { gatePending: false }).room, 'direction');
  assert.equal(placeOf(person('pm', 'product', 'working'), layout, { gatePending: true }).room, 'product');
});

test('pickVisit needs two working people from different departments', () => {
  assert.equal(pickVisit(roster, 0), null);
  const same = [person('pm', 'product', 'working'), person('analyst', 'product', 'working')];
  assert.equal(pickVisit(same, 0), null);
});

test('pickVisit sends a worker to a colleague of another department, and rotates', () => {
  const crew = [
    person('pm', 'product', 'working'), person('frontend', 'engineering', 'working'),
    person('qa', 'quality', 'working'), person('scrum', 'delivery'),
  ];
  const seen = new Set();
  for (let seq = 0; seq < 6; seq += 1) {
    const v = pickVisit(crew, seq);
    const from = crew.find((r) => r.id === v.visitor);
    const to = crew.find((r) => r.id === v.host);
    assert.equal(from.status, 'working');
    assert.equal(to.status, 'working');
    assert.notEqual(from.department, to.department);
    seen.add(v.visitor);
  }
  assert.ok(seen.size > 1, 'visits should rotate');
});
