// The code map of a project, built with the graphify CLI, so a spike starts from a
// map instead of searching blind: which functions call which, what a module
// contains, how an entry point reaches a rule. Code only — a local AST pass, no
// LLM, no API key — and kept in TeamForge's data directory: nothing is written in
// the project.
//
// Sizes decide the design. Measured on 0.9.47:
//   TeamForge (76 files)          build 6 s, update 2 s,     a CLI query < 1 s
//   orme-medication (9.7k files)  build 7.5 min, update 4.5 min (368 MB graph),
//                                 a CLI query 13–65 s: every call reloads the graph
// So the map is built in the background, never in the way of a question, and read
// through graphify's MCP server, which keeps it in memory (42 s to load the big one,
// then 0.1–1 s a query) and reloads it by itself when a rebuild rewrites the file.
// One server per project, on loopback with a key, stopped when the spikes go quiet.

import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { dirname, join } from 'node:path';

export const graphFile = (dir) => join(dir, 'graphify-out', 'graph.json');

// The MCP server and the tools the team may use: the ones that read the map. Not
// get_community (numbered clusters, no names in a code-only map) nor the PR tools,
// which go to GitHub.
export const GRAPH_SERVER = 'codegraph';
export const GRAPH_TOOLS = ['query_graph', 'get_node', 'get_neighbors', 'shortest_path', 'god_nodes', 'graph_stats'];
export const graphTools = () => GRAPH_TOOLS.map((t) => `${GRAPH_SERVER}(${t})`);

const INSTALL = "uv tool install --force 'graphifyy[mcp]'";

// Builds (or brings up to date: graphify re-reads only the files that changed) the
// map of `project` into `dir`. Resolves { ok, file, nodes, edges } or { ok: false, missing, error }.
export function buildGraph(project, dir, { bin = 'graphify', timeout = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    // --out alone is not enough: graphify still writes a stat cache to <project>/graphify-out
    // (0.9.47). An absolute GRAPHIFY_OUT sends everything to TeamForge's directory.
    const env = { ...process.env, GRAPHIFY_OUT: join(dir, 'graphify-out') };
    execFile(bin, ['extract', project, '--code-only', '--out', dir], { timeout, maxBuffer: 4 << 20, env }, (err, stdout, stderr) => {
      const out = `${stdout}\n${stderr}`;
      const file = graphFile(dir);
      if (err || !existsSync(file)) {
        const missing = err?.code === 'ENOENT';
        return resolve({ ok: false, missing, error: missing ? `graphify is not installed (${INSTALL})` : (out.trim().split('\n').at(-1) || String(err?.message || err)).slice(0, 300) });
      }
      const m = /(\d+) nodes, (\d+) edges/.exec(out);
      resolve({ ok: true, file, nodes: m ? Number(m[1]) : null, edges: m ? Number(m[2]) : null });
    });
  });
}

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const answers = (port) => new Promise((resolve) => {
  const c = connect(port, '127.0.0.1');
  c.once('connect', () => { c.destroy(); resolve(true); });
  c.once('error', () => resolve(false));
});
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// Starts graphify's MCP server on `file`. → { ready: Promise<{ url, key } | { error }>, stop() }.
// The port answers once the map is loaded.
export function serveGraph(file, { bin = 'graphify-mcp' } = {}) {
  const key = randomBytes(24).toString('hex');
  let proc = null; let gone = null; let log = '';
  const ready = (async () => {
    const port = await freePort();
    proc = spawn(bin, ['--graph', file, '--transport', 'http', '--host', '127.0.0.1', '--port', String(port), '--api-key', key], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, GRAPHIFY_OUT: dirname(file) }, // a stamp it may keep goes next to the map
    });
    proc.stderr.on('data', (d) => { log = `${log}${d}`.slice(-2000); });
    proc.once('error', (err) => { gone = err.code === 'ENOENT' ? `graphify-mcp is not installed (${INSTALL})` : String(err.message); });
    proc.once('exit', () => { gone ??= /mcp not installed|needs the mcp extra/.test(log) ? `graphify needs its MCP extra (${INSTALL})` : (log.trim().split('\n').at(-1) || 'the graphify server stopped').slice(0, 300); });
    for (;;) {
      if (gone) return { error: gone };
      if (await answers(port)) return { url: `http://127.0.0.1:${port}/mcp`, key };
      await sleep(300);
    }
  })();
  return { ready, stop: () => { if (proc && !gone) { gone = 'stopped'; proc.kill(); } } };
}

// The copilot --additional-mcp-config of a turn: the server, and only the tools that read.
export function writeGraphConfig(file, { url, key }) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({
    mcpServers: { [GRAPH_SERVER]: { type: 'http', url, headers: { 'X-API-Key': key }, tools: GRAPH_TOOLS } },
  }), { mode: 0o600 });
  return `@${file}`;
}

// The maps of all projects. `prepare` is called when a spike turn starts: it waits a
// little (a small project is mapped and loaded in seconds) and otherwise lets the
// turn go on without the map, which keeps building or loading for the next question.
export function createGraphs({
  build = buildGraph, serve = serveGraph,
  wait = 20 * 1000,         // how long a question waits for the map
  fresh = 60 * 60 * 1000,   // a map older than this is brought up to date, in the background
  idle = 30 * 60 * 1000,    // a server nobody used for this long is stopped
  now = Date.now,
} = {}) {
  const maps = new Map(); // project → { dir, file, nodes, edges, builtAt, building, error, server, timer }
  const within = (promise) => Promise.race([promise, sleep(wait).then(() => undefined)]);

  function stop(m) {
    m.server?.stop();
    m.server = null;
    clearTimeout(m.timer);
  }

  async function prepare(project, dir) {
    let m = maps.get(project);
    if (!m) { m = { dir }; maps.set(project, m); }
    // a map left by an earlier run of the worker
    if (!m.file && existsSync(graphFile(dir))) { m.file = graphFile(dir); m.builtAt = statSync(m.file).mtimeMs; }

    let built = null; // set when a build finished during this call: worth telling the client
    if ((!m.file || now() - m.builtAt > fresh) && !m.building) {
      m.building = build(project, dir).then((r) => {
        if (r.ok) Object.assign(m, { file: r.file, nodes: r.nodes, edges: r.edges, builtAt: now(), error: null });
        else Object.assign(m, { error: r.error, builtAt: m.file ? now() : m.builtAt }); // a failed update keeps the old map, retried later
        return r;
      }).finally(() => { m.building = null; });
    }
    if (!m.file) {
      const r = await within(m.building);
      if (!r) return { graph: null, ok: true, line: 'is mapping the code in the background — a large project takes a few minutes; the next questions will use the map' };
      if (!r.ok) return { graph: null, ok: false, line: `no code map — ${r.error}` };
      built = r;
    }

    if (!m.server) {
      const server = serve(m.file);
      m.server = server;
      server.ready.then((r) => { if (r?.error && m.server === server) { m.error = r.error; m.server = null; } });
    }
    clearTimeout(m.timer);
    m.timer = setTimeout(() => stop(m), idle);
    m.timer.unref?.();
    const r = await within(m.server.ready);
    if (!r) return { graph: null, ok: true, line: 'is loading the code map — a large project takes about a minute; the next questions will use it' };
    if (r.error) return { graph: null, ok: false, line: `no code map — ${r.error}` };
    const size = built ?? m;
    return {
      graph: r, ok: true,
      line: size.nodes != null ? `${built ? 'mapped' : 'uses the map of'} the code: ${size.nodes} symbols, ${size.edges} links` : 'uses the map of the code',
    };
  }

  // For /status and the mode reply.
  function status(project) {
    const m = maps.get(project);
    if (!m) return 'the code is mapped with graphify on the first question';
    if (!m.file) return m.building ? 'graphify is mapping the code' : `no code map (${m.error})`;
    return `the code is mapped with graphify${m.nodes != null ? ` (${m.nodes} symbols)` : ''}${m.building ? ', being brought up to date' : ''}`;
  }

  const stopAll = () => { for (const m of maps.values()) stop(m); };
  return { prepare, status, stopAll };
}

// How the team uses it: given to the spike's briefing.
export const graphBriefing = () => `## The code map
A map of this project's code is loaded: the \`${GRAPH_SERVER}\` tools (files,
functions, classes and who calls or imports whom, each with its file and line).
Start every investigation there — it is much cheaper than reading files at random —
then read the code it points to.
- \`query_graph\` — \`question\`: the client's words and the likely code terms, \`token_budget\` 1500 — the area of the code a question is about
- \`get_node\` / \`get_neighbors\` — \`label\`: a symbol — where it is, what calls it, what it calls
- \`shortest_path\` — \`source\`, \`target\` — how a screen or entry point reaches a rule
- \`god_nodes\` — the hubs of the code, to get your bearings
The map knows structure, not behaviour: a rule is only established once you have
read the code that carries it.
`;
