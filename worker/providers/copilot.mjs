// GitHub Copilot provider: one `copilot -p` process per turn, resumed by
// session id. Copilot runs its own tools; TeamForge decides which ones it may
// use (the write lock is a permission list) and turns its JSONL into chat events.

import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { DOCS } from '../docs.mjs';
import { roleOfAgent } from '../agent/team.mjs';
import { GRAPH_SERVER, graphTools } from '../agent/graph.mjs';
import { BROWSER_AGENT, BROWSER_DENIED, BROWSER_SERVER, browserAction } from '../agent/browser.mjs';

// The documents the company may write before the plan is validated. Exact
// paths on purpose: Copilot CLI 1.0.109 ignores glob write rules (`docs/**`,
// `*.md`) in prompt mode and treats a glob deny rule as "deny every write",
// so only exact-path allow rules give a lock that actually holds.
export const DOC_FILES = DOCS.map((d) => d.path);

// Looking around: all a spike may do (next to Copilot's own read and search tools).
const READ_ALLOW = ['shell(ls)', 'shell(cat)', 'shell(pwd)', 'shell(git status)', 'shell(git log)', 'shell(git diff)'];

// Always allowed in a mission: reporting to the worker, writing those documents, looking around.
const BASE_ALLOW = ['shell(teamforge:*)', ...DOC_FILES.map((f) => `write(${f})`), ...READ_ALLOW];

export const isProgramName = (s) => typeof s === 'string' && /^[A-Za-z0-9][\w.+-]{0,63}$/.test(s);

export function buildArgs({ prompt, sessionId, writeOpen, readOnly = false, grants = [], allowAll = false, model = null, attachments = [], browser = null, agentDirs = [], otherMcp = [], graph = null }) {
  // browser: the --additional-mcp-config value (an `@file`) when the client opened a browser
  // readOnly (spike mode) wins over everything: no write, no granted program, no /allow-all.
  const allow = readOnly ? [...READ_ALLOW] : [...BASE_ALLOW];
  if (writeOpen && !readOnly) {
    // Source writes and the user's granted programs open only once the plan is validated.
    allow.push('write');
    // /allow-all: an unscoped shell rule is every shell command. Nothing else
    // (URLs, MCP tools) opens, and it never applies before the plan is validated.
    if (allowAll) allow.push('shell');
    else allow.push('shell(mkdir)', ...grants.filter(isProgramName).map((g) => `shell(${g}:*)`));
  }
  // The browser the client opened with /browser: its tools, in every phase and in a spike.
  if (browser) allow.push(BROWSER_SERVER);
  // graph: the --additional-mcp-config of the code map (an `@file`): its tools that read
  if (graph) allow.push(...graphTools());
  return [
    '-p', prompt,
    '--output-format', 'json', '--stream', 'on',
    // No --no-auto-update: it pins the CLI to the version bundled at install time, which
    // cannot read a sign-in stored by the newer version the user actually runs (seen with
    // 1.0.60 bundled / 1.0.112 current: "No authentication information found").
    '--no-color', '--no-custom-instructions', '--no-ask-user',
    '--session-id', sessionId,
    ...(model ? ['--model', model] : []),
    // The user's own MCP servers are of no use here — their tools are not allowed — but each
    // one costs start-up time and prompt tokens on every turn (see ISOLATED_ENV).
    '--excluded-tools', ...EXCLUDED_TOOLS,
    '--disable-builtin-mcps', ...otherMcp.filter(isServerName).flatMap((name) => ['--disable-mcp-server', name]),
    ...attachments.flatMap((path) => ['--attachment', path]),
    // directories whose .github/agents Copilot loads: agents TeamForge keeps outside the project
    ...agentDirs.flatMap((dir) => ['--add-dir', dir]),
    ...(graph ? ['--additional-mcp-config', graph] : []),
    ...(browser ? ['--additional-mcp-config', browser, '--deny-tool', ...BROWSER_DENIED.map((t) => `${BROWSER_SERVER}(${t})`)] : []),
    '--allow-tool', ...allow, // variadic: must stay last
  ];
}

const isServerName = (s) => typeof s === 'string' && /^[\w.-]{1,64}$/.test(s) && s !== BROWSER_SERVER && s !== GRAPH_SERVER;

// A turn is a fresh `copilot` process, and by default it loads everything the user
// set up for their own sessions: plugins, their hooks, a dozen MCP servers. None of
// it can be used by the team (TeamForge decides the tools), and it is paid on every
// turn — measured on a one-word turn: 8.5 s and 34k input tokens with it, 4.4 s and
// 24k without. So plugins are not discovered, and the MCP servers are switched off.
export const ISOLATED_ENV = { COPILOT_PLUGIN_DIR_ONLY: 'true' };

// Built-in tools the company has no use for: the web (no URL is allowed anyway),
// Copilot's own documentation, skills and workflows (they came from the plugins),
// its session database, MCP resources, writing agent definitions. Their descriptions
// alone were 10k of the 24k input tokens of every turn (13.4k without them).
// Kept: bash (and its read/stop/list), view, create, edit, grep, glob,
// semantic_code_search, task, read_agent, list_agents.
export const EXCLUDED_TOOLS = [
  'web_fetch', 'fetch_copilot_cli_documentation', 'skill', 'run_dynamic_workflow',
  'dynamic_workflows_manage', 'sql', 'session_store_sql', 'write_agent', 'read_resource',
];

// The MCP servers Copilot would start: `copilot mcp list` prints "  name (type)" under
// a heading per source. Plugin servers go with the plugins; the others are named here.
export function parseMcpList(text) {
  const names = [];
  let plugin = false;
  for (const line of String(text || '').split('\n')) {
    if (/^\S.*:\s*$/.test(line)) { plugin = /^plugin/i.test(line); continue; }
    const name = /^\s+([\w.-]+)\s+\(/.exec(line)?.[1];
    if (name && !plugin && isServerName(name)) names.push(name);
  }
  return [...new Set(names)];
}

let mcpList = null; // asked once per worker
export function otherMcpServers(bin = 'copilot') {
  mcpList ??= new Promise((resolve) => {
    execFile(bin, ['mcp', 'list'], { timeout: 15000, env: { ...process.env, ...ISOLATED_ENV } }, (err, stdout) => resolve(err ? [] : parseMcpList(stdout)));
  });
  return mcpList;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

// Some models edit files with a patch given as one string ("*** Add File: x").
const patchedFile = (args) => (typeof args === 'string'
  ? /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m.exec(args)?.[1].trim() ?? null
  : null);

function describe(args = {}) {
  if (typeof args === 'string') return clip(patchedFile(args) ?? args, 200);
  const main = args.command ?? args.path ?? args.pattern ?? args.query ?? args.url ?? args.description;
  return clip(typeof main === 'string' ? main : JSON.stringify(args), 200);
}

// Maps one Copilot JSONL object to zero or one chat event. `calls` remembers
// tool starts so the matching completion can say what was run.
// `agents` maps the tool call that started a sub-agent to the employee it is,
// so everything that sub-agent says or runs can be attributed to them.
export function toChatEvent(obj, calls, agents = new Map()) {
  const d = obj?.data || {};
  const role = agents.get(d.parentToolCallId) ?? null;
  switch (obj?.type) {
    case 'assistant.message_delta':
      // only the coordinator streams; a sub-agent's text arrives whole
      return d.deltaContent && !d.parentToolCallId ? { type: 'text', text: d.deltaContent } : null;
    case 'assistant.message':
      // the operator reports to the employee who asked, not to the client
      if (calls.has(`op:${d.parentToolCallId}`)) return null;
      return d.content ? { type: 'message', text: d.content, role } : null;
    case 'subagent.started': {
      const who = roleOfAgent(d.agentName);
      // the browser operator taking over shows as one line: who reads the screen, on which model
      if (!who && d.agentName === BROWSER_AGENT) {
        const action = { verb: 'operator reads the screen on', target: d.model || 'its model' };
        calls.set(`op:${d.toolCallId}`, action);
        return { type: 'tool_start', id: `op:${d.toolCallId}`, name: BROWSER_AGENT, summary: `${action.verb} ${action.target}`, role: null, action };
      }
      if (!who) return null;
      agents.set(d.toolCallId, who);
      return { type: 'agent_start', role: who, model: d.model ?? null, task: calls.get(d.toolCallId)?.summary ?? '' };
    }
    case 'subagent.completed':
    case 'subagent.failed': {
      const who = agents.get(d.toolCallId);
      // the browser operator is not an employee, but the client must know when its model cannot run
      const op = calls.get(`op:${d.toolCallId}`);
      if (op && obj.type === 'subagent.completed') {
        calls.delete(`op:${d.toolCallId}`);
        return { type: 'tool_end', id: `op:${d.toolCallId}`, name: BROWSER_AGENT, summary: `${op.verb} ${op.target}`, path: null, role: null, ok: true, denied: false, error: null, program: null, action: op };
      }
      if (!who && obj.type === 'subagent.failed' && d.agentName === BROWSER_AGENT) {
        return { type: 'agent_error', text: `The browser operator could not run${d.model ? ` on ${d.model}` : ''}: ${clip(String(d.error || 'failed'), 300)}. \`/browser model <name>\` chooses another model.` };
      }
      if (!who) return null;
      const failed = obj.type === 'subagent.failed';
      return { type: 'agent_end', role: who, model: d.model ?? null, ok: !failed, error: failed ? clip(String(d.error || 'failed'), 300) : null };
    }
    case 'tool.execution_start': {
      // a browser action reads as a sentence, and never shows a typed password
      const action = browserAction(d.toolName, d.arguments);
      const call = {
        id: d.toolCallId, name: d.toolName, summary: action ? `${action.verb} ${action.target}`.trim() : describe(d.arguments), role,
        action,
        path: typeof d.arguments?.path === 'string' ? d.arguments.path : patchedFile(d.arguments),
        command: typeof d.arguments?.command === 'string' ? d.arguments.command : null,
      };
      calls.set(call.id, call);
      return {
        type: 'tool_start', id: call.id, name: call.name, summary: call.summary, role,
        ...(action ? { action } : {}),
        // where the browser is being sent, so the worker can hold the team to the allowed sites
        ...(action && typeof d.arguments?.url === 'string' ? { url: d.arguments.url } : {}),
      };
    }
    case 'tool.execution_complete': {
      const call = calls.get(d.toolCallId) || { id: d.toolCallId, name: 'tool', summary: '', path: null, command: null, role: null, action: null };
      calls.delete(d.toolCallId);
      const denied = d.error?.code === 'denied';
      const program = denied && call.command ? call.command.trim().split(/\s+/)[0] : null;
      return {
        type: 'tool_end', id: call.id, name: call.name, summary: call.summary, path: call.path, role: call.role,
        ok: d.success === true, denied,
        error: d.success === true ? null : clip(String(d.error?.message || 'failed'), 300),
        program: isProgramName(program) ? program : null,
        ...(call.action ? { action: call.action } : {}),
      };
    }
    case 'result':
      return { type: 'result', exitCode: obj.exitCode ?? 0 };
    default:
      return null;
  }
}

// Runs one turn. Resolves with { exitCode, stderr }; never rejects for a
// non-zero exit (the caller reports it), only if the binary cannot start.
export function runCopilot({ args, cwd, env, signal, onEvent, bin = 'copilot' }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const calls = new Map();
    const agents = new Map();
    let stderr = '';
    let reported = null;
    const kill = () => child.kill('SIGTERM');
    if (signal?.aborted) kill(); else signal?.addEventListener('abort', kill, { once: true });

    createInterface({ input: child.stdout }).on('line', (line) => {
      let obj;
      try { obj = JSON.parse(line); } catch { return; }
      const event = toChatEvent(obj, calls, agents);
      if (!event) return;
      if (event.type === 'result') reported = event.exitCode; else onEvent(event);
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    child.once('error', (err) => {
      signal?.removeEventListener('abort', kill);
      reject(err);
    });
    child.once('close', (code) => {
      signal?.removeEventListener('abort', kill);
      resolve({ exitCode: reported ?? code ?? 1, stderr });
    });
  });
}
