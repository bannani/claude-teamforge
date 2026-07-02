// Hook entrypoints. Called by the bash shims in hooks/ with stdin = Claude
// Code's hook JSON. Must NEVER break a session: fail-open, always exit 0.

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const BASE = process.env.TEAMFORGE_URL || 'http://127.0.0.1:4519';

function readStdin() {
  try {
    const chunks = readFileSync(0, 'utf8');
    return chunks ? JSON.parse(chunks) : {};
  } catch { return {}; }
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });
  return res.json();
}

async function activeSession(project) {
  const state = await api('GET', `/api/state?project=${encodeURIComponent(project)}`);
  if (state.empty || !state.session || state.session.project_path !== project
    || state.session.phase === 'done') return null;
  return state.session;
}

async function sessionStart(input) {
  const project = input.cwd || process.cwd();
  // Boot the worker (idempotent, detached).
  await new Promise((resolve) => {
    execFile(process.execPath, [join(ROOT, 'worker', 'cli.mjs'), 'ensure-worker'],
      { env: { ...process.env, TEAMFORGE_PROJECT: project } }, () => resolve());
  });

  const skill = readFileSync(join(ROOT, 'skills', 'teamforge', 'SKILL.md'), 'utf8');
  let memory = '';
  try {
    const { decisions } = await api('GET', `/api/decisions?project=${encodeURIComponent(project)}&limit=15`);
    if (decisions.length) {
      memory = `\n\n## TeamForge project memory — past approved decisions\n${
        decisions.map((d) => `- ${d.title}${d.detail ? ` — ${d.detail}` : ''} (${d.ts})`).join('\n')}`;
    }
  } catch { /* worker not up yet — skip memory */ }

  const context = `<TEAMFORGE_BOOTSTRAP>\nYou have the TeamForge team workflow. Dashboard: http://127.0.0.1:4519\n\n${skill}${memory}\n</TEAMFORGE_BOOTSTRAP>`;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
  }));
}

async function emit(kind, input) {
  const project = input.cwd || process.cwd();
  const session = await activeSession(project);
  if (!session) return;
  if (kind === 'prompt') {
    await api('POST', `/api/sessions/${session.id}/events`, {
      kind: 'prompt', payload: { text: String(input.prompt || '').slice(0, 300) },
    });
  } else {
    const file = input.tool_input?.file_path;
    await api('POST', `/api/sessions/${session.id}/events`, {
      kind: 'tool', payload: { tool: input.tool_name, file },
    });
    if (file && /^(Write|Edit|NotebookEdit)$/.test(input.tool_name)) {
      await api('POST', `/api/sessions/${session.id}/events`, {
        kind: 'file', payload: { file, tool: input.tool_name },
      });
    }
  }
}

async function gate(input) {
  const file = input.tool_input?.file_path;
  if (!file) return;
  const project = input.cwd || process.cwd();
  const verdict = await api('POST', '/api/gate-check', {
    project_path: project, file_path: file,
  });
  if (!verdict.allow) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `${verdict.reason} Advance the TeamForge workflow first (spec + plan must be validated by the user; use 'teamforge phase' / 'teamforge validate').`,
      },
    }));
  }
  // allow → stay silent so the normal permission flow continues untouched
}

const [mode, sub] = process.argv.slice(2);
const input = readStdin();
const run = { 'session-start': () => sessionStart(input), emit: () => emit(sub, input), gate: () => gate(input) }[mode];

try {
  await run?.();
} catch { /* fail-open by design */ }
process.exit(0);
