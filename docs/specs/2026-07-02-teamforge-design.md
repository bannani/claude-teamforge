# Claude TeamForge — Design Specification

**Date:** 2026-07-02 · **Status:** awaiting user validation

## 1. What it is

A Claude Code plugin that makes Claude work like a visible team. Every idea flows through a
disciplined pipeline — **Brainstorm → Questions → Spec → User validation → Plan → Tasks →
Implementation → Tests → Review → Final summary** — and a local web dashboard shows the
"team" (7 role agents) working in real time.

Conceptual parents:
- **Superpowers** → phase discipline injected at session start; hard gates before code.
- **claude-mem** → hooks feeding a long-lived local worker with SQLite storage and a web UI.

## 2. Architecture

```
Claude Code session
 ├─ SessionStart hook ──► starts worker (if down), injects bootstrap instructions
 │                        + recent project decisions (memory recall)
 ├─ UserPromptSubmit hook ─► records prompt event to worker
 ├─ PostToolUse hook ──────► records tool events / file changes to worker
 ├─ PreToolUse hook (Write|Edit) ► GATE: worker denies code writes while the active
 │                                 workflow is in a pre-implementation phase
 └─ Claude (via bootstrap skill) ► calls `teamforge` CLI to drive the workflow:
                                    phase changes, agent status, tasks, decisions,
                                    validation requests/answers

Worker (Node 24, zero runtime deps)
 ├─ HTTP API  on http://127.0.0.1:4519
 ├─ SSE stream /events  → pushes every change to the dashboard
 ├─ SQLite via node:sqlite  at ~/.claude-teamforge/teamforge.db
 └─ Serves the dashboard  (prebuilt React+Vite static bundle) at /
```

The worker is the single source of truth. It **enforces** the phase state machine —
illegal transitions (e.g. `brainstorm → implementation`) are rejected with an error that
Claude sees, and the PreToolUse gate physically blocks `Write`/`Edit` on source files
until the workflow reaches `implementation` (docs/spec/plan files are always allowed;
sessions with no active workflow are never blocked).

## 3. Workflow state machine

Phases, in order: `idea → brainstorm → questions → spec → spec_gate → plan → plan_gate →
implementation → tests → review → done_gate → done`.

- `*_gate` phases are **validation gates**: the worker records a pending validation,
  the dashboard shows it under "Waiting for you", and Claude asks you in chat.
  The phase cannot advance until the validation is answered `approved`.
- Gates required: before implementation (spec_gate + plan_gate), before major
  architecture decisions (recorded as `decision` records requiring validation), and
  before marking done (done_gate).
- Skipping forward is rejected by the worker; moving backward (revision) is allowed.

## 4. The team (hybrid agent model)

Seven roles, each an `agents/*.md` definition + a dashboard card:

| Role | Execution |
|---|---|
| Product Manager | main session (owns brainstorm/questions/spec) |
| Architect | main session (owns plan; major decisions gated) |
| Frontend | real subagent when tasks are parallelizable, else main session |
| Backend | real subagent when tasks are parallelizable, else main session |
| QA / Test | real subagent (writes/runs tests, TDD-first) |
| Security | main session checklist pass over the diff |
| Reviewer | real subagent (reviews before anything is called finished) |

Whoever executes, the bootstrap instructions require reporting to the worker:
`teamforge agent <role> --status working|idle|blocked|done --note "..."` — so all seven
cards animate identically in the dashboard.

## 5. SQLite schema (6 tables)

- **sessions** — id, project_path, project_name, title, phase, created_at, updated_at
- **tasks** — id, session_id, title, role, status (`todo|in_progress|testing|review|done`), order, timestamps
- **agents** — id, session_id, role, status, note, updated_at
- **events** — id, session_id, ts, kind (`prompt|tool|phase|agent|task|decision|validation|file`), payload JSON (timeline source)
- **decisions** — id, session_id, title, detail, status (`proposed|approved|rejected`), ts (project memory)
- **validations** — id, session_id, gate, question, status (`pending|approved|changes_requested`), answer, ts

Memory: at SessionStart, the hook injects the last N approved decisions for the current
project into context — cross-session project memory without transcript compression.

## 6. Dashboard (React + Vite, SSE)

Single page at `http://127.0.0.1:4519`, dark futuristic "mission control" look:
glassmorphism cards, glowing status badges, animated pulse on working agents.

Sections: project name + current phase **phase progress bar** (10 steps) · **7 agent
cards** (role, status badge, current note, pulse animation) · **timeline** (live event
feed) · **waiting-for-you panel** (pending validations, highlighted) · **task board**
(todo/doing/done counts + list) · **files changed** · **test & review status**.

Built with Vite during development; the plugin ships the prebuilt `dist/` bundle so end
users need no build step. SSE with browser auto-reconnect; no page refresh ever needed.

## 7. Plugin file structure

```
claude-teamforge/
├─ .claude-plugin/plugin.json + marketplace.json   (installable as local marketplace)
├─ hooks/hooks.json + hook scripts (bash → node, claude-mem style)
├─ skills/teamforge/SKILL.md          ← bootstrap workflow instructions (the "law")
├─ agents/ (7 role definitions)
├─ worker/  (server.mjs, db.mjs, state-machine.mjs, cli.mjs — zero deps)
├─ dashboard/ (Vite + React source)  → dashboard/dist committed (prebuilt)
├─ tests/   (node --test: state machine, API, gate smoke tests)
└─ docs/    (this spec, install guide, demo scenario)
```

## 8. Testing

`node --test` suites, no frameworks:
1. **State machine**: every legal transition passes; `brainstorm → implementation` and
   any gate-skip is rejected.
2. **API smoke**: create session → advance phases → pending validation blocks → approve
   → reaches implementation.
3. **Gate smoke (the headline test)**: simulate the PreToolUse hook payload for a
   `Write` to `src/app.js` while phase = `brainstorm` → expect **deny**; approve both
   gates, phase = `implementation` → expect **allow**. Proves brainstorming happens
   before coding, mechanically.

## 9. Deliverables checklist

1. Architecture explanation ✔ (this doc) · 2. plugin structure · 3. bootstrap skill ·
4. worker · 5. schema · 6. dashboard · 7. install guide · 8. demo scenario "Build a
React todo app" · 9. smoke tests.

## 10. Out of scope (MVP)

Approve/reject buttons in the browser (validations answered in chat; SSE is one-way) ·
transcript compression à la claude-mem · multi-machine sync · auth (worker binds to
127.0.0.1 only).
