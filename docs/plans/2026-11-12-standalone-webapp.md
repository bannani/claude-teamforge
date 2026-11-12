# Plan — TeamForge v1.0 standalone web app

Spec: `docs/specs/2026-11-12-standalone-webapp-design.md` · Branch: `feat/standalone-webapp`

## Global constraints

- Zero runtime npm dependencies. Node ≥ 22.13. ES modules, same style as `worker/*.mjs`.
- Every task is test-first. Full suite: `npm test` (= `node --test 'tests/*.test.mjs'`). No test touches the network.
- Tests create their server with `createTeamforgeServer({ dbPath, token: 'test-token', ... })` and never read `~/.claude-teamforge`.
- API keys never reach the DB, events, console stream or logs (NFR-004).
- Commits: one per task, `feat|test|docs|chore: summary`, no co-author trailer.

## Interfaces (shared by all tasks)

```
// worker/auth.mjs
createAuth({ token, port }) → { check(req) → {ok:true} | {ok:false,status:401|403,error}, cookieHeader() }
loadOrCreateToken(dir) → string            // writes <dir>/worker.token, mode 0600

// worker/config.mjs
loadConfig({ env, dir, which }) → { provider, model, roles, reason? }   // provider null → reason = setup hint
resolveFor(config, role?) → { provider, model }

// neutral message shape (stored in messages.content as JSON)
{ role:'user', content:string }
{ role:'assistant', content:string, toolCalls:[{id,name,input}] }
{ role:'tool', toolCallId, name, content:string, isError:boolean }

// provider adapter (anthropic, openai)
async function* stream({ system, messages, tools, model, signal })
  yields {type:'text',text} | {type:'tool_call',id,name,input} | {type:'end',stopReason}
  throws ProviderError(message, status)

// worker/agent/tools.mjs
createTools(ctx) → { defs:[{name,description,input_schema}], run(name,input) → {content,isError,endTurn?} }
ctx = { db, sessionId, projectDir, broadcast, approve(command) → Promise<'once'|'always'|'deny'>, delegate(role,task) → Promise<string> }

// worker/agent/loop.mjs
runTurn({ provider, model, system, history, tools, emit, signal, save }) → Promise<'end'|'stopped'|'error'|'awaiting_validation'>
emit(event)  event ∈ {type:'text'|'tool_start'|'tool_end'|'approval'|'error'|'turn_end', ...}
```

HTTP additions: `GET /api/provider` · `GET /api/chat?project=` (history) · `POST /api/chat {project_path,text}` → 202 ·
`POST /api/chat/stop {project_path}` · `POST /api/approvals/:id {decision}`. SSE named event `chat` carries `emit` events.

DB additions: `messages(id, session_id, content TEXT, ts)` · `command_grants(project_path, program, UNIQUE(project_path, program))`.

---

## Slice 1 — foundations

### Task 1 · Node floor and green baseline
Files: modify `package.json` (`engines.node: ">=22.13"`, add `"bin": {"teamforge": "worker/cli.mjs"}`).
- [ ] Run `npm test` → record the baseline (expected: 34 pass on Node 22; if `node:sqlite` fails to import, stop and report).
- [ ] Edit `package.json`; run `npm test` → same count.

### Task 2 · Auth layer (NFR-002, NFR-003, AC-013)
Files: create `worker/auth.mjs`, `tests/auth.test.mjs`; modify `worker/server.mjs`, `worker/cli.mjs`, `tests/api.test.mjs`, `tests/cli.test.mjs`.
- [ ] Write `tests/auth.test.mjs`: `health needs no token` (200) · `api without token → 401` · `api with x-teamforge-token → 200` · `api with cookie → 200` · `Host evil.example → 403` · `POST with Origin https://evil.example → 403` · `GET / sets HttpOnly SameSite=Strict cookie` · `loadOrCreateToken writes mode 0600 and is stable across calls`.
- [ ] `node --test tests/auth.test.mjs` → fails (module missing).
- [ ] Implement `auth.mjs`; in `server.mjs` accept `{ token }`, call `auth.check` before `/api/*` and `/events` (skip `/api/health`), set the cookie in `serveStatic` for `index.html`. Entry point uses `loadOrCreateToken(~/.claude-teamforge)`.
- [ ] `cli.mjs`: send `x-teamforge-token` from `TEAMFORGE_TOKEN` or the token file. Tests pass the header / env.
- [ ] `npm test` → all green.

### Task 3 · Config resolution (FR-040..042, AC-014)
Files: create `worker/config.mjs`, `tests/config.test.mjs`.
- [ ] Tests: `explicit config wins` · `env TEAMFORGE_PROVIDER/MODEL override file` · `auto order anthropic > openai > github > copilot` · `nothing available → provider null and reason lists the three variables and copilot` · `roles.backend overrides in resolveFor` · `default models: anthropic claude-opus-5-5, openai gpt-5.6-sol, github openai/gpt-4.1, copilot null`.
- [ ] Run → fail. Implement (`which` injected so tests don't depend on PATH). Run → pass.

## Slice 2 — agent core

### Task 4 · Storage (FR-029, FR-032)
Files: modify `worker/db.mjs`, `tests/db.test.mjs`.
- [ ] Tests: `addMessage/listMessages round-trip in order` · `grantCommand is idempotent, isGranted true only for that project`.
- [ ] Run → fail. Add the two tables and four methods. Run → pass.

### Task 5 · File and workflow tools (FR-021, 022, 024, 026..028, AC-002..006, 008)
Files: create `worker/agent/tools.mjs`, `tests/tools.test.mjs`.
- [ ] Tests on a temp project dir: AC-002 `write_file src/app.js in brainstorm → isError, file absent` · AC-003 `docs/spec.md written` · AC-004 `implementation → written + file event` · AC-005 `../outside.txt refused` and `symlink to outside refused` · `edit_file replaces a unique string, errors when not found or ambiguous` · `read_file / list_files / search_files happy paths, read of missing file isError` · AC-006 `set_phase plan from spec_gate without approval → isError with gate message` · `add_task, set_task_status, record_decision, set_decision_status, set_agent_status mutate the snapshot` · `request_validation creates a pending validation and returns endTurn:true` · AC-008 `no def name matches /valid/ except request_validation`.
- [ ] Run → fail. Implement; path guard = `realpath` of the nearest existing ancestor must be inside `realpath(projectDir)`. `search_files` walks the tree in JS (skips `node_modules`, `.git`), 200-match cap. Run → pass.

### Task 6 · run_command and approvals (FR-030..033, AC-009, 010)
Files: modify `worker/agent/tools.mjs`, `tests/tools.test.mjs`.
- [ ] Tests: AC-010 `rm -rf src in brainstorm → isError, approve never called` · `git status in brainstorm runs without approve` · `read-only prefix followed by ; && | > or backtick is not read-only` · AC-009 `implementation: approve→'deny' gives isError; 'once' runs; 'always' runs and stores the grant; next call skips approve` · `output over 30000 chars is truncated with a marker` · `timeout kills the process (timeout injected as 200 ms)`.
- [ ] Run → fail. Implement with `spawn('bash', ['-c', cmd], {cwd})`; program = first token. Run → pass.

### Task 7 · Turn loop (FR-020, 023, 025, AC-011)
Files: create `worker/agent/loop.mjs`, `worker/agent/prompts/coordinator.md`, `tests/loop.test.mjs`, `tests/helpers/fake-provider.mjs`.
- [ ] Tests with a scripted provider: `text only → one assistant message saved, returns 'end'` · `tool_call → tool runs, result fed back, second provider call sees it` · `tool with endTurn → returns 'awaiting_validation' without another provider call` · `abort mid-stream → 'stopped', partial text saved` · `provider throws → emit error, returns 'error', history still valid (no dangling tool call)` · `40 tool rounds cap → error`.
- [ ] Run → fail. Implement. `coordinator.md` = SKILL.md rewritten for tools (no CLI path, no `validate wait`). Run → pass.

### Task 8 · Chat endpoints and turn manager (FR-011, 014..016, 025, AC-001, 007, 012, 017)
Files: create `worker/agent/session.mjs` (turn registry, delegate, system prompt + memory); modify `worker/server.mjs`; create `tests/chat.test.mjs`.
- [ ] Tests (server built with `providers: { fake }`): AC-001 `POST /api/chat on a fresh project creates a session and SSE receives chat text events` · AC-012 `GET /api/chat returns the saved messages` · `second POST while running → 409` · AC-011 `stop → turn_end stopped within 2 s, next POST accepted` · AC-007 `PATCH validation approved with answer → user message "[spec_gate approved] <answer>" saved and a new turn starts` · `approval card: emit approval, POST /api/approvals/:id resolves it` · AC-017 `delegate_to_role backend uses the provider from roles.backend` · AC-014 `GET /api/provider with nothing configured → {provider:null, reason}` and `POST /api/chat → 400 with the reason`.
- [ ] Run → fail. Implement. Remove `PATCH /api/validations` access from the CLI path later (Task 13). Run `npm test` → green.

## Slice 3 — Anthropic

### Task 9 · Anthropic adapter (FR-043, 046, AC-015)
Files: create `worker/providers/anthropic.mjs`, `worker/providers/sse.mjs` (shared line parser), `tests/providers.test.mjs`, `tests/helpers/stub-api.mjs`.
- [ ] Load the `claude-api` skill first; follow it for headers, streaming event names, tool_use / tool_result shapes and prompt caching.
- [ ] Tests against a local `node:http` stub replaying recorded SSE: `text deltas become text events` · `tool_use with split input_json_delta becomes one tool_call with parsed input` · `request body: system, tools, converted messages (assistant toolCalls → tool_use blocks, tool → tool_result in a user turn), stream:true` · `401 → ProviderError carrying the API message` · `abort signal stops the stream`.
- [ ] Run → fail. Implement (`baseUrl` injectable). Run → pass.

## Slice 4 — console

### Task 10 · Console UI (FR-010, 012..017, NFR-007)
Files: create `dashboard/src/components/Console.jsx`, `dashboard/src/useChat.js`; modify `dashboard/src/App.jsx`, `dashboard/src/useTeamState.js` (pass `?project=`), `dashboard/src/styles.css`; rebuild `dashboard/dist`.
- [ ] `useChat`: loads `/api/chat` + `/api/provider`, listens to SSE `chat`, exposes `{messages, running, pending approval, send, stop, answerApproval, provider}`.
- [ ] `Console`: transcript (`aria-live="polite"`), tool lines with collapsed output, approval card, textarea (Enter / Shift+Enter), Send / Stop, provider badge, setup hint when `provider` is null.
- [ ] `App`: columns Crew · Console · Mission (timeline under Mission); empty state renders the console instead of the hint line.
- [ ] `cd dashboard && npm install && npm run build` → build succeeds.
- [ ] Manual check with `TEAMFORGE_PROVIDER=fake` dev provider is not shipped; check in the browser with a real key: AC-001, 007, 009, 011, 012, 014.

## Slice 5 — OpenAI and GitHub Models

### Task 11 · OpenAI-format adapter (FR-043, 046)
Files: create `worker/providers/openai.mjs`; extend `tests/providers.test.mjs`.
- [ ] Tests: `content deltas → text` · `tool_calls deltas accumulated by index → tool_call` · `message conversion (tool role with tool_call_id; system as first message)` · `github provider uses https://models.github.ai/inference and GITHUB_TOKEN` · `429 → ProviderError with message`.
- [ ] Run → fail. Implement `/chat/completions` with `stream:true`. Run → pass.
- [ ] One real call per provider if a key is present, to confirm the default model ids (`gpt-5.6-sol`, `openai/gpt-4.1`); adjust the defaults in `config.mjs` if refused.

## Slice 6 — Copilot

### Task 12 · Copilot adapter (FR-044, 045, AC-016, R1)
Files: create `worker/providers/copilot.mjs`, `tests/copilot.test.mjs`, `tests/helpers/fake-copilot.mjs`; modify `worker/agent/session.mjs`.
- [ ] Probe: run `copilot -p "say hi" --output-format json` once in a temp dir, save the JSONL as the test fixture, note the event names in the file header. If text deltas are not exposed, fall back to one text event per message and say so in the docs.
- [ ] Tests: AC-016 `buildArgs(phase 'spec')` contains `write(docs/**)`, `write(**/*.md)`, `shell(teamforge:*)` and no bare `write` · `buildArgs('implementation', grants ['npm'])` adds `write` and `shell(npm:*)` · `same --session-id reused for one TeamForge session` · `fixture JSONL → text events` · `non-zero exit → error event with stderr tail` · `abort kills the child`.
- [ ] Run → fail. Implement; the system prompt for Copilot is `coordinator.md` with the tool section replaced by the `teamforge` CLI usage, passed as the prompt prefix on the first turn. Run → pass.

## Slice 7 — packaging

### Task 13 · Launcher and plugin removal (FR-001..003, FR-050)
Files: modify `worker/cli.mjs`, `tests/cli.test.mjs`; delete `hooks/`, `worker/hook.mjs`, `skills/`, `.claude-plugin/`, `tests/gate.test.mjs`.
- [ ] Tests: `no arguments → ensure-worker then prints the dashboard URL with ?project=` (with `--no-open`) · `validate set` and `validate wait` → usage, exit 1 · remove the two `validate wait` tests.
- [ ] Run → fail. Implement, delete files. `npm test` → green.

### Task 14 · Docs and version
Files: `README.md`, `docs/INSTALL.md`, `docs/DEMO.md`, `package.json` (1.0.0).
- [ ] Rewrite for the standalone app: install (`npm link`), provider setup table, config.json example, security notes (R4), Copilot limits (R2).
- [ ] `npm test` and `cd dashboard && npm run build` → both succeed. Final review against every AC.

## Coverage

FR-001..003 → T13 · FR-010..017 → T8, T10 · FR-020..029 → T4, T5, T7, T8 · FR-030..033 → T6 · FR-040..042 → T3 · FR-043, 046 → T9, T11 · FR-044, 045 → T12 · FR-050 → T13 · NFR-001..003 → T2 · NFR-004 → T3, T9 (asserted: error events never contain the key) · NFR-007 → T10.
