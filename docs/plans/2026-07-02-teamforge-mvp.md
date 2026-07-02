# Claude TeamForge MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin that forces the Brainstorm→…→Done workflow through a state-machine-enforcing local worker, with a live React dashboard showing a 7-role agent team.

**Architecture:** Hooks (SessionStart/UserPromptSubmit/PostToolUse/PreToolUse) feed a zero-dependency Node 24 worker holding SQLite state; the worker enforces phase transitions and gate validations, serves an SSE stream and a prebuilt React dashboard. Claude drives the workflow via a `teamforge` CLI whose errors it can read.

**Tech Stack:** Node ≥ 24 (`node:sqlite`, `node:test`, `node:http`), React 18 + Vite (dev-only deps), SSE, bash hook shims.

## Global Constraints

- Worker binds `127.0.0.1:4519` only. DB at `~/.claude-teamforge/teamforge.db`.
- Worker + CLI + hooks: **zero npm runtime dependencies**. Dashboard deps are devDependencies only; `dashboard/dist/` is committed.
- Phases (exact strings, ordered): `idea, brainstorm, questions, spec, spec_gate, plan, plan_gate, implementation, tests, review, done_gate, done`.
- Gate phases: `spec_gate`, `plan_gate`, `done_gate` — forward exit requires an `approved` validation row for that gate.
- Roles (exact strings): `pm, architect, frontend, backend, qa, security, reviewer`.
- Agent statuses: `idle, working, blocked, done`. Task statuses: `todo, in_progress, testing, review, done`.
- Event kinds: `prompt, tool, phase, agent, task, decision, validation, file, note`.
- All mutations broadcast the **full state snapshot** over SSE (state is small; no diffing).
- TDD: every worker module lands with `node --test` coverage in the same task.

## File Structure

```
claude-teamforge/
├─ .claude-plugin/plugin.json          plugin manifest
├─ .claude-plugin/marketplace.json     local-marketplace entry
├─ hooks/hooks.json                    hook wiring (4 events)
├─ hooks/session-start.sh              start worker + inject bootstrap + decisions
├─ hooks/emit-event.sh                 UserPromptSubmit + PostToolUse shim → CLI
├─ hooks/gate-check.sh                 PreToolUse Write|Edit shim → CLI gate
├─ skills/teamforge/SKILL.md           bootstrap workflow law
├─ agents/{pm,architect,frontend,backend,qa,security,reviewer}.md
├─ worker/db.mjs                       schema + queries (node:sqlite)
├─ worker/state-machine.mjs            pure transition/gate logic
├─ worker/server.mjs                   HTTP + SSE + static + API
├─ worker/cli.mjs                      teamforge CLI (HTTP client)
├─ dashboard/ (Vite React src)  + dashboard/dist (committed build)
├─ tests/{state-machine,api,gate}.test.mjs
└─ docs/ (spec, plans, INSTALL.md, DEMO.md)
```

---

### Task 1: Plugin scaffold & manifests

**Files:** Create `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `package.json`, `.gitignore`, `README.md` stub.

**Produces:** installable plugin identity `claude-teamforge`; `npm test` = `node --test tests/`.

- [ ] **Step 1:** Write `plugin.json` (name `claude-teamforge`, version `0.1.0`, description, author) and `marketplace.json` (`{"name":"teamforge-local","owner":{"name":"fares"},"plugins":[{"name":"claude-teamforge","source":"./","description":"..."}]}`).
- [ ] **Step 2:** `package.json`: `{"name":"claude-teamforge","type":"module","scripts":{"test":"node --test tests/","worker":"node worker/server.mjs"}}`. `.gitignore`: `node_modules`, `dashboard/node_modules`, `*.db`.
- [ ] **Step 3:** Commit `chore: plugin scaffold`.

### Task 2: State machine (pure logic, TDD)

**Files:** Create `worker/state-machine.mjs`, `tests/state-machine.test.mjs`.

**Produces:**
- `PHASES: string[]`, `GATES = {spec_gate:'spec_gate', ...}` (the 3 gate names)
- `canTransition(from, to, {gateApproved}) -> {ok:boolean, reason?:string}`
  Rules: backward always ok; forward only to the immediate next phase; leaving a gate phase forward requires `gateApproved === true`; unknown phase → `{ok:false}`.
- `isGate(phase) -> boolean`, `phaseIndex(phase) -> number`
- `gateAllowsWrite(phase, filePath) -> {allow, reason}`: allow if phase ∈ `implementation|tests|review|done_gate|done`; else allow only paths matching `/(^|\/)(docs|\.claude|\.claude-plugin)\//` or `\.md$`; deny otherwise with reason naming the current phase.

- [ ] **Step 1:** Write failing tests: next-phase advance ok; skip (`brainstorm→spec`) rejected; backward ok; `spec_gate→plan` rejected without approval, ok with; same for `plan_gate→implementation`, `done_gate→done`; `gateAllowsWrite('brainstorm','src/app.js')` denies; `('brainstorm','docs/x.md')` allows; `('implementation','src/app.js')` allows.
- [ ] **Step 2:** `node --test tests/state-machine.test.mjs` → FAIL (module missing).
- [ ] **Step 3:** Implement module (~60 lines, no deps).
- [ ] **Step 4:** Tests PASS. **Step 5:** Commit `feat: workflow state machine with gate enforcement`.

### Task 3: SQLite layer

**Files:** Create `worker/db.mjs`, `tests/db.test.mjs`.

**Produces:** `openDb(path=default)` returning object with: `createSession({project_path,project_name,title})` (seeds 7 agent rows, phase `idea`), `getActiveSession(project_path)` (latest with phase≠done), `getLatestSession()`, `setPhase(id,phase)`, `upsertAgent(sessionId,role,status,note)`, `addTask/updateTask`, `addEvent(sessionId,kind,payload)`, `addDecision/updateDecision`, `addValidation/answerValidation`, `hasApprovedValidation(sessionId,gate)`, `approvedDecisions(project_path,limit)`, `snapshot(sessionId)` → `{session,agents,tasks,validations,decisions,events(last 100),files}` (files = distinct file paths from `file` events).

Schema (exact):

```sql
CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY, project_path TEXT NOT NULL,
 project_name TEXT, title TEXT, phase TEXT NOT NULL DEFAULT 'idea',
 created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS agents(id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL,
 role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'idle', note TEXT DEFAULT '',
 updated_at TEXT DEFAULT (datetime('now')), UNIQUE(session_id, role));
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL,
 title TEXT NOT NULL, role TEXT, status TEXT NOT NULL DEFAULT 'todo', ord INTEGER DEFAULT 0,
 created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, session_id INTEGER, ts TEXT
 DEFAULT (datetime('now')), kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS decisions(id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL,
 project_path TEXT NOT NULL, title TEXT NOT NULL, detail TEXT DEFAULT '',
 status TEXT NOT NULL DEFAULT 'proposed', ts TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS validations(id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL,
 gate TEXT NOT NULL, question TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 answer TEXT DEFAULT '', ts TEXT DEFAULT (datetime('now')));
```

- [ ] **Step 1:** Failing tests (temp db file): create session seeds 7 agents; setPhase updates; hasApprovedValidation false→true after answerValidation('approved'); snapshot shape.
- [ ] **Step 2:** FAIL run. **Step 3:** Implement with `node:sqlite` `DatabaseSync`. **Step 4:** PASS. **Step 5:** Commit `feat: sqlite storage layer`.

### Task 4: Worker HTTP server + SSE

**Files:** Create `worker/server.mjs`, `tests/api.test.mjs`.

**Interfaces (API contract, JSON in/out):**

| Route | Body | Behavior |
|---|---|---|
| `POST /api/sessions` | `{project_path, project_name, title}` | create, 201 `{session}` |
| `GET /api/state?project=` | — | snapshot of active session for project (fallback: latest overall); `{empty:true}` if none |
| `POST /api/sessions/:id/phase` | `{phase}` | via `canTransition` + `hasApprovedValidation`; 409 `{error}` on refusal |
| `POST /api/sessions/:id/agents` | `{role,status,note}` | upsert |
| `POST /api/sessions/:id/tasks` · `PATCH /api/tasks/:id` | `{title,role}` · `{status}` | |
| `POST /api/sessions/:id/decisions` · `PATCH /api/decisions/:id` | `{title,detail}` · `{status}` | |
| `POST /api/sessions/:id/validations` · `PATCH /api/validations/:id` | `{gate,question}` · `{status,answer}` | |
| `POST /api/sessions/:id/events` | `{kind,payload}` | append |
| `POST /api/gate-check` | `{project_path, file_path}` | `{allow, reason}` via active session phase + `gateAllowsWrite`; no active session → allow |
| `GET /api/decisions?project=&limit=` | — | approved decisions (memory recall) |
| `GET /events` | — | SSE; on connect + every mutation: `data: <full snapshot JSON>` |
| `GET /*` | — | static from `dashboard/dist`, index fallback |

Every mutating route also writes an `events` row (kind = route domain) and broadcasts.
`server.mjs` exports `createServer({dbPath})` for tests; `main` guards actual listen. Health: `GET /api/health` → `{ok:true,version}`.

- [ ] **Step 1:** Failing API tests using `fetch` against server on ephemeral port + temp db: session lifecycle; phase skip → 409; gate flow (`spec_gate` blocked → validation approved → `plan` ok); gate-check deny in `brainstorm` / allow in `implementation`.
- [ ] **Step 2:** FAIL run. **Step 3:** Implement (router ~200 lines, `node:http`, SSE client set, JSON body helper). **Step 4:** PASS. **Step 5:** Commit `feat: worker server with SSE and gate API`.

### Task 5: teamforge CLI

**Files:** Create `worker/cli.mjs`, `tests/cli.test.mjs`.

**Produces (commands, all print JSON responses; nonzero exit + stderr message on 4xx/5xx so Claude sees refusals):**

```
node cli.mjs start --project <path> --name <n> --title <t>
node cli.mjs phase <phase>            # uses active session for cwd project
node cli.mjs agent <role> --status <s> [--note <text>]
node cli.mjs task add <title> [--role r] | task set <id> <status>
node cli.mjs decide <title> [--detail d] | decide-set <id> approved|rejected
node cli.mjs validate ask <gate> <question> | validate set <id> approved|changes_requested [--answer a]
node cli.mjs event <kind> [--json payload]
node cli.mjs ensure-worker             # spawn detached server if /api/health fails
node cli.mjs gate-check <file_path>    # prints {allow,reason}; exit 2 on deny
```

`--project` defaults to `process.env.TEAMFORGE_PROJECT || process.cwd()`. Worker URL `http://127.0.0.1:4519`.

- [ ] **Step 1:** Failing test: spawn server (in-process), run cli `start` then `phase brainstorm` via `execFile(node, [cli.mjs,...])`, assert stdout JSON + exit codes (phase skip → exit 1).
- [ ] **Step 2:** FAIL. **Step 3:** Implement (~150 lines, arg parser + fetch). **Step 4:** PASS. **Step 5:** Commit `feat: teamforge CLI`.

### Task 6: Hooks + gate smoke test (headline)

**Files:** Create `hooks/hooks.json`, `hooks/session-start.sh`, `hooks/emit-event.sh`, `hooks/gate-check.sh`, `tests/gate.test.mjs`.

**Wiring (`hooks.json`):** SessionStart(matcher `startup|clear|compact`) → `session-start.sh`; UserPromptSubmit → `emit-event.sh prompt`; PostToolUse(matcher `*`) → `emit-event.sh tool`; PreToolUse(matcher `Write|Edit`) → `gate-check.sh`. All commands `"${CLAUDE_PLUGIN_ROOT}/hooks/<script>"`.

**Behaviors:**
- `session-start.sh`: `node cli.mjs ensure-worker`; fetch `/api/decisions?project=$CWD`; emit `hookSpecificOutput.additionalContext` = SKILL.md content + "Past project decisions:" list. Never fail the session (exit 0 always).
- `emit-event.sh`: reads stdin JSON, extracts `session_id`,`prompt` or `tool_name`,`tool_input.file_path`; POSTs event via cli (`event prompt|tool`); for Write/Edit also `event file`. Always exit 0, output `{"suppressOutput":true}`.
- `gate-check.sh`: reads stdin JSON (`tool_input.file_path`, `cwd`); runs `cli.mjs gate-check`; on deny prints `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<reason> — advance the TeamForge workflow first (teamforge phase …)"}}`; on allow prints permissionDecision `allow`; if worker unreachable → allow (fail-open).

- [ ] **Step 1:** Failing `tests/gate.test.mjs`: boot server+temp db; create session in `brainstorm`; pipe fake PreToolUse stdin JSON for `Write src/app.js` into `gate-check.sh` → expect deny JSON; approve spec_gate & plan_gate validations, advance to `implementation`; rerun hook → expect allow. **This is the proof that brainstorming precedes coding.**
- [ ] **Step 2:** FAIL. **Step 3:** Implement scripts (bash shims ≤25 lines each, all logic in cli). **Step 4:** PASS + `chmod +x`. **Step 5:** Commit `feat: hooks with write-gate enforcement`.

### Task 7: Bootstrap skill + 7 agent roles

**Files:** Create `skills/teamforge/SKILL.md`, `agents/*.md` (7 files).

**SKILL.md contents (the law, ~120 lines):** frontmatter (name, description with trigger words); the phase order; the rule table — on any new feature/build request: `teamforge start`, then walk phases in order, PM role for brainstorm/questions/spec, `validate ask spec_gate` + STOP for user, architect for plan + tasks (`task add` each), `validate ask plan_gate` + STOP, hybrid execution rules (spawn subagents `teamforge-frontend` etc. for parallelizable tasks; always `agent <role> --status` before/after), TDD required in implementation, qa runs tests phase, security checklist pass, reviewer must run before `done_gate`, `validate ask done_gate` + STOP, then `phase done` + final summary + `decide` records for key choices. Includes exact CLI invocations with `${CLAUDE_PLUGIN_ROOT}` path.

**agents/*.md:** each with frontmatter `name: teamforge-<role>`, `description`, `tools`; body = role charter + duty to call `teamforge agent <role> --status working|done --note` at start/end.

- [ ] **Step 1:** Write SKILL.md. **Step 2:** Write 7 agent files. **Step 3:** Reference SKILL path in `session-start.sh` (already coded to cat it). **Step 4:** Commit `feat: bootstrap skill and team agent roles`.

### Task 8: Dashboard (React + Vite)

**Files:** Create `dashboard/{index.html,vite.config.js,package.json,src/main.jsx,src/App.jsx,src/useTeamState.js,src/components/{PhaseBar,AgentGrid,Timeline,ValidationPanel,TaskBoard,FilesPanel,StatusStrip}.jsx,src/styles.css}`; commit `dashboard/dist`.

**Interfaces:** `useTeamState()` → `{state, connected}`; opens `EventSource('/events')`, each message = full snapshot; initial `fetch('/api/state')`. Components consume snapshot fields exactly as `db.snapshot()` produces.

**Design:** dark mission-control: bg `#0a0e17`, panel glass `rgba(20,28,46,.72)` + `backdrop-filter: blur`, accent cyan `#4fd8eb`/violet `#8b7cf6`, working-agent cards pulse (CSS keyframes on box-shadow), phase bar = 10 visible steps (gates rendered as lock icons between steps), pending validation panel glows amber, status badges pill-shaped, timeline monospace feed newest-first, `Inter`/system font stack, responsive grid `repeat(auto-fit,minmax(280px,1fr))`.

- [ ] **Step 1:** Scaffold Vite react app (manual files, no create-vite noise), `vite.config.js` with `build.outDir dist`, proxy `/api|/events` → 4519 for dev.
- [ ] **Step 2:** Implement `useTeamState` + all components + styles.
- [ ] **Step 3:** `npm install && npm run build` inside `dashboard/`; verify `dist/index.html` exists.
- [ ] **Step 4:** Serve via worker; `curl localhost:4519/` returns the app; drive fake session via CLI and verify SSE updates (curl `/events` shows snapshots).
- [ ] **Step 5:** Commit `feat: mission-control dashboard` (including dist).

### Task 9: Docs — install guide + demo scenario

**Files:** Create `docs/INSTALL.md`, `docs/DEMO.md`, finish `README.md`.

- [ ] **Step 1:** INSTALL.md: requirements (Node ≥ 24); `/plugin marketplace add /home/fares/claude-teamforge`; `/plugin install claude-teamforge@teamforge-local`; `/reload-plugins`; open `http://127.0.0.1:4519`; uninstall/update notes; troubleshooting (port busy, worker log at `~/.claude-teamforge/worker.log`).
- [ ] **Step 2:** DEMO.md: scripted "Build a React todo app" walkthrough — the exact user prompt, expected phase-by-phase behavior, what the dashboard shows at each gate, expected refusal if user says "just code it now" (gate hook denial text), and the two validation prompts the user must answer.
- [ ] **Step 3:** README: pitch, architecture diagram (ASCII), links. Commit `docs: install guide and demo scenario`.

### Task 10: End-to-end smoke + release check

- [ ] **Step 1:** `npm test` — full suite green.
- [ ] **Step 2:** Manual e2e: `ensure-worker`; CLI-drive the demo happy path idea→done in a scratch project dir; watch dashboard; confirm decisions recall via `GET /api/decisions`.
- [ ] **Step 3:** Install plugin into Claude Code via local marketplace; `/reload-plugins`; verify hooks fire (worker log) and SKILL injects.
- [ ] **Step 4:** Commit `chore: v0.1.0 MVP`, tag `v0.1.0`.

## Self-Review Notes

Spec coverage: §2 hooks→Tasks 6, worker→4, CLI→5, memory recall→Tasks 4+6 (`/api/decisions` + session-start injection); §3 state machine→2; §4 roles→7; §5 schema→3; §6 dashboard→8; §7 structure→1; §8 tests→2/4/6/10; deliverable 7→9; demo→9. Types cross-checked: phase/role/status enums centralized in Global Constraints and `state-machine.mjs`; snapshot shape defined once in Task 3 and consumed by Tasks 4 & 8.
