#!/usr/bin/env node
// teamforge CLI — Claude's remote control for the workflow worker.
// Prints worker JSON responses on stdout; refusals exit nonzero so Claude sees them.

import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.TEAMFORGE_URL || 'http://127.0.0.1:4519';
const PROJECT = () => process.env.TEAMFORGE_PROJECT || process.cwd();
const SERVER = join(fileURLToPath(new URL('.', import.meta.url)), 'server.mjs');
const LOG_DIR = join(homedir(), '.claude-teamforge');

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      opts[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    } else positional.push(argv[i]);
  }
  return { positional, opts };
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    process.stderr.write(`teamforge: worker unreachable at ${BASE} — run 'ensure-worker' first\n`);
    process.exit(3);
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    process.stderr.write(`teamforge: ${out.error || res.status}\n`);
    process.exit(1);
  }
  return out;
}

async function activeSession() {
  const state = await api('GET', `/api/state?project=${encodeURIComponent(PROJECT())}`);
  if (state.empty || !state.session || state.session.project_path !== PROJECT() || state.session.phase === 'done') {
    process.stderr.write(`teamforge: no active workflow session for ${PROJECT()} — run 'teamforge start' first\n`);
    process.exit(1);
  }
  return state;
}

const print = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

async function healthy() {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(700) });
    return res.ok;
  } catch { return false; }
}

async function ensureWorker() {
  if (await healthy()) return print({ ok: true, already_running: true });
  mkdirSync(LOG_DIR, { recursive: true });
  const log = openSync(join(LOG_DIR, 'worker.log'), 'a');
  spawn(process.execPath, [SERVER], { detached: true, stdio: ['ignore', log, log] }).unref();
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => { setTimeout(r, 250); });
    if (await healthy()) return print({ ok: true, started: true });
  }
  process.stderr.write('teamforge: worker failed to start — see ~/.claude-teamforge/worker.log\n');
  process.exit(3);
}

const USAGE = `teamforge <command>
  start --name <n> --title <t> [--project <path>]
  state | phase <phase>
  agent <role> --status idle|working|blocked|done [--note <text>]
  task add <title> [--role <role>] | task set <id> <status>
  decide <title> [--detail <d>] | decide-set <id> approved|rejected
  validate ask <gate> <question> | validate set <id> approved|changes_requested [--answer <a>]
  event <kind> [--json <payload>]
  gate-check <file_path>
  ensure-worker`;

async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = positional;
  const project = opts.project || PROJECT();
  if (opts.project) process.env.TEAMFORGE_PROJECT = opts.project;

  switch (cmd) {
    case 'start':
      return print(await api('POST', '/api/sessions', {
        project_path: project,
        project_name: opts.name || project.split('/').at(-1),
        title: opts.title || '',
      }));
    case 'state':
      return print(await activeSession());
    case 'phase': {
      const { session } = await activeSession();
      return print(await api('POST', `/api/sessions/${session.id}/phase`, { phase: rest[0] }));
    }
    case 'agent': {
      const { session } = await activeSession();
      return print(await api('POST', `/api/sessions/${session.id}/agents`, {
        role: rest[0], status: opts.status || 'working', note: opts.note || '',
      }));
    }
    case 'task': {
      if (rest[0] === 'add') {
        const { session } = await activeSession();
        return print(await api('POST', `/api/sessions/${session.id}/tasks`, {
          title: rest.slice(1).join(' '), role: opts.role,
        }));
      }
      if (rest[0] === 'set') {
        return print(await api('PATCH', `/api/tasks/${rest[1]}`, { status: rest[2] }));
      }
      break;
    }
    case 'decide': {
      const { session } = await activeSession();
      return print(await api('POST', `/api/sessions/${session.id}/decisions`, {
        title: rest.join(' '), detail: opts.detail || '',
      }));
    }
    case 'decide-set':
      return print(await api('PATCH', `/api/decisions/${rest[0]}`, { status: rest[1] }));
    case 'validate': {
      if (rest[0] === 'ask') {
        const { session } = await activeSession();
        return print(await api('POST', `/api/sessions/${session.id}/validations`, {
          gate: rest[1], question: rest.slice(2).join(' '),
        }));
      }
      if (rest[0] === 'set') {
        return print(await api('PATCH', `/api/validations/${rest[1]}`, {
          status: rest[2], answer: opts.answer || '',
        }));
      }
      break;
    }
    case 'event': {
      const { session } = await activeSession();
      return print(await api('POST', `/api/sessions/${session.id}/events`, {
        kind: rest[0] || 'note', payload: opts.json ? JSON.parse(opts.json) : {},
      }));
    }
    case 'gate-check': {
      const verdict = await api('POST', '/api/gate-check', {
        project_path: project, file_path: rest[0] || '',
      });
      print(verdict);
      if (!verdict.allow) process.exit(2);
      return undefined;
    }
    case 'ensure-worker':
      return ensureWorker();
    default:
      process.stderr.write(`${USAGE}\n`);
      process.exit(1);
  }
  process.stderr.write(`${USAGE}\n`);
  process.exit(1);
}

main();
