// Company helpers: merge the role catalog (GET /api/roles) with live agent
// state, and compute where everyone sits in the office.

const FALLBACK_COLOR = '#94a3b8';

// One entry per employee: job description + live status. Works with an older
// worker that has no /api/roles (roles = []): agents become a flat team.
export function buildRoster(company, agents) {
  const byRole = Object.fromEntries(agents.map((a) => [a.role, a]));
  const live = (id) => ({ status: byRole[id]?.status || 'idle', note: byRole[id]?.note || '' });
  if (!company.roles.length) {
    return agents.map((a) => ({
      id: a.role, title: a.role, short: a.role, department: 'team', reportsTo: null,
      color: FALLBACK_COLOR, mission: '', responsibilities: [], phases: [], deliverable: '',
      ...live(a.role),
    }));
  }
  const known = new Set(company.roles.map((r) => r.id));
  return [
    ...company.roles.map((r) => ({ ...r, ...live(r.id) })),
    ...agents.filter((a) => !known.has(a.role)).map((a) => ({
      id: a.role, title: a.role, short: a.role, department: company.roles[0].department,
      reportsTo: company.roles[0].id, color: FALLBACK_COLOR, mission: '',
      responsibilities: [], phases: [], deliverable: '', ...live(a.role),
    })),
  ];
}

export function departmentsOf(company, roster) {
  if (company.departments.length) return company.departments;
  return roster.length ? [{ id: 'team', name: 'Team' }] : [];
}

// The office is a floor plan in % of the office box (x of its width, y of its
// height). Two wings of rooms — direction, meeting room, product and delivery
// on top; engineering and quality at the bottom — open through their doors
// onto a wide lounge in the middle, where everyone who is not working stands.
// The lounge is the full width on purpose: 14 people fit in two rows without
// covering each other's name.
const TOP_WING = { y: 1, h: 27, rooms: ['direction', 'meeting', 'product', 'delivery', 'team'] };
const BOTTOM_WING = { y: 72, h: 27, rooms: ['engineering', 'quality'] };
const LOUNGE = { x: 1, y: 29.5, w: 98, h: 41 };
const KNOWN = new Set([...TOP_WING.rooms, ...BOTTOM_WING.rooms].filter((id) => id !== 'meeting'));
const GAP = 1;
const DESK_W = 12.5;   // share of the width one desk asks for
const MEETING_W = 18;
const PER_LOUNGE_ROW = 7;

const deptOf = (r) => (KNOWN.has(r.department) ? r.department : 'team');

// Rooms of one wing, side by side, each as wide as its desks ask for and
// together filling the wing. Every desk is in one row, facing the door.
function layWing(wing, counts, isTop, lounge) {
  const present = wing.rooms.filter((id) => id === 'meeting' || counts[id] > 0);
  const want = (id) => (id === 'meeting' ? MEETING_W : counts[id] * DESK_W + 3);
  const scale = (98 - GAP * (present.length - 1)) / present.reduce((n, id) => n + want(id), 0);
  let x = 1;
  return present.map((id) => {
    const w = want(id) * scale;
    const cx = x + w / 2;
    const room = {
      id, kind: id === 'meeting' ? 'meeting' : 'department', department: id === 'meeting' ? null : id,
      x, y: wing.y, w, h: wing.h,
      door: { x: cx, y: isTop ? wing.y + wing.h : wing.y },            // on the wall facing the lounge
      inner: { x: cx, y: isTop ? wing.y + wing.h - 4 : wing.y + 5 },   // just inside the door
      lane: { x: cx, y: isTop ? lounge.y + 5 : lounge.y + lounge.h - 2 }, // just outside it
    };
    x += w + GAP;
    return room;
  });
}

export function officeLayout(roster) {
  const counts = {};
  for (const r of roster) counts[deptOf(r)] = (counts[deptOf(r)] || 0) + 1;
  const hasBottom = BOTTOM_WING.rooms.some((id) => counts[id] > 0);
  // without a bottom wing (a flat team) the lounge takes its place
  const lounge = { ...LOUNGE, h: hasBottom ? LOUNGE.h : 99 - LOUNGE.y };
  const cafeteria = { id: 'cafeteria', kind: 'cafeteria', department: null, open: true, ...lounge };
  const rooms = [
    ...layWing(TOP_WING, counts, true, lounge),
    cafeteria,
    ...(hasBottom ? layWing(BOTTOM_WING, counts, false, lounge) : []),
  ];
  const byId = Object.fromEntries(rooms.map((r) => [r.id, r]));

  const desks = {};
  for (const id of Object.keys(counts)) {
    const staff = roster.filter((r) => deptOf(r) === id);
    const room = byId[id];
    staff.forEach((r, i) => {
      desks[r.id] = { x: room.x + (room.w * (i + 0.5)) / staff.length, y: room.y + room.h * 0.72, room: id };
    });
  }

  // lounge: rows of at most seven, evenly spread, the rows slightly offset
  const cafe = {};
  const rowCount = Math.max(1, Math.ceil(roster.length / PER_LOUNGE_ROW));
  const perRow = Math.ceil(roster.length / rowCount);
  roster.forEach((r, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, roster.length - row * perRow);
    const col = i - row * perRow;
    const band = rowCount === 1 ? 0.6 : 0.42 + (0.36 * row) / (rowCount - 1);
    cafe[r.id] = {
      x: lounge.x + (lounge.w * (col + 0.5)) / inRow + (row % 2 ? 1.5 : -1.5),
      y: lounge.y + lounge.h * band,
      room: 'cafeteria',
    };
  });

  const meet = {};
  const meeting = byId.meeting;
  if (roster.some((r) => r.id === 'ceo')) meet.ceo = { x: meeting.x + meeting.w / 2, y: meeting.y + meeting.h * 0.74, room: 'meeting' };
  return { rooms, byId, desks, cafe, meet };
}

// Where someone is right now: at their desk when working or blocked, in the
// meeting room for the CEO while a gate waits for the client, else the cafeteria.
export function placeOf(person, layout, { gatePending = false } = {}) {
  if (gatePending && person.id === 'ceo') return layout.meet[person.id];
  if (person.status === 'working' || person.status === 'blocked') return layout.desks[person.id];
  return layout.cafe[person.id];
}

// A working person who walks over to a working colleague of another department.
// `seq` rotates through every such pair so each visit differs from the last.
export function pickVisit(roster, seq) {
  const workers = roster.filter((r) => r.status === 'working');
  const pairs = [];
  for (const visitor of workers) {
    for (const host of workers) {
      if (deptOf(visitor) !== deptOf(host)) pairs.push({ visitor: visitor.id, host: host.id });
    }
  }
  return pairs.length ? pairs[seq % pairs.length] : null;
}
