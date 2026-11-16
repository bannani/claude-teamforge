import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISOLATED_ENV, buildArgs, isProgramName, parseMcpList, runCopilot } from '../worker/providers/copilot.mjs';

const FAKE = join(fileURLToPath(new URL('.', import.meta.url)), 'helpers', 'fake-copilot.mjs');
const allowed = (args) => args.slice(args.indexOf('--allow-tool') + 1);

test('before implementation: docs and reporting only, no source writes, grants ignored', () => {
  const args = buildArgs({ prompt: 'hi', sessionId: 'sid', writeOpen: false, grants: ['npm'] });
  const tools = allowed(args);
  assert.ok(tools.includes('write(docs/spec.md)') && tools.includes('write(docs/plan.md)'));
  assert.ok(!tools.some((t) => /^write\(.*[*?]/.test(t)), 'no glob write rules: Copilot ignores them');
  assert.ok(tools.includes('shell(teamforge:*)'));
  assert.ok(!tools.includes('write'));
  assert.ok(!tools.some((t) => t.includes('npm')));
});

test('from implementation: source writes and the granted programs are added', () => {
  const tools = allowed(buildArgs({ prompt: 'hi', sessionId: 'sid', writeOpen: true, grants: ['npm', 'bad name; rm'] }));
  assert.ok(tools.includes('write'));
  assert.ok(tools.includes('shell(npm:*)'));
  assert.ok(!tools.some((t) => t.includes('rm')), 'invalid program names never reach the command line');
});

test('never allows everything, never asks the user, resumes one session, passes the model', () => {
  const args = buildArgs({ prompt: 'the prompt', sessionId: 'sid-1', writeOpen: true, model: 'some-model' });
  assert.deepEqual(args.slice(0, 2), ['-p', 'the prompt']);
  assert.equal(args[args.indexOf('--session-id') + 1], 'sid-1');
  assert.equal(args[args.indexOf('--model') + 1], 'some-model');
  assert.ok(args.includes('--no-ask-user'));
  assert.ok(!args.includes('--no-auto-update'), 'the bundled CLI cannot read a sign-in stored by the current one');
  assert.ok(!args.some((a) => a.startsWith('--allow-all')));
  assert.ok(!buildArgs({ prompt: 'p', sessionId: 's', writeOpen: false }).includes('--model'));
});

test('program names: plain names only', () => {
  for (const ok of ['npm', 'python3', 'g++', 'docker-compose']) assert.ok(isProgramName(ok), ok);
  for (const bad of ['', 'rm -rf', 'a;b', '$(x)', '../x', 'a)', undefined]) assert.ok(!isProgramName(bad), String(bad));
});

test('JSONL becomes chat events; noise and non-JSON lines are ignored', async () => {
  const events = [];
  const out = await runCopilot({ bin: process.execPath, args: [FAKE, 'ok'], onEvent: (e) => events.push(e) });
  assert.equal(out.exitCode, 0);
  assert.deepEqual(events.map((e) => e.type), ['text', 'text', 'message', 'tool_start', 'tool_end', 'tool_start', 'tool_end']);
  assert.equal(events[2].text, 'Hello');
  const denied = events[4];
  assert.deepEqual([denied.name, denied.summary, denied.ok, denied.denied, denied.program], ['bash', 'npm test', false, true, 'npm']);
  const created = events[6];
  assert.deepEqual([created.name, created.ok, created.path, created.program], ['create', true, '/p/docs/spec.md', null]);
});

test('a failing process reports its exit code and stderr', async () => {
  const out = await runCopilot({ bin: process.execPath, args: [FAKE, 'fail'], onEvent() {} });
  assert.equal(out.exitCode, 3);
  assert.match(out.stderr, /not signed in/);
});

test('abort kills the process', async () => {
  const ac = new AbortController();
  const started = Date.now();
  const done = runCopilot({ bin: process.execPath, args: [FAKE, 'hang'], signal: ac.signal, onEvent: () => ac.abort() });
  const out = await done;
  assert.notEqual(out.exitCode, 0);
  assert.ok(Date.now() - started < 3000);
});

test('a missing binary rejects', async () => {
  await assert.rejects(runCopilot({ bin: '/nonexistent/copilot', args: [], onEvent() {} }), /ENOENT/);
});

test('a sub-agent is attributed to its employee: its start, what it runs and says, its end', async () => {
  const { toChatEvent } = await import('../worker/providers/copilot.mjs');
  const calls = new Map(); const agents = new Map();
  const ev = (type, data) => toChatEvent({ type, data }, calls, agents);
  ev('tool.execution_start', { toolCallId: 'task1', toolName: 'task', arguments: { agent_type: 'teamforge-backend', description: 'Build the API', prompt: '…' } });
  assert.deepEqual(ev('subagent.started', { toolCallId: 'task1', agentName: 'teamforge-backend', model: 'gpt-5.6-sol' }),
    { type: 'agent_start', role: 'backend', model: 'gpt-5.6-sol', task: 'Build the API' });
  const patch = ev('tool.execution_start', { toolCallId: 'p1', parentToolCallId: 'task1', toolName: 'apply_patch', arguments: '*** Begin Patch\n*** Add File: src/api.js\n+x\n*** End Patch\n' });
  assert.deepEqual([patch.role, patch.summary], ['backend', 'src/api.js']);
  const done = ev('tool.execution_complete', { toolCallId: 'p1', success: true });
  assert.deepEqual([done.role, done.path, done.ok], ['backend', 'src/api.js', true]);
  assert.equal(ev('assistant.message_delta', { deltaContent: 'par', parentToolCallId: 'task1' }), null, 'sub-agent text is not streamed as the CEO');
  assert.deepEqual(ev('assistant.message', { content: 'API done.', parentToolCallId: 'task1' }), { type: 'message', text: 'API done.', role: 'backend' });
  assert.deepEqual(ev('subagent.failed', { toolCallId: 'task1', agentName: 'teamforge-backend', model: 'gpt-5.6-sol', error: 'boom' }),
    { type: 'agent_end', role: 'backend', model: 'gpt-5.6-sol', ok: false, error: 'boom' });
  assert.equal(ev('subagent.started', { toolCallId: 'x', agentName: 'someone-elses-agent' }), null, 'only TeamForge employees');
  assert.deepEqual(ev('assistant.message', { content: 'hi' }), { type: 'message', text: 'hi', role: null });
});

test('attachments are passed before the permission list', () => {
  const args = buildArgs({ prompt: 'p', sessionId: 's', writeOpen: false, attachments: ['/a/1.png', '/a/2.png'] });
  assert.deepEqual(args.filter((a, i) => args[i - 1] === '--attachment'), ['/a/1.png', '/a/2.png']);
  assert.ok(args.lastIndexOf('--attachment') < args.indexOf('--allow-tool'));
});

test('a turn does not load the user\'s own plugins and MCP servers', () => {
  const listed = parseMcpList(`User servers:
  jenkins (http)
  zeroheight (http)

Plugin servers:
  atlassian (http)
  playwright (local)

Builtin servers:
  browser-use (local)
  github-mcp-server (http)
`);
  assert.deepEqual(listed, ['jenkins', 'zeroheight', 'browser-use', 'github-mcp-server'], 'plugin servers go with the plugins');
  assert.deepEqual(parseMcpList('No MCP servers configured.'), []);
  assert.equal(ISOLATED_ENV.COPILOT_PLUGIN_DIR_ONLY, 'true');
  const args = buildArgs({ prompt: 'p', sessionId: 's', writeOpen: false, browser: '@/x.json', otherMcp: ['jenkins', 'browser', 'bad name;rm'] });
  assert.ok(args.includes('--disable-builtin-mcps'));
  const excluded = args.slice(args.indexOf('--excluded-tools') + 1, args.indexOf('--disable-builtin-mcps'));
  assert.ok(excluded.includes('web_fetch') && excluded.includes('sql'));
  assert.ok(!excluded.some((t) => ['bash', 'view', 'create', 'edit', 'grep', 'glob', 'task'].includes(t)), 'the tools the team works with stay');
  const off = args.flatMap((a, i) => (a === '--disable-mcp-server' ? [args[i + 1]] : []));
  assert.deepEqual(off, ['jenkins'], 'never the team\'s own browser server, never a name that is not one');
  assert.equal(args.at(-allowedCount(args) - 1), '--allow-tool');
});
const allowedCount = (args) => args.length - args.indexOf('--allow-tool') - 1;
