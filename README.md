# ⚒ Claude TeamForge

Claude Code plugin that makes Claude work like a **visible team of agents** with an
enforced idea-to-done workflow and a live mission-control dashboard.

```
Brainstorm → Questions → Spec → ✋ → Plan → ✋ → Implementation → Tests → Review → ✋ → Done
```

The ✋ gates are **user validations** — and they're not polite suggestions: a local
worker enforces the state machine, and a PreToolUse hook **denies writing source
files** until you've validated the spec and the plan.

## How it works

```
Claude Code session                        Worker (Node 24, zero deps)
┌─────────────────────────────┐            ┌────────────────────────────┐
│ SessionStart ─ boot+bootstrap┼───────────► HTTP API  127.0.0.1:4519   │
│ UserPromptSubmit ─ events   ┼───────────► SQLite ~/.claude-teamforge  │
│ PostToolUse ─ events        ┼───────────► state machine + gates       │
│ PreToolUse(Write|Edit) ─ ask┼──deny/ok──┤ SSE /events                 │
│ Claude ── teamforge CLI ────┼───────────► serves React dashboard  ────┼──► browser
└─────────────────────────────┘            └────────────────────────────┘
```

**The team** — 7 roles, each a dashboard card and an agent definition: Product
Manager, Architect, Frontend, Backend, QA/Test, Security, Reviewer. PM and Architect
run in the main session (they own the conversation with you); implementers and the
Reviewer can be dispatched as real subagents. Every status change animates live.

**Memory** — approved decisions persist per project in SQLite and are injected into
every future session's context.

Conceptual parents: [Superpowers](https://github.com/obra/superpowers) (workflow
discipline) and [claude-mem](https://github.com/thedotmack/claude-mem)
(hooks → worker → SQLite → UI architecture).

## Quick start

See [docs/INSTALL.md](docs/INSTALL.md). TL;DR:

```
/plugin marketplace add /home/fares/claude-teamforge
/plugin install claude-teamforge@teamforge-local
/reload-plugins
```

New session → say "build me X" → open **http://127.0.0.1:4519** → watch the team work.
Demo script: [docs/DEMO.md](docs/DEMO.md).

## Development

```
npm test                      # 31 tests: state machine, storage, API, CLI, gate hook
cd dashboard && npm run dev   # dashboard dev server (proxies to the worker)
```

The headline test (`tests/gate.test.mjs`) proves mechanically that a `Write` to
`src/app.js` during brainstorm is **denied** through the real hook shim and allowed
only after both gates are approved.

## Layout

- `worker/` — state machine, SQLite layer, HTTP+SSE server, `teamforge` CLI, hook entrypoint
- `hooks/` — hooks.json + bash shims (fail-open: a dead worker never blocks you)
- `skills/teamforge/` — the workflow law injected at session start
- `agents/` — the 7 role definitions
- `dashboard/` — React + Vite source; prebuilt `dist/` committed
- `docs/` — spec, plan, install guide, demo scenario
