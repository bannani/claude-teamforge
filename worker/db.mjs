// SQLite storage layer (node:sqlite, zero deps). One connection per process.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROLES } from './state-machine.mjs';

export const DEFAULT_DB_PATH = join(homedir(), '.claude-teamforge', 'teamforge.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY, project_path TEXT NOT NULL,
 project_name TEXT, title TEXT, phase TEXT NOT NULL DEFAULT 'idea',
 created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS agents(id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL,
 role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'idle', note TEXT DEFAULT '',
 updated_at TEXT DEFAULT (datetime('now')), UNIQUE(session_id, role));
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL,
 title TEXT NOT NULL, role TEXT, status TEXT NOT NULL DEFAULT 'todo', ord INTEGER DEFAULT 0,
 created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, session_id INTEGER, ts TEXT
 DEFAULT (datetime('now')), kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS decisions(id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL,
 project_path TEXT NOT NULL, title TEXT NOT NULL, detail TEXT DEFAULT '',
 status TEXT NOT NULL DEFAULT 'proposed', ts TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS validations(id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL,
 gate TEXT NOT NULL, question TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 answer TEXT DEFAULT '', ts TEXT DEFAULT (datetime('now')));
`;

export function openDb(path = DEFAULT_DB_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec(SCHEMA);

  const touch = (id) => db.prepare(
    "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?",
  ).run(id);

  return {
    createSession({ project_path, project_name = '', title = '' }) {
      const { lastInsertRowid: id } = db.prepare(
        'INSERT INTO sessions(project_path, project_name, title) VALUES(?,?,?)',
      ).run(project_path, project_name, title);
      const seed = db.prepare('INSERT INTO agents(session_id, role) VALUES(?,?)');
      for (const role of ROLES) seed.run(id, role);
      return this.getSession(Number(id));
    },

    getSession(id) {
      return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    },

    getActiveSession(project_path) {
      return db.prepare(
        "SELECT * FROM sessions WHERE project_path = ? AND phase != 'done' ORDER BY id DESC LIMIT 1",
      ).get(project_path);
    },

    getLatestSession() {
      return db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC, id DESC LIMIT 1').get();
    },

    setPhase(id, phase) {
      db.prepare("UPDATE sessions SET phase = ?, updated_at = datetime('now') WHERE id = ?").run(phase, id);
      return this.getSession(id);
    },

    upsertAgent(session_id, role, status, note = '') {
      db.prepare(`INSERT INTO agents(session_id, role, status, note) VALUES(?,?,?,?)
        ON CONFLICT(session_id, role) DO UPDATE SET status = excluded.status,
        note = excluded.note, updated_at = datetime('now')`).run(session_id, role, status, note);
      touch(session_id);
      return db.prepare('SELECT * FROM agents WHERE session_id = ? AND role = ?').get(session_id, role);
    },

    addTask(session_id, title, role = null) {
      const ord = db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE session_id = ?').get(session_id).n;
      const { lastInsertRowid: id } = db.prepare(
        'INSERT INTO tasks(session_id, title, role, ord) VALUES(?,?,?,?)',
      ).run(session_id, title, role, ord);
      touch(session_id);
      return db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id));
    },

    updateTask(id, status) {
      db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
      return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    },

    addEvent(session_id, kind, payload = {}) {
      const { lastInsertRowid: id } = db.prepare(
        'INSERT INTO events(session_id, kind, payload) VALUES(?,?,?)',
      ).run(session_id, kind, JSON.stringify(payload));
      return db.prepare('SELECT * FROM events WHERE id = ?').get(Number(id));
    },

    addDecision(session_id, project_path, title, detail = '') {
      const { lastInsertRowid: id } = db.prepare(
        'INSERT INTO decisions(session_id, project_path, title, detail) VALUES(?,?,?,?)',
      ).run(session_id, project_path, title, detail);
      touch(session_id);
      return db.prepare('SELECT * FROM decisions WHERE id = ?').get(Number(id));
    },

    updateDecision(id, status) {
      db.prepare('UPDATE decisions SET status = ? WHERE id = ?').run(status, id);
      return db.prepare('SELECT * FROM decisions WHERE id = ?').get(id);
    },

    addValidation(session_id, gate, question) {
      const { lastInsertRowid: id } = db.prepare(
        'INSERT INTO validations(session_id, gate, question) VALUES(?,?,?)',
      ).run(session_id, gate, question);
      touch(session_id);
      return db.prepare('SELECT * FROM validations WHERE id = ?').get(Number(id));
    },

    getValidation(id) {
      return db.prepare('SELECT * FROM validations WHERE id = ?').get(id);
    },

    answerValidation(id, status, answer = '') {
      db.prepare('UPDATE validations SET status = ?, answer = ? WHERE id = ?').run(status, answer, id);
      const v = db.prepare('SELECT * FROM validations WHERE id = ?').get(id);
      touch(v.session_id);
      return v;
    },

    hasApprovedValidation(session_id, gate) {
      return !!db.prepare(
        "SELECT id FROM validations WHERE session_id = ? AND gate = ? AND status = 'approved' LIMIT 1",
      ).get(session_id, gate);
    },

    approvedDecisions(project_path, limit = 20) {
      return db.prepare(
        "SELECT * FROM decisions WHERE project_path = ? AND status = 'approved' ORDER BY id DESC LIMIT ?",
      ).all(project_path, limit);
    },

    snapshot(session_id) {
      const session = this.getSession(session_id);
      if (!session) return { empty: true };
      const events = db.prepare(
        'SELECT * FROM events WHERE session_id = ? ORDER BY id DESC LIMIT 100',
      ).all(session_id).map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
      const files = [...new Set(
        events.filter((e) => e.kind === 'file' && e.payload.file).map((e) => e.payload.file),
      )];
      return {
        session,
        agents: db.prepare('SELECT * FROM agents WHERE session_id = ? ORDER BY id').all(session_id),
        tasks: db.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY ord, id').all(session_id),
        validations: db.prepare('SELECT * FROM validations WHERE session_id = ? ORDER BY id').all(session_id),
        decisions: db.prepare('SELECT * FROM decisions WHERE session_id = ? ORDER BY id').all(session_id),
        events,
        files,
      };
    },

    close() { db.close(); },
  };
}
