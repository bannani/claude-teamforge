# TeamForge v1.0 — Standalone web app with built-in agent console

**Status:** draft, awaiting approval · **Date:** 2026-11-12 · **Type:** packaging change + new feature
**Repository:** claude-teamforge (worker, dashboard, CLI)

## 1. Context

TeamForge today is a Claude Code plugin. Hooks boot a local worker, a skill tells
Claude to report every step through `node worker/cli.mjs`, and a PreToolUse hook
blocks source writes until the plan is validated. It only works inside a Claude
Code session, and the model can only be Claude.

The goal is to make TeamForge its own product: one `teamforge` command that opens
a local web app where the dashboard surrounds a chat console, with the agent loop
running inside the worker against the user's own model provider.

## 2. Goals / Non-goals

**Goals**

- G1. `teamforge` launches the worker and opens the web app for the current project.
- G2. A chat console in the centre of the dashboard drives the whole workflow.
- G3. The worker runs the agent loop itself (model calls, tools, gates).
- G4. Providers: Anthropic, OpenAI, GitHub Models (official API keys), and GitHub
  Copilot (through the installed `copilot` CLI and its own login).
- G5. The workflow law (phase order, three user gates, write lock) is enforced by
  code, not by instructions to the model.
- G6. The Claude Code plugin packaging is removed.

**Non-goals (this version)**

- Chat inside the terminal itself (the console lives in the web app).
- A settings screen (configuration is env vars + a JSON file).
- Several projects running at the same time in one worker.
- Reading OAuth tokens stored by Claude Code, Copilot or Codex. Forbidden by
  their terms; never implemented.
- Conversation compaction for very long sessions.
- A real terminal emulator (xterm.js / node-pty).

## 3. Current → desired behaviour

| Area | Current | Desired |
|---|---|---|
| Entry point | Claude Code session + plugin hooks | `teamforge` command → browser |
| Who runs the model | Claude Code | TeamForge worker (or `copilot` CLI for the Copilot provider) |
| Workflow reporting | Model shells out to `cli.mjs` | Model calls workflow tools in-process |
| Write lock | PreToolUse hook (fail-open) | Checked inside the write tools (fail-closed) |
| Gate answer | Dashboard click, then model polls `validate wait` | Dashboard click resumes the agent turn |
| Dashboard | Read-only mission control + gate buttons | Same panels around a central chat console |
| Node | ≥ 24 | ≥ 22.13 (first release with unflagged `node:sqlite`) |

## 4. Functional requirements

**Launcher**

- FR-001. `teamforge` with no arguments starts the worker if it is not running,
  then opens `http://127.0.0.1:4519/?project=<cwd>` in the browser. If the browser
  cannot be opened it prints the URL.
- FR-002. Existing subcommands (`start`, `state`, `phase`, `agent`, `task`,
  `decide`, `decide-set`, `validate ask`, `event`, `ensure-worker`, `open`) keep
  working. They are the workflow channel for the Copilot provider.
- FR-003. `validate set` and `validate wait` are removed from the CLI: a gate can
  only be answered from the web app.

**Chat console**

- FR-010. The console sits in the centre column of the dashboard and is also
  shown when there is no session yet (it replaces the empty hero's hint).
- FR-011. Sending a message when the project has no active session creates one,
  titled with the first 80 characters of the message.
- FR-012. Assistant text streams into the console as it is generated.
- FR-013. Each tool call shows as one compact line (tool name, main argument,
  ok/failed); the output is collapsed by default.
- FR-014. A Stop button cancels the running turn. The partial assistant text is
  kept and the session stays usable.
- FR-015. While a turn is running the input is disabled, except for Stop.
- FR-016. Reloading the page restores the conversation of the active session.
- FR-017. The console header shows the active provider and model.

**Agent loop**

- FR-020. The coordinator runs with a system prompt derived from the current
  `skills/teamforge/SKILL.md` (CLI instructions replaced by tool descriptions),
  plus the project's approved decisions (existing memory feature).
- FR-021. File tools: `read_file`, `write_file`, `edit_file`, `list_files`,
  `search_files`. Shell tool: `run_command`.
- FR-022. Workflow tools: `set_phase`, `set_agent_status`, `add_task`,
  `set_task_status`, `record_decision`, `set_decision_status`,
  `request_validation`, `delegate_to_role`.
- FR-023. `delegate_to_role(role, task)` runs a sub-loop with the matching
  `agents/<role>.md` prompt and the file/shell tools, marks the role `working`
  then `idle`, and returns the sub-agent's final text to the coordinator.
- FR-024. `request_validation(gate, question)` creates the validation and ends
  the turn. There is no tool that answers a validation.
- FR-025. When the user answers a validation in the web app, the worker appends
  the answer to the conversation as a user message and starts the next turn.
- FR-026. `write_file` and `edit_file` refuse when `gateAllowsWrite(phase, path)`
  refuses, and return the reason to the model as a tool error.
- FR-027. File tools refuse any path that resolves outside the session's project
  directory (after resolving symlinks).
- FR-028. `set_phase` applies the existing `canTransition` rules.
- FR-029. The conversation is persisted per session.

**Command approval**

- FR-030. `run_command` is refused before the `implementation` phase unless the
  command is on the read-only list (`ls`, `cat`, `git status`, `git log`,
  `git diff`, `rg`, `grep`, `find`, `pwd`, `node --version`).
- FR-031. Any other command pauses the turn and shows an approval card in the
  console: Allow once · Always allow `<program>` for this project · Deny.
- FR-032. "Always allow" choices are stored per project and survive restarts.
- FR-033. Commands run in the project directory with a 120 s timeout; output is
  truncated to 30 000 characters before going back to the model.

**Providers**

- FR-040. Provider and model come from `~/.claude-teamforge/config.json`
  (`provider`, `model`, optional `roles.<role>.{provider,model}`), overridable by
  `TEAMFORGE_PROVIDER` / `TEAMFORGE_MODEL`.
- FR-041. With no configuration, the first provider whose credential is present
  is used, in this order: Anthropic (`ANTHROPIC_API_KEY`), OpenAI
  (`OPENAI_API_KEY`), GitHub Models (`GITHUB_TOKEN`), Copilot (`copilot` on PATH).
- FR-042. If no provider is usable, the console shows which variable to set or
  which CLI to install, and sending is disabled.
- FR-043. Anthropic, OpenAI and GitHub Models run the TeamForge agent loop with
  streaming and tool calls.
- FR-044. Copilot runs `copilot -p` per turn in the project directory, resuming
  one Copilot session per TeamForge session, with JSONL output streamed to the
  console. Copilot uses its own tools. It reports workflow state by running the
  `teamforge` CLI.
- FR-045. For Copilot the write lock is applied through its permission flags:
  before `implementation` only `write(docs/**)`, `write(**/*.md)` and
  `shell(teamforge:*)` are allowed; from `implementation` on, `write` and the
  project's always-allowed programs are added. Flags are recomputed each turn.
- FR-046. Provider errors (bad key, rate limit, network) appear in the console
  as an error line with the provider's message; the turn ends cleanly.

**Removal**

- FR-050. `hooks/`, `worker/hook.mjs`, `skills/`, `.claude-plugin/` and
  `tests/gate.test.mjs` are deleted. README and `docs/INSTALL.md` describe the
  standalone app.

## 5. Non-functional requirements

- NFR-001 **Local only.** The worker listens on `127.0.0.1`.
- NFR-002 **Request authentication.** The worker creates a random token at start
  (`~/.claude-teamforge/worker.token`, mode 0600). Serving the dashboard sets it
  as an `HttpOnly; SameSite=Strict` cookie. Every `/api/*` and `/events` request
  must carry the cookie or an `x-teamforge-token` header (used by the CLI),
  except `GET /api/health`.
- NFR-003 **Origin checks.** Requests whose `Host` is not `127.0.0.1:<port>` or
  `localhost:<port>` are rejected (DNS rebinding). Non-GET requests with an
  `Origin` other than the worker's own are rejected.
- NFR-004 **Secrets.** API keys are never written to the database, the event
  log, the console, or `worker.log`. `config.json` is created with mode 0600.
- NFR-005 **Dependencies.** Zero runtime npm dependencies, as today. Providers
  use `fetch`.
- NFR-006 **Compatibility.** Existing databases keep working; new tables are
  added with `CREATE TABLE IF NOT EXISTS`.
- NFR-007 **Accessibility.** Console input is a labelled textarea; Enter sends,
  Shift+Enter inserts a newline; new output is announced through an
  `aria-live="polite"` region; approval and gate buttons are keyboard reachable.

## 6. Acceptance criteria

- AC-001. Given a project with no session, when the user sends "build a todo
  app", then a session exists for that project and the reply streams in.
- AC-002. Given phase `brainstorm`, when the model calls `write_file` on
  `src/app.js`, then the tool returns an error naming the phase and no file is
  created.
- AC-003. Given phase `brainstorm`, when the model calls `write_file` on
  `docs/spec.md`, then the file is written.
- AC-004. Given phase `implementation`, when the model calls `write_file` on
  `src/app.js`, then the file is written and appears in the Files panel.
- AC-005. Given any phase, when a file tool is called with `../outside.txt` or a
  symlink pointing outside the project, then it is refused.
- AC-006. Given phase `spec_gate` with no approved validation, when the model
  calls `set_phase("plan")`, then it is refused with the existing gate message.
- AC-007. Given a pending validation, when the user clicks Approve with a
  comment, then the comment appears in the conversation as a user message and a
  new turn starts without the user typing anything.
- AC-008. Given a pending validation, the tool list sent to the model contains
  no tool able to change a validation's status.
- AC-009. Given phase `implementation`, when the model calls
  `run_command("npm test")` for the first time, then the turn pauses on an
  approval card; Deny returns a refusal to the model; Always allow runs it and
  the next `npm …` command runs without a card, including after a restart.
- AC-010. Given phase `brainstorm`, when the model calls
  `run_command("rm -rf src")`, then it is refused without an approval card.
- AC-011. Given a running turn, when the user presses Stop, then streaming ends
  within 2 s, the input is enabled again, and a later message works.
- AC-012. Given a finished exchange, when the page is reloaded, then the same
  messages are displayed.
- AC-013. Given a request to `POST /api/chat` without the token, then 401.
  Given `Host: evil.example`, then 403. Given a valid token and
  `Origin: https://evil.example`, then 403.
- AC-014. Given no API key and no `copilot` binary, then the console shows the
  setup hint and the Send button is disabled.
- AC-015. Given an invalid `ANTHROPIC_API_KEY`, when a message is sent, then an
  error line shows the provider's message and the session stays usable.
- AC-016. Given the Copilot provider in phase `spec`, then the spawned command
  line allows `write(docs/**)` and `shell(teamforge:*)` and does not allow
  unscoped `write`.
- AC-017. Given `roles.backend.provider = "openai"`, when the coordinator
  delegates to `backend`, then that sub-loop uses the OpenAI adapter.
- AC-018. Unchanged: phase-order, gate and storage tests in
  `tests/state-machine.test.mjs`, `tests/db.test.mjs` and `tests/api.test.mjs`
  still pass (with the token added to API test requests).

## 7. Technical notes

```
worker/
  server.mjs          + auth, /api/chat, /api/chat/stop, /api/approvals/:id, /api/provider
  db.mjs              + messages, command_grants tables
  cli.mjs             launcher (no args) + workflow subcommands, sends the token
  config.mjs          config.json + env resolution
  auth.mjs            token file, cookie, Host/Origin checks
  agent/loop.mjs      turn loop: provider stream → tool calls → repeat
  agent/tools.mjs     file, shell and workflow tools
  agent/prompts/coordinator.md
  providers/anthropic.mjs   Messages API, SSE streaming
  providers/openai.mjs      Chat Completions format; also GitHub Models via base URL
  providers/copilot.mjs     spawns `copilot -p … --output-format json`
dashboard/src/components/Console.jsx, useChat.js
```

- **Provider interface.** One function per adapter:
  `stream({ system, messages, tools, model, signal })` yielding
  `text`, `tool_call` and `end` events. Messages are stored in a neutral shape and
  converted by each adapter. Copilot implements a different, turn-level interface
  because it owns its tool loop.
- **Streaming to the browser.** The existing `/events` SSE stream keeps sending
  snapshots as default events. Chat traffic uses named events (`chat`), which the
  current `onmessage` handler ignores.
- **Turn state.** One running turn per session, held in memory with an
  `AbortController`. Pending command approvals are promises in the same object.
  A worker restart drops a running turn; the conversation up to the last
  completed message is kept.
- **Layout.** Three columns become Crew · Console · Mission, with the timeline
  moved under Mission.
- **Defaults.** Anthropic model defaults to `claude-opus-5-5`. OpenAI and GitHub
  Models default model names are confirmed against their docs in the plan.

## 7b. Company model (added 2026-11-12, implemented)

The team is a company of 14 employees in 5 departments, defined once in
`worker/roles.mjs` (title, department, manager, mission, responsibilities,
phases, deliverable) and served by `GET /api/roles`. The seven original role
ids are unchanged. The dashboard's company column has an Office view, an Org
chart view and an employee file. In the standalone app the coordinator is the
`ceo` role, and `delegate_to_role` (FR-023) accepts every role id of the catalog.

## 8. Delivery slices

Each slice is shippable and keeps the test suite green.

1. Lower the Node floor, auth layer, token in CLI and tests.
2. Agent loop + tools + gates against a fake provider; `/api/chat`; persistence.
3. Anthropic adapter.
4. Console in the dashboard (streaming, tools, approvals, stop, reload).
5. OpenAI / GitHub Models adapter; per-role providers.
6. Copilot adapter.
7. Remove plugin packaging; `bin` entry; README, INSTALL, DEMO.

Rollback: the plugin stays on `master` at tag `v0.5.0`.

## 9. Test strategy

- `node --test 'tests/*.test.mjs'`, no network. Providers are tested against a
  local `node:http` stub that replays recorded SSE; the loop against a scripted
  fake provider.
- First red tests: AC-002 (write refused before implementation), AC-013 (401
  without token), AC-008 (no validation-answering tool).
- New files: `auth.test.mjs`, `tools.test.mjs`, `loop.test.mjs`, `chat.test.mjs`,
  `providers.test.mjs`, `copilot.test.mjs` (asserts the built argv, uses a fake
  `copilot` script for output parsing), `config.test.mjs`.
- Dashboard: `npm run build` must succeed; the console is checked by hand in the
  browser against AC-001, 007, 009, 011, 012, 014.
- One manual end-to-end run per real provider before release.

## 10. Open questions / risks

- R1. **Copilot fidelity.** Copilot's JSONL event shape and its behaviour when a
  tool is denied in `-p` mode are only known from `--help`; slice 6 starts with
  a short probe and may narrow FR-044/045.
- R2. **Copilot mid-turn phase change.** Permission flags are fixed per turn, so
  a turn that reaches `implementation` cannot write source until the next turn.
  Accepted: every gate approval already starts a new turn.
- R3. **Long sessions.** Without compaction, a very long build can exceed the
  model's context window. The turn then fails with the provider's error.
- R4. **Shell sandboxing.** `run_command` is approved per program, not
  sandboxed: an approved `npm` can run any script. Stated in the docs.
- R5. **GitHub Models limits.** Free-tier rate limits may be too low for a full
  build; surfaced through FR-046.
