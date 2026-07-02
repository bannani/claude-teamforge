// TeamForge worker: HTTP API + SSE + dashboard static serving.
// Zero runtime dependencies — node:http + node:sqlite.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, DEFAULT_DB_PATH } from './db.mjs';
import { canTransition, gateAllowsWrite } from './state-machine.mjs';

export const PORT = 4519;
const DIST = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dashboard', 'dist');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

export function createTeamforgeServer({ dbPath = DEFAULT_DB_PATH, distDir = DIST } = {}) {
  const db = openDb(dbPath);
  const sseClients = new Set(); // { res, project }

  function snapshotFor(project) {
    const session = (project && db.getActiveSession(project)) || db.getLatestSession();
    return session ? db.snapshot(session.id) : { empty: true };
  }

  function broadcast() {
    for (const client of sseClients) {
      client.res.write(`data: ${JSON.stringify(snapshotFor(client.project))}\n\n`);
    }
  }

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  async function handleApi(req, res, url) {
    const { pathname } = url;
    const body = req.method === 'GET' ? {} : await readBody(req);
    let m;

    if (req.method === 'GET' && pathname === '/api/health') {
      return json(res, 200, { ok: true, version: '0.2.0' });
    }

    if (req.method === 'GET' && (m = pathname.match(/^\/api\/validations\/(\d+)$/))) {
      const validation = db.getValidation(Number(m[1]));
      if (!validation) return json(res, 404, { error: 'validation not found' });
      return json(res, 200, { validation });
    }

    if (req.method === 'GET' && pathname === '/api/state') {
      return json(res, 200, snapshotFor(url.searchParams.get('project')));
    }

    if (req.method === 'GET' && pathname === '/api/decisions') {
      const decisions = db.approvedDecisions(
        url.searchParams.get('project') || '',
        Number(url.searchParams.get('limit') || 20),
      );
      return json(res, 200, { decisions });
    }

    if (req.method === 'POST' && pathname === '/api/sessions') {
      if (!body.project_path) return json(res, 400, { error: 'project_path required' });
      const session = db.createSession(body);
      db.addEvent(session.id, 'phase', { phase: 'idea', title: body.title });
      broadcast();
      return json(res, 201, { session });
    }

    if (req.method === 'POST' && (m = pathname.match(/^\/api\/sessions\/(\d+)\/phase$/))) {
      const session = db.getSession(Number(m[1]));
      if (!session) return json(res, 404, { error: 'session not found' });
      const gateApproved = db.hasApprovedValidation(session.id, session.phase);
      const check = canTransition(session.phase, body.phase, { gateApproved });
      if (!check.ok) return json(res, 409, { error: check.reason });
      const updated = db.setPhase(session.id, body.phase);
      db.addEvent(session.id, 'phase', { from: session.phase, to: body.phase });
      broadcast();
      return json(res, 200, { session: updated });
    }

    if (req.method === 'POST' && (m = pathname.match(/^\/api\/sessions\/(\d+)\/agents$/))) {
      const agent = db.upsertAgent(Number(m[1]), body.role, body.status, body.note || '');
      db.addEvent(Number(m[1]), 'agent', { role: body.role, status: body.status, note: body.note || '' });
      broadcast();
      return json(res, 200, { agent });
    }

    if (req.method === 'POST' && (m = pathname.match(/^\/api\/sessions\/(\d+)\/tasks$/))) {
      const task = db.addTask(Number(m[1]), body.title, body.role || null);
      db.addEvent(Number(m[1]), 'task', { task: body.title, role: body.role, status: 'todo' });
      broadcast();
      return json(res, 201, { task });
    }

    if (req.method === 'PATCH' && (m = pathname.match(/^\/api\/tasks\/(\d+)$/))) {
      const task = db.updateTask(Number(m[1]), body.status);
      if (!task) return json(res, 404, { error: 'task not found' });
      db.addEvent(task.session_id, 'task', { task: task.title, status: body.status });
      broadcast();
      return json(res, 200, { task });
    }

    if (req.method === 'POST' && (m = pathname.match(/^\/api\/sessions\/(\d+)\/decisions$/))) {
      const session = db.getSession(Number(m[1]));
      if (!session) return json(res, 404, { error: 'session not found' });
      const decision = db.addDecision(session.id, session.project_path, body.title, body.detail || '');
      db.addEvent(session.id, 'decision', { title: body.title, status: 'proposed' });
      broadcast();
      return json(res, 201, { decision });
    }

    if (req.method === 'PATCH' && (m = pathname.match(/^\/api\/decisions\/(\d+)$/))) {
      const decision = db.updateDecision(Number(m[1]), body.status);
      if (!decision) return json(res, 404, { error: 'decision not found' });
      db.addEvent(decision.session_id, 'decision', { title: decision.title, status: body.status });
      broadcast();
      return json(res, 200, { decision });
    }

    if (req.method === 'POST' && (m = pathname.match(/^\/api\/sessions\/(\d+)\/validations$/))) {
      const validation = db.addValidation(Number(m[1]), body.gate, body.question);
      db.addEvent(Number(m[1]), 'validation', { gate: body.gate, question: body.question, status: 'pending' });
      broadcast();
      return json(res, 201, { validation });
    }

    if (req.method === 'PATCH' && (m = pathname.match(/^\/api\/validations\/(\d+)$/))) {
      const validation = db.answerValidation(Number(m[1]), body.status, body.answer || '');
      db.addEvent(validation.session_id, 'validation', { gate: validation.gate, status: body.status });
      broadcast();
      return json(res, 200, { validation });
    }

    if (req.method === 'POST' && (m = pathname.match(/^\/api\/sessions\/(\d+)\/events$/))) {
      const event = db.addEvent(Number(m[1]), body.kind || 'note', body.payload || {});
      broadcast();
      return json(res, 201, { event });
    }

    if (req.method === 'POST' && pathname === '/api/gate-check') {
      const session = db.getActiveSession(body.project_path || '');
      if (!session) return json(res, 200, { allow: true, reason: 'no active workflow' });
      const verdict = gateAllowsWrite(session.phase, body.file_path || '');
      if (!verdict.allow) {
        db.addEvent(session.id, 'note', { text: `blocked write to ${body.file_path} (phase ${session.phase})` });
        broadcast();
      }
      return json(res, 200, verdict);
    }

    return json(res, 404, { error: `no route: ${req.method} ${pathname}` });
  }

  async function serveStatic(res, pathname) {
    const rel = normalize(pathname === '/' ? 'index.html' : pathname.slice(1));
    if (rel.startsWith('..')) { res.writeHead(403); return res.end(); }
    let file = join(distDir, rel);
    try { await stat(file); } catch { file = join(distDir, 'index.html'); }
    try {
      const content = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(content);
    } catch {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>TeamForge</h1><p>Dashboard not built yet. Run <code>npm run build</code> in <code>dashboard/</code>.</p>');
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const client = { res, project: url.searchParams.get('project') };
        sseClients.add(client);
        res.write(`data: ${JSON.stringify(snapshotFor(client.project))}\n\n`);
        req.on('close', () => sseClients.delete(client));
        return;
      }
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return await serveStatic(res, url.pathname);
    } catch (err) {
      return json(res, 500, { error: String(err?.message || err) });
    }
  });

  return { server, db };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createTeamforgeServer({});
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`TeamForge worker on http://127.0.0.1:${PORT}`);
  });
}
