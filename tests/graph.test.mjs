import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGraph, createGraphs, graphFile, serveGraph } from '../worker/agent/graph.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'tf-graph-'));
const later = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((r) => { setTimeout(r, 5); });

// a build that writes the map file when the test lets it finish
function fakeBuild() {
  const calls = [];
  const build = (project, dir) => {
    const done = later();
    calls.push({ project, dir, finish: (ok = true) => {
      if (ok) { mkdirSync(join(dir, 'graphify-out'), { recursive: true }); writeFileSync(graphFile(dir), '{}'); }
      done.resolve(ok ? { ok: true, file: graphFile(dir), nodes: 10, edges: 20 } : { ok: false, error: 'boom' });
    } });
    return done.promise;
  };
  return { build, calls };
}
function fakeServe() {
  const servers = [];
  const serve = (file) => {
    const ready = later();
    const s = { file, stopped: false, ready: ready.promise, stop() { s.stopped = true; }, up: (r = { url: 'http://127.0.0.1:1/mcp', key: 'k' }) => ready.resolve(r) };
    servers.push(s);
    return s;
  };
  return { serve, servers };
}

test('a small project: mapped and loaded while the first question waits', async () => {
  const { build, calls } = fakeBuild(); const { serve, servers } = fakeServe();
  const graphs = createGraphs({ build, serve, wait: 1000 });
  const dir = tmp();
  const pending = graphs.prepare('/p', dir);
  await tick(); calls[0].finish();
  await tick(); servers[0].up();
  const r = await pending;
  assert.deepEqual(r, { graph: { url: 'http://127.0.0.1:1/mcp', key: 'k' }, ok: true, line: 'mapped the code: 10 symbols, 20 links' });
  assert.equal(servers[0].file, graphFile(dir));

  const again = await graphs.prepare('/p', dir);
  assert.equal(calls.length, 1, 'a fresh map is not rebuilt');
  assert.equal(servers.length, 1, 'the server stays up between questions');
  assert.equal(again.line, 'uses the map of the code: 10 symbols, 20 links');
  assert.match(graphs.status('/p'), /mapped with graphify \(10 symbols\)/);
});

test('a large project: the question goes on without the map, which keeps building and loading', async () => {
  const { build, calls } = fakeBuild(); const { serve, servers } = fakeServe();
  const graphs = createGraphs({ build, serve, wait: 20 });
  const dir = tmp();
  const first = await graphs.prepare('/big', dir);
  assert.deepEqual([first.graph, first.ok], [null, true]);
  assert.match(first.line, /in the background/);
  assert.match(graphs.status('/big'), /is mapping/);
  const second = await graphs.prepare('/big', dir);
  assert.equal(calls.length, 1, 'one build at a time');
  assert.match(second.line, /in the background/);

  calls[0].finish(); await tick();
  const loading = await graphs.prepare('/big', dir);
  assert.match(loading.line, /loading the code map/);
  servers[0].up();
  assert.ok((await graphs.prepare('/big', dir)).graph);
  assert.equal(servers.length, 1);
});

test('a map left by an earlier worker is used at once; an old one is updated in the background', async () => {
  const dir = tmp();
  mkdirSync(join(dir, 'graphify-out'), { recursive: true });
  writeFileSync(graphFile(dir), '{}');
  const { build, calls } = fakeBuild(); const { serve, servers } = fakeServe();
  let clock = Date.now();
  const graphs = createGraphs({ build, serve, wait: 50, fresh: 1000, now: () => clock });
  const pending = graphs.prepare('/p', dir);
  await tick(); servers[0].up();
  const r = await pending;
  assert.ok(r.graph);
  assert.equal(r.line, 'uses the map of the code');
  assert.equal(calls.length, 0);

  clock += 5000;
  const old = await graphs.prepare('/p', dir);
  assert.ok(old.graph, 'the old map serves while the new one is built');
  assert.equal(calls.length, 1);
  assert.match(graphs.status('/p'), /being brought up to date/);
});

test('failures are said, and a server that cannot start is tried again next time', async () => {
  const { build, calls } = fakeBuild(); const { serve, servers } = fakeServe();
  const graphs = createGraphs({ build, serve, wait: 1000 });
  const dir = tmp();
  const pending = graphs.prepare('/p', dir);
  await tick(); calls[0].finish(false);
  assert.deepEqual(await pending, { graph: null, ok: false, line: 'no code map — boom' });

  const dir2 = tmp();
  const p2 = graphs.prepare('/q', dir2);
  await tick(); calls[1].finish();
  await tick(); servers[0].up({ error: 'graphify needs its MCP extra' });
  assert.deepEqual(await p2, { graph: null, ok: false, line: 'no code map — graphify needs its MCP extra' });
  await tick();
  const p3 = graphs.prepare('/q', dir2);
  await tick(); servers[1].up();
  assert.ok((await p3).graph);
});

test('a server nobody uses is stopped, and stopAll stops them all', async () => {
  const dir = tmp();
  mkdirSync(join(dir, 'graphify-out'), { recursive: true });
  writeFileSync(graphFile(dir), '{}');
  const { serve, servers } = fakeServe();
  const graphs = createGraphs({ build: fakeBuild().build, serve, wait: 50, idle: 30 });
  const pending = graphs.prepare('/p', dir);
  await tick(); servers[0].up(); await pending;
  await new Promise((r) => { setTimeout(r, 60); });
  assert.equal(servers[0].stopped, true);
  const p2 = graphs.prepare('/p', dir);
  await tick(); servers[1].up(); await p2;
  graphs.stopAll();
  assert.equal(servers[1].stopped, true);
});

test('buildGraph: code only, and everything graphify writes stays out of the project', async () => {
  const t = tmp();
  const fake = join(t, 'graphify');
  writeFileSync(fake, `#!/bin/sh\necho "$@" > "${t}/args"\necho "$GRAPHIFY_OUT" > "${t}/out"\nmkdir -p "$GRAPHIFY_OUT" && echo '{}' > "$GRAPHIFY_OUT/graph.json"\necho "wrote graph.json: 12 nodes, 34 edges, 2 communities"\n`);
  chmodSync(fake, 0o755);
  const p = tmp(); const dir = join(t, 'data');
  assert.deepEqual(await buildGraph(p, dir, { bin: fake }), { ok: true, file: graphFile(dir), nodes: 12, edges: 34 });
  assert.equal(readFileSync(join(t, 'args'), 'utf8').trim(), `extract ${p} --code-only --out ${dir}`);
  assert.equal(readFileSync(join(t, 'out'), 'utf8').trim(), join(dir, 'graphify-out'));
  const missing = await buildGraph(p, dir, { bin: join(t, 'nope') });
  assert.deepEqual([missing.ok, missing.missing], [false, true]);
  assert.match(missing.error, /not installed .*graphifyy\[mcp\]/);
});

test('serveGraph: on loopback with a key, ready when the port answers; says what is missing', async () => {
  const t = tmp();
  const fake = join(t, 'graphify-mcp');
  // a stand-in server: records its arguments, then listens on the port it was given
  writeFileSync(fake, `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(join(t, 'args'))}, process.argv.slice(2).join(' '));
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
require('net').createServer(() => {}).listen(port, '127.0.0.1');
`);
  chmodSync(fake, 0o755);
  const s = serveGraph('/data/graphify-out/graph.json', { bin: fake });
  const r = await s.ready;
  assert.match(r.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  assert.match(r.key, /^[0-9a-f]{48}$/);
  const args = readFileSync(join(t, 'args'), 'utf8');
  assert.match(args, new RegExp(`^--graph /data/graphify-out/graph.json --transport http --host 127\\.0\\.0\\.1 --port \\d+ --api-key ${r.key}$`));
  s.stop();

  assert.match((await serveGraph('/x', { bin: join(t, 'nope') }).ready).error, /graphify-mcp is not installed/);
  const noExtra = join(t, 'old-graphify-mcp');
  writeFileSync(noExtra, '#!/bin/sh\necho \'ImportError: mcp not installed. Run: pip install "graphifyy[mcp]"\' >&2\nexit 1\n');
  chmodSync(noExtra, 0o755);
  assert.match((await serveGraph('/x', { bin: noExtra }).ready).error, /needs its MCP extra/);
});
