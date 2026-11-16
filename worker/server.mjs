// TeamForge worker: HTTP API + SSE + dashboard static serving.
// Zero runtime dependencies — node:http + node:sqlite.

import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, DEFAULT_DB_PATH } from './db.mjs';
import { canTransition, gateAllowsWrite } from './state-machine.mjs';
import { DEPARTMENTS, ROLE_CATALOG } from './roles.mjs';
import { createAuth, loadOrCreateToken } from './auth.mjs';
import { resolveProvider } from './config.mjs';
import { ChatError, createChat } from './agent/chat.mjs';
import { otherMcpServers } from './providers/copilot.mjs';
import { COMMANDS } from './agent/commands.mjs';
import { charter, skill } from './agent/skills.mjs';
import { createBridge } from './browser/bridge.mjs';
import { TOOL_NAMES } from './browser/tools.mjs';
import { DocError, listDocs, readDoc, writeDoc } from './docs.mjs';
import { AttachmentError, MAX_IMAGES, MAX_IMAGE_BYTES, readAttachment } from './attachments.mjs';

export const PORT = 4519;
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const DIST = join(ROOT, 'dashboard', 'dist');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

// the largest request is a message with its images, sent as base64 (4/3 of their size)
const MAX_BODY_BYTES = Math.ceil(MAX_IMAGES * MAX_IMAGE_BYTES * 1.4) + 64 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > MAX_BODY_BYTES) { reject(new DocError(413, 'request too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// `token`: when set, every API call must carry it (always set by the real
// entry point below; tests of unrelated routes may leave it out).
export function createTeamforgeServer({
  dbPath = DEFAULT_DB_PATH, distDir = DIST, token = '', provider = resolveProvider, run,
  defaultProject = process.cwd(), attachDir = join(dirname(dbPath), 'attachments'),
} = {}) {
  const db = openDb(dbPath);
  const auth = token ? createAuth(token) : null;
  const sseClients = new Set(); // { res, project }
  const bridge = createBridge(); // commands for the TeamForge Chrome extension
  const briefed = new Set(); // agent conversation + role: charters already handed out

  // The dashboard tab a request speaks for: each one has its own session.
  const tabOf = (value) => (/^[\w-]{1,40}$/.test(String(value ?? '')) ? String(value) : '');

  function snapshotFor(project, tab = '') {
    // A page opened for a project only ever shows that project's missions.
    const session = project
      ? db.getActiveSession(project, tab) || db.getLatestSessionFor(project, tab)
      : db.getLatestSession();
    return session ? db.snapshot(session.id) : { empty: true };
  }

  function broadcast() {
    for (const client of sseClients) {
      client.res.write(`data: ${JSON.stringify(snapshotFor(client.project, client.tab))}\n\n`);
    }
  }

  // Chat traffic goes out as named SSE events, next to the default snapshots.
  // tab: the conversation's own tab; left out for what concerns the whole project (permissions, models).
  function emitChat(project, event, tab) {
    for (const client of sseClients) {
      if ((!client.project || client.project === project) && (tab === undefined || client.tab === tab)) {
        client.res.write(`event: chat\ndata: ${JSON.stringify({ project, ...event })}\n\n`);
      }
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
      return json(res, 200, { ok: true, version: VERSION });
    }

    // ---- the TeamForge Chrome extension ----
    // The dashboard page (which holds the worker's cookie) hands the extension its own, narrower token.
    if (req.method === 'GET' && pathname === '/api/bridge/pair') {
      return json(res, 200, { token: auth?.bridgeToken ?? '', version: VERSION });
    }
    if (req.method === 'GET' && pathname === '/api/bridge/status') {
      return json(res, 200, { connected: bridge.connected() });
    }
    // The agent's browser tool: do this in the client's Chrome, on the sites they allowed.
    if (req.method === 'POST' && pathname === '/api/bridge/call') {
      if (!TOOL_NAMES.includes(body.tool)) return json(res, 400, { ok: false, error: `unknown browser tool: ${body.tool}` });
      const sites = (db.getSetting(body.project_path || '', 'browser') || '').split(' ').filter(Boolean);
      if (!sites.length) return json(res, 200, { ok: false, error: 'The client has not allowed any site: they do it with /browser <url>.' });
      return json(res, 200, await bridge.call({ tool: body.tool, args: body.args || {}, sites }, body.timeout_ms || 60_000));
    }
    // The extension: next command (long poll), and its outcome.
    if (req.method === 'GET' && pathname === '/api/bridge/poll') {
      const command = await bridge.poll(Number(url.searchParams.get('wait')) || 20_000);
      if (!command) { res.writeHead(204); return res.end(); }
      return json(res, 200, command);
    }
    if (req.method === 'POST' && pathname === '/api/bridge/result') {
      const { id, ...outcome } = body;
      return json(res, 200, { accepted: bridge.result(id, outcome) });
    }

    if (req.method === 'GET' && pathname === '/api/provider') {
      const project = url.searchParams.get('project') || db.getLatestSession()?.project_path || defaultProject;
      return json(res, 200, { ...provider(), model: chat.model(project), project, commands: COMMANDS });
    }

    if (req.method === 'PUT' && pathname === '/api/models') {
      return json(res, 200, { models: chat.setModel(body.project_path, body.role ?? null, body.model ?? null) });
    }

    if (req.method === 'GET' && (m = pathname.match(/^\/api\/attachments\/(.+)$/))) {
      const { content, type } = readAttachment(attachDir, decodeURIComponent(m[1]));
      res.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=86400' });
      return res.end(content);
    }

    if (req.method === 'GET' && pathname === '/api/docs') {
      return json(res, 200, { docs: listDocs(url.searchParams.get('project') || '') });
    }

    if (req.method === 'GET' && pathname === '/api/docs/file') {
      return json(res, 200, readDoc(url.searchParams.get('project') || '', url.searchParams.get('path') || ''));
    }

    if (req.method === 'PUT' && pathname === '/api/docs/file') {
      const saved = writeDoc(body.project_path, body.path, body.content, body.base_rev ?? null);
      chat.docEdited(body.project_path, saved.path, tabOf(body.tab));
      return json(res, 200, saved);
    }

    if (req.method === 'GET' && pathname === '/api/chat') {
      return json(res, 200, chat.history(url.searchParams.get('project') || '', tabOf(url.searchParams.get('tab'))));
    }

    if (req.method === 'POST' && pathname === '/api/chat') {
      chat.send(body.project_path, body.text, body.images, tabOf(body.tab));
      return json(res, 202, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/chat/stop') {
      return json(res, 200, { stopped: chat.stop(body.project_path) });
    }

    if (req.method === 'POST' && pathname === '/api/grants') {
      chat.grant(body.project_path, body.program, tabOf(body.tab));
      return json(res, 201, { grants: db.listGrants(body.project_path) });
    }

    if (req.method === 'GET' && pathname === '/api/roles') {
      return json(res, 200, { departments: DEPARTMENTS, roles: ROLE_CATALOG });
    }

    if (req.method === 'GET' && (m = pathname.match(/^\/api\/validations\/(\d+)$/))) {
      const validation = db.getValidation(Number(m[1]));
      if (!validation) return json(res, 404, { error: 'validation not found' });
      return json(res, 200, { validation });
    }

    if (req.method === 'GET' && pathname === '/api/state') {
      return json(res, 200, snapshotFor(url.searchParams.get('project'), tabOf(url.searchParams.get('tab'))));
    }

    if (req.method === 'GET' && pathname === '/api/decisions') {
      const decisions = db.approvedDecisions(
        url.searchParams.get('project') || '',
        Number(url.searchParams.get('limit') || 20),
      );
      return json(res, 200, { decisions });
    }

    if (req.method === 'GET' && pathname === '/api/sessions') {
      return json(res, 200, { sessions: chat.sessions(url.searchParams.get('project') || '', tabOf(url.searchParams.get('tab'))) });
    }

    if (req.method === 'POST' && (m = pathname.match(/^\/api\/sessions\/(\d+)\/adopt$/))) {
      return json(res, 200, chat.adopt(body.project_path, Number(m[1]), tabOf(body.tab)));
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
      // A closed mission accepts no more reports, so nobody may be left "working".
      if (body.phase === 'done') {
        for (const a of db.roster(session.id)) {
          if (a.status === 'working' || a.status === 'blocked') db.upsertAgent(session.id, a.role, 'idle', '');
        }
      }
      broadcast();
      const playbook = skill(body.phase);
      return json(res, 200, playbook ? { session: updated, playbook } : { session: updated });
    }

    if (req.method === 'POST' && (m = pathname.match(/^\/api\/sessions\/(\d+)\/agents$/))) {
      const agent = db.upsertAgent(Number(m[1]), body.role, body.status, body.note || '');
      db.addEvent(Number(m[1]), 'agent', { role: body.role, status: body.status, note: body.note || '' });
      broadcast();
      // the charter goes out once per agent conversation (again after /clear)
      const key = `${db.getSession(Number(m[1]))?.agent_session}:${body.role}`;
      const text = body.status === 'working' && !briefed.has(key) ? charter(body.role) : '';
      if (text) briefed.add(key);
      return json(res, 200, text ? { agent, charter: text } : { agent });
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
      const result = db.answerValidation(Number(m[1]), body.status, body.answer || '');
      if (result.error === 'not_found') return json(res, 404, { error: 'validation not found' });
      if (result.error === 'already_answered') {
        return json(res, 409, { error: 'validation already answered', validation: result.validation });
      }
      const { validation } = result;
      db.addEvent(validation.session_id, 'validation', { gate: validation.gate, status: body.status });
      broadcast();
      chat.validationAnswered(validation);
      return json(res, 200, { validation });
    }

    if (req.method === 'POST' && (m = pathname.match(/^\/api\/sessions\/(\d+)\/events$/))) {
      const event = db.addEvent(Number(m[1]), body.kind || 'note', body.payload || {});
      broadcast();
      return json(res, 201, { event });
    }

    if (req.method === 'POST' && pathname === '/api/gate-check') {
      const session = db.getActiveSession(body.project_path || '', tabOf(body.tab));
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
      const headers = { 'content-type': MIME[extname(file)] || 'application/octet-stream' };
      // Opening the dashboard is what hands the browser its API token.
      if (auth && extname(file) === '.html') headers['set-cookie'] = auth.cookie;
      res.writeHead(200, headers);
      res.end(content);
    } catch {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>TeamForge</h1><p>Dashboard not built yet. Run <code>npm run build</code> in <code>dashboard/</code>.</p>');
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (auth) {
        const needsToken = url.pathname === '/events'
          || (url.pathname.startsWith('/api/') && url.pathname !== '/api/health');
        const fromExtension = url.pathname === '/api/bridge/poll' || url.pathname === '/api/bridge/result';
        const origin = fromExtension ? { ok: true } : auth.checkOrigin(req);
        const verdict = fromExtension ? auth.checkBridge(req) : origin.ok && needsToken ? auth.checkToken(req) : origin;
        if (!verdict.ok) return json(res, verdict.status, { error: verdict.error });
      }
      if (url.pathname === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const client = { res, project: url.searchParams.get('project'), tab: tabOf(url.searchParams.get('tab')) };
        sseClients.add(client);
        res.write(`data: ${JSON.stringify(snapshotFor(client.project, client.tab))}\n\n`);
        req.on('close', () => sseClients.delete(client));
        return;
      }
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return await serveStatic(res, url.pathname);
    } catch (err) {
      if (err instanceof ChatError) return json(res, err.status, { error: err.message });
      if (err instanceof DocError) return json(res, err.status, { error: err.message, rev: err.rev });
      if (err instanceof AttachmentError) return json(res, err.status, { error: err.message });
      return json(res, 500, { error: String(err?.message || err) });
    }
  });

  const chat = createChat({
    db, broadcast, emit: emitChat, provider, run, token, attachDir,
    extensionConnected: () => bridge.connected(),
    // only the real provider is asked; a test's stand-in agent has no servers to list
    otherMcp: run ? async () => [] : () => otherMcpServers(),
    binDir: join(ROOT, 'worker', 'bin'),
    baseUrl: () => `http://127.0.0.1:${server.address().port}`,
  });
  server.on('close', () => { chat.stopAll(); bridge.stop(); });

  return { server, db, chat, bridge };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createTeamforgeServer({
    token: loadOrCreateToken(dirname(DEFAULT_DB_PATH)),
    defaultProject: process.env.TEAMFORGE_PROJECT || process.cwd(),
  });
  server.listen(PORT, '127.0.0.1', () => {
    // lets a newer `teamforge` launcher replace this worker after an upgrade
    writeFileSync(join(dirname(DEFAULT_DB_PATH), 'worker.pid'), String(process.pid));
    console.log(`TeamForge worker on http://127.0.0.1:${PORT}`);
  });
}
