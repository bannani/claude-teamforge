import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeamforgeServer } from '../worker/server.mjs';
import { buildArgs, toChatEvent } from '../worker/providers/copilot.mjs';
import { browserAction, browserConfig, needsHeadless, newScreenshots, parseOrigin, writeBrowserAgent, writeBrowserConfig } from '../worker/agent/browser.mjs';

const H = { 'content-type': 'application/json' };
const allowed = (args) => args.slice(args.indexOf('--allow-tool') + 1);
// the turn's MCP configuration is passed as "@file"
const configFile = (args) => (args.includes('--additional-mcp-config') ? args[args.indexOf('--additional-mcp-config') + 1].slice(1) : null);
const mcp = (args) => (configFile(args) ? JSON.parse(readFileSync(configFile(args), 'utf8')).mcpServers.browser : null);
const flag = (server, name) => server.args[server.args.indexOf(name) + 1];
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

test('parseOrigin: a site, with or without its scheme; nothing else', () => {
  assert.equal(parseOrigin('localhost:4200'), 'http://localhost:4200');
  assert.equal(parseOrigin('127.0.0.1:8080/app/login'), 'http://127.0.0.1:8080');
  assert.equal(parseOrigin('test.example.com'), 'https://test.example.com');
  assert.equal(parseOrigin('https://Test.Example.com/a?b=1'), 'https://test.example.com');
  for (const bad of ['', 'off course', 'file:///etc/passwd', 'javascript://x', 'http://', undefined]) assert.equal(parseOrigin(bad), null, String(bad));
});

test('no browser unless asked: no server, no rule', () => {
  const args = buildArgs({ prompt: 'p', sessionId: 's', writeOpen: true, allowAll: true });
  assert.equal(mcp(args), null);
  assert.ok(!allowed(args).includes('browser'));
});

test('with a browser: its tools are allowed, the dangerous ones denied, even read-only', () => {
  const args = buildArgs({ prompt: 'p', sessionId: 's', readOnly: true, browser: '@/data/mcp.json' });
  assert.equal(args[args.indexOf('--additional-mcp-config') + 1], '@/data/mcp.json');
  assert.deepEqual(args.slice(args.indexOf('--deny-tool') + 1, args.indexOf('--allow-tool')), ['browser(browser_run_code_unsafe)', 'browser(browser_file_upload)', 'browser(browser_evaluate)']);
  const tools = allowed(args);
  assert.ok(tools.includes('browser'));
  assert.deepEqual(tools.filter((t) => t.startsWith('write') || t === 'shell'), [], 'a spike stays read-only on the project');
  assert.equal(args.at(-tools.length - 1), '--allow-tool', 'the variadic option is still last');
});

const SITES = { profileDir: '/data/profile', outputDir: '/data/shots' };

test('a separate browser: one pinned server, its own profile', () => {
  const server = browserConfig({ ...SITES, kind: 'separate' }).mcpServers.browser;
  assert.match(server.args[1], /^@playwright\/mcp@\d+\.\d+\.\d+$/, 'a pinned version');
  assert.ok(!server.args.includes('--allowed-origins'), 'it would block the scripts and styles real pages load from other origins');
  assert.equal(flag(server, '--user-data-dir'), '/data/profile');
  assert.equal(flag(server, '--output-dir'), '/data/shots');
  assert.equal(server.cwd, '/data/shots', 'named screenshots stay out of the project');
  assert.ok(existsSync(flag(server, '--init-script')), 'the cursor the client sees is injected in every page');
  assert.ok(server.tools.includes('browser_click') && server.tools.includes('browser_take_screenshot'));
  assert.ok(!server.tools.some((t) => /unsafe|upload|evaluate/.test(t)) && !server.tools.includes('*'), 'nothing that runs code outside the page or reads local files');
  assert.ok(!server.args.includes('--headless') && !server.args.includes('--extension'));
  assert.ok(browserConfig({ ...SITES, kind: 'separate', headless: true }).mcpServers.browser.args.includes('--headless'));
});

test('the client\'s own Chrome: TeamForge\'s own tools, which reach the extension through the worker', () => {
  const server = browserConfig({ ...SITES, kind: 'own', url: 'http://127.0.0.1:4519', token: 'tok', project: '/p' }).mcpServers.browser;
  assert.equal(server.command, process.execPath);
  assert.ok(existsSync(server.args[0]) && server.args[0].endsWith('mcp.mjs'));
  assert.deepEqual(server.env, { TEAMFORGE_URL: 'http://127.0.0.1:4519', TEAMFORGE_TOKEN: 'tok', TEAMFORGE_PROJECT: '/p', TEAMFORGE_SHOTS: '/data/shots' });
  assert.ok(!JSON.stringify(server).includes('playwright'), 'no Playwright, no npx');
});

test('the configuration goes in a file only the user can read', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tf-mcp-')), 'sub', 'mcp.json');
  assert.equal(writeBrowserConfig(file, { ...SITES, kind: 'own', token: 'secret' }), `@${file}`);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).mcpServers.browser.env.TEAMFORGE_TOKEN, 'secret');
});

test('browserAction: what the team does reads as a sentence, and a typed password is never shown', () => {
  const act = (tool, args) => { const a = browserAction(`browser-browser_${tool}`, args); return `${a.verb} ${a.target}`.trim(); };
  assert.equal(act('navigate', { url: 'http://localhost:4200/login' }), 'opens http://localhost:4200/login');
  assert.equal(act('click', { element: 'Sign in button', ref: 'e12' }), 'clicks Sign in button');
  assert.equal(act('type', { element: 'Email field', text: 'po@example.com' }), 'types “po@example.com” in Email field');
  assert.equal(act('type', { element: 'Password field', text: 'hunter2' }), 'types •••••• in Password field');
  assert.equal(act('take_screenshot', {}), 'takes a screenshot');
  assert.equal(act('some_new_tool', {}), 'some new tool');
  assert.equal(browserAction('bash', { command: 'ls' }), null);
  const calls = new Map();
  const start = toChatEvent({ type: 'tool.execution_start', data: { toolCallId: 'c1', toolName: 'browser-browser_type', arguments: { element: 'Mot de passe', text: 'hunter2' } } }, calls);
  assert.equal(start.summary, 'types •••••• in Mot de passe');
  assert.ok(!JSON.stringify(start).includes('hunter2'));
  const end = toChatEvent({ type: 'tool.execution_complete', data: { toolCallId: 'c1', success: true } }, calls);
  assert.deepEqual(end.action, { verb: 'types', target: '•••••• in Mot de passe' });
});

test('headless only where no window can be shown', () => {
  assert.equal(needsHeadless({}, 'linux'), true);
  assert.equal(needsHeadless({ DISPLAY: ':0' }, 'linux'), false);
  assert.equal(needsHeadless({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), false);
  assert.equal(needsHeadless({}, 'darwin'), false);
});

test('newScreenshots: fresh image files, each reported once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tf-shots-'));
  const seen = new Set();
  writeFileSync(join(dir, 'page-1.png'), PNG);
  writeFileSync(join(dir, 'notes.txt'), 'x');
  assert.deepEqual(newScreenshots(dir, Date.now() - 500, seen), ['page-1.png']);
  assert.deepEqual(newScreenshots(dir, Date.now() - 500, seen), []);
  assert.deepEqual(newScreenshots(dir, Date.now() + 60_000, new Set()), [], 'older than the tool call');
  assert.deepEqual(newScreenshots(join(dir, 'missing'), 0, new Set()), []);
});

let server; let base; let bridge;
const runs = [];
let script = async () => {};
before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tf-browser-'));
  ({ server, bridge } = createTeamforgeServer({
    dbPath: join(dir, 'b.db'),
    provider: () => ({ provider: 'copilot', label: 'GitHub Copilot', model: null }),
    run: async (call) => { runs.push(call); await script(call); return { exitCode: 0, stderr: '' }; },
  }));
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  await bridge.poll(1); // the TeamForge extension is there
});
after(() => server.close());
const project = () => mkdtempSync(join(tmpdir(), 'tf-browserproj-'));
async function api(method, path, body) {
  const res = await fetch(base + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.arrayBuffer() };
}
const send = (p, text) => api('POST', '/api/chat', { project_path: p, text });
const history = async (p) => (await api('GET', `/api/chat?project=${encodeURIComponent(p)}`)).body;
async function idle(p) {
  for (let i = 0; i < 200; i += 1) {
    const h = await history(p);
    if (!h.running) return h;
    await new Promise((r) => { setTimeout(r, 10); });
  }
  throw new Error('turn never finished');
}
const say = (text) => async ({ onEvent }) => { onEvent({ type: 'message', text }); };

test('/browser <url> gives the team a browser on that site; /browser off takes it back', async () => {
  const p = project();
  script = say('ok');
  await send(p, 'build it');
  await idle(p);
  assert.equal(mcp(runs.at(-1).args), null);
  assert.deepEqual((await history(p)).browser, []);
  assert.equal((await history(p)).browserKind, 'own', 'the client\'s own Chrome unless they say otherwise');

  const before_ = runs.length;
  await send(p, '/browser localhost:4200');
  assert.equal(runs.length, before_, 'a site alone only gives the permission');
  await send(p, '/browser not a url');
  const h = await history(p);
  assert.deepEqual(h.browser, ['http://localhost:4200'], 'one site, once');
  assert.match(h.messages.at(-1).text, /Usage/);

  await send(p, 'check the page');
  await idle(p);
  const call = runs.at(-1);
  assert.ok(mcp(call.args).args[0].endsWith('mcp.mjs'), 'TeamForge\'s own browser tools');
  assert.equal(mcp(call.args).env.TEAMFORGE_PROJECT, p);
  assert.ok(!configFile(call.args).startsWith(p), 'the configuration is kept out of the project');
  assert.ok(allowed(call.args).includes('browser'));
  assert.match(call.args[1], /the client's own Chrome.*on http:\/\/localhost:4200/);

  await send(p, '/browser separate');
  assert.equal((await history(p)).browserKind, 'separate');
  await send(p, 'check again');
  await idle(p);
  assert.match(mcp(runs.at(-1).args).args[1], /^@playwright\/mcp@/);
  assert.match(runs.at(-1).args[1], /a browser window of your own/);
  await send(p, '/browser own');
  assert.equal((await history(p)).browserKind, 'own');

  await send(p, '/browser off');
  assert.deepEqual((await history(p)).browser, []);
  await send(p, 'again');
  await idle(p);
  assert.equal(mcp(runs.at(-1).args), null);
  assert.doesNotMatch(runs.at(-1).args[1], /browser/);
});

test('in a spike the browser is for looking, and the project stays read-only', async () => {
  const p = project();
  await send(p, '/spike');
  await send(p, '/browser https://test.example.com');
  script = say('ok');
  await send(p, 'what does the login page show?');
  await idle(p);
  const call = runs.at(-1);
  assert.match(call.args[1], /Observe only/);
  assert.deepEqual(allowed(call.args).filter((t) => t.startsWith('write')), []);
  assert.ok(allowed(call.args).includes('browser'));
});

test('a screenshot the browser saved shows under its tool line and can be fetched', async () => {
  const p = project();
  await send(p, '/browser localhost:3000');
  script = async ({ onEvent, args }) => {
    const out = mcp(args).env.TEAMFORGE_SHOTS;
    onEvent({ type: 'tool_start', id: 's1', name: 'browser-browser_take_screenshot', summary: '{}' });
    writeFileSync(join(out, 'page-2026-11-16T10-00-00-000Z.png'), PNG);
    onEvent({ type: 'tool_end', id: 's1', name: 'browser-browser_take_screenshot', summary: '{}', ok: true });
    onEvent({ type: 'message', text: 'Here is the page.' });
  };
  await send(p, 'show me the home page');
  const h = await idle(p);
  const tool = h.messages.find((m) => m.role === 'tool');
  assert.equal(tool.images.length, 1);
  assert.match(tool.images[0].file, /^\d+\/page-2026-11-16T10-00-00-000Z\.png$/);
  const got = await api('GET', `/api/attachments/${tool.images[0].file}`);
  assert.equal(got.status, 200);
  assert.deepEqual(Buffer.from(got.body), PNG);
});

test('/browser <page> allows the site and opens the page right away', async () => {
  const p = project();
  script = say('It is the login page.');
  await send(p, '/browser localhost:4200/login?next=home');
  const h = await idle(p);
  assert.deepEqual(h.browser, ['http://localhost:4200']);
  assert.match(runs.at(-1).args[1], /Open http:\/\/localhost:4200\/login\?next=home in the browser/);
  assert.ok(allowed(runs.at(-1).args).includes('browser'));
  assert.deepEqual(h.messages.map((m) => m.role), ['user', 'assistant'], 'it shows as the client asking');
});

test('the team is held to the allowed sites: opening another one stops the turn', async () => {
  const p = project();
  await send(p, '/browser localhost:4200');
  let aborted = false;
  script = async ({ onEvent, signal }) => {
    onEvent({ type: 'tool_start', id: 'n1', name: 'browser-browser_navigate', summary: 'opens http://localhost:4200/orders', action: { verb: 'opens', target: 'http://localhost:4200/orders' }, url: 'http://localhost:4200/orders' });
    onEvent({ type: 'tool_end', id: 'n1', name: 'browser-browser_navigate', summary: 'opens http://localhost:4200/orders', ok: true });
    assert.equal(signal.aborted, false, 'an allowed site goes through');
    onEvent({ type: 'tool_start', id: 'n2', name: 'browser-browser_navigate', summary: 'opens https://evil.example.com/x', action: { verb: 'opens', target: 'https://evil.example.com/x' }, url: 'https://evil.example.com/x?secret=1' });
    aborted = signal.aborted;
  };
  await send(p, 'look at the orders');
  const h = await idle(p);
  assert.equal(aborted, true);
  const last = h.messages.at(-1);
  assert.equal(last.role, 'system');
  assert.match(last.text, /tried to open `https:\/\/evil\.example\.com`.*turn was stopped/);
  assert.ok(!JSON.stringify(h.messages).includes('secret=1'), 'the full address is not kept');
});

test('the screen is read by a browser operator on a light model, kept outside the project', async () => {
  const p = project();
  await send(p, '/browser localhost:4200');
  script = say('ok');
  await send(p, 'check the home page');
  await idle(p);
  const call = runs.at(-1);
  const home = call.args[call.args.indexOf('--add-dir') + 1];
  assert.ok(!home.startsWith(p), 'nothing is written in the project');
  const agent = readFileSync(join(home, '.github', 'agents', 'teamforge-browser.agent.md'), 'utf8');
  assert.match(agent, /^name: teamforge-browser$/m);
  assert.match(agent, /^model: claude-haiku-5\.5$/m);
  assert.match(agent, /http:\/\/localhost:4200/);
  assert.match(call.args[1], /hand each browser task to the `teamforge-browser` agent/);

  await send(p, '/browser model gpt-5.6-sol');
  await send(p, 'again');
  await idle(p);
  assert.match(readFileSync(join(home, '.github', 'agents', 'teamforge-browser.agent.md'), 'utf8'), /^model: gpt-5\.6-sol$/m);
  await send(p, '/browser model default');
  assert.match((await history(p)).messages.at(-1).text, /claude-haiku-5\.5/);
  await send(p, '/browser model not a model');
  assert.match((await history(p)).messages.at(-1).text, /screen is read on `claude-haiku-5\.5`/);
});

test('the operator only observes in a spike, and a model that cannot run is reported', () => {
  const home = mkdtempSync(join(tmpdir(), 'tf-agent-'));
  writeBrowserAgent(home, { model: 'm', sites: ['https://a.example'], observeOnly: true });
  assert.match(readFileSync(join(home, '.github', 'agents', 'teamforge-browser.agent.md'), 'utf8'), /Observe only/);
  const failed = toChatEvent({ type: 'subagent.failed', data: { toolCallId: 'x', agentName: 'teamforge-browser', model: 'nope', error: 'model not available' } }, new Map());
  assert.equal(failed.type, 'agent_error');
  assert.match(failed.text, /could not run on nope: model not available/);
  assert.equal(toChatEvent({ type: 'subagent.failed', data: { toolCallId: 'y', agentName: 'someone-else', error: 'x' } }, new Map()), null);
});

test('the operator taking over shows which model reads the screen', () => {
  const calls = new Map();
  const start = toChatEvent({ type: 'subagent.started', data: { toolCallId: 't9', agentName: 'teamforge-browser', model: 'claude-haiku-5.5' } }, calls);
  assert.equal(start.type, 'tool_start');
  assert.deepEqual(start.action, { verb: 'operator reads the screen on', target: 'claude-haiku-5.5' });
  assert.equal(toChatEvent({ type: 'assistant.message', data: { content: 'I opened the page…', parentToolCallId: 't9' } }, calls), null, 'its report goes to the team, not to the console');
  assert.equal(toChatEvent({ type: 'assistant.message', data: { content: 'Le statut est…' } }, calls).type, 'message');
  const end = toChatEvent({ type: 'subagent.completed', data: { toolCallId: 't9', agentName: 'teamforge-browser', model: 'claude-haiku-5.5' } }, calls);
  assert.equal(end.type, 'tool_end');
  assert.equal(end.id, start.id);
  assert.equal(end.ok, true);
});

test('without the TeamForge extension, /browser says how to load it instead of starting a turn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tf-noext-'));
  const started = [];
  const lonely = createTeamforgeServer({
    dbPath: join(dir, 'n.db'),
    provider: () => ({ provider: 'copilot', label: 'GitHub Copilot', model: null }),
    run: async (call) => { started.push(call); call.onEvent({ type: 'message', text: 'ok' }); return { exitCode: 0, stderr: '' }; },
  });
  await new Promise((r) => { lonely.server.listen(0, '127.0.0.1', r); });
  const at = `http://127.0.0.1:${lonely.server.address().port}`;
  const post = (text, p) => fetch(`${at}/api/chat`, { method: 'POST', headers: H, body: JSON.stringify({ project_path: p, text }) });
  const p = project();
  try {
    await post('build it', p);
    for (let i = 0; i < 100 && (await (await fetch(`${at}/api/chat?project=${encodeURIComponent(p)}`)).json()).running; i += 1) await new Promise((r) => { setTimeout(r, 10); });
    const before_ = started.length;
    await post('/browser localhost:4200/login', p);
    const h = await (await fetch(`${at}/api/chat?project=${encodeURIComponent(p)}`)).json();
    assert.match(h.messages.at(-1).text, /extension is not connected.*Load unpacked/s);
    assert.deepEqual(h.browser, ['http://localhost:4200'], 'the site is allowed all the same');
    assert.equal(started.length, before_, 'no turn that could only fail');
  } finally { lonely.server.close(); }
});
