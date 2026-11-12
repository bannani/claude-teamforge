import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEPARTMENTS, ROLE_CATALOG, ROLE_IDS } from '../worker/roles.mjs';
import { PHASES, ROLES } from '../worker/state-machine.mjs';
import { openDb } from '../worker/db.mjs';
import { createTeamforgeServer } from '../worker/server.mjs';

const AGENTS_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'agents');

test('role ids are unique and drive the workflow ROLES', () => {
  assert.equal(new Set(ROLE_IDS).size, ROLE_IDS.length);
  assert.deepEqual(ROLES, ROLE_IDS);
});

test('the original seven roles keep their ids (existing databases stay valid)', () => {
  for (const id of ['pm', 'architect', 'frontend', 'backend', 'qa', 'security', 'reviewer']) {
    assert.ok(ROLE_IDS.includes(id), id);
  }
});

test('every role has a complete job description', () => {
  const departments = new Set(DEPARTMENTS.map((d) => d.id));
  for (const r of ROLE_CATALOG) {
    assert.ok(r.title && r.short && r.mission && r.deliverable, r.id);
    assert.match(r.color, /^#[0-9a-f]{6}$/, r.id);
    assert.ok(departments.has(r.department), `${r.id}: unknown department`);
    assert.ok(r.responsibilities.length >= 3, `${r.id}: responsibilities`);
    assert.ok(r.phases.length >= 1 && r.phases.every((p) => PHASES.includes(p)), `${r.id}: phases`);
  }
});

test('reporting line: one root, every manager exists, no cycles', () => {
  const byId = new Map(ROLE_CATALOG.map((r) => [r.id, r]));
  assert.deepEqual(ROLE_CATALOG.filter((r) => r.reportsTo === null).map((r) => r.id), ['ceo']);
  for (const r of ROLE_CATALOG) {
    let cur = r; let hops = 0;
    while (cur.reportsTo !== null) {
      assert.ok(byId.has(cur.reportsTo), `${cur.id} reports to unknown ${cur.reportsTo}`);
      cur = byId.get(cur.reportsTo);
      hops += 1;
      assert.ok(hops <= ROLE_CATALOG.length, `${r.id}: cycle`);
    }
  }
});

test('every phase has at least one employee responsible for it', () => {
  for (const phase of PHASES) {
    assert.ok(ROLE_CATALOG.some((r) => r.phases.includes(phase)), phase);
  }
});

test('every role has an agent definition file named after it', () => {
  for (const id of ROLE_IDS) {
    const file = join(AGENTS_DIR, `${id}.md`);
    assert.ok(existsSync(file), `agents/${id}.md missing`);
    assert.match(readFileSync(file, 'utf8'), new RegExp(`^name: teamforge-${id}$`, 'm'));
  }
});

test('a session created before a role existed still shows the full roster', () => {
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'tf-roles-')), 'old.db'));
  const s = db.createSession({ project_path: '/p/old' });
  const before = db.snapshot(s.id).agents.length;
  db.upsertAgent(s.id, 'legacy-role', 'working', 'from an older version');
  const agents = db.roster(s.id);
  assert.equal(agents.length, before + 1);
  assert.deepEqual(agents.slice(0, ROLE_IDS.length).map((a) => a.role), ROLE_IDS);
  assert.equal(agents.at(-1).role, 'legacy-role');
});

let server; let base;
before(async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'tf-roles-api-')), 'api.db');
  ({ server } = createTeamforgeServer({ dbPath }));
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('GET /api/roles returns departments and the role catalog', async () => {
  const res = await fetch(`${base}/api/roles`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.roles.length, ROLE_CATALOG.length);
  assert.deepEqual(body.departments.map((d) => d.id), DEPARTMENTS.map((d) => d.id));
});
