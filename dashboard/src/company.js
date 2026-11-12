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

// Desks: two rows of department zones. Lounge: two rows in the middle.
const DESK_ROWS = [
  { y: 21, departments: ['direction', 'product', 'delivery', 'team'] },
  { y: 86, departments: ['engineering', 'quality'] },
];
const ZONE_GAP = 0.7; // empty desks between two departments

export function officeLayout(roster) {
  const desks = {};
  const zones = [];
  for (const row of DESK_ROWS) {
    const groups = row.departments
      .map((d) => roster.filter((r) => r.department === d))
      .filter((g) => g.length > 0);
    const units = groups.reduce((n, g) => n + g.length, 0) + (groups.length - 1) * ZONE_GAP;
    let offset = 0;
    for (const group of groups) {
      const xs = group.map((r, i) => {
        const x = units <= 1 ? 50 : 9 + ((offset + i) / (units - 1)) * 82;
        desks[r.id] = { x, y: row.y };
        return x;
      });
      zones.push({ department: group[0].department, x: (xs[0] + xs.at(-1)) / 2, y: row.y - 19 });
      offset += group.length + ZONE_GAP;
    }
  }
  const lounge = {};
  const firstRow = Math.ceil(roster.length / 2);
  roster.forEach((r, i) => {
    const second = i >= firstRow;
    const k = second ? i - firstRow : i;
    const count = second ? roster.length - firstRow : firstRow;
    // 12% apart; neighbours staggered in depth and the back row shifted sideways
    // so name tags and status marks never touch
    lounge[r.id] = { x: 50 + (k - (count - 1) / 2) * 12 + (second ? 5 : 0), y: (second ? 53 : 40) + (k % 2 ? 3 : 0) };
  });
  return { desks, zones, lounge };
}
