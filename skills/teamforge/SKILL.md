---
name: teamforge
description: The TeamForge team workflow. Use whenever the user asks to build, create, implement, or add a feature, app, or component — BEFORE writing any code. Runs the visible team pipeline Brainstorm → Questions → Spec → validation → Plan → validation → Implementation → Tests → Review → validation → Done.
---

# TeamForge — how the team works

You are the coordinator of a visible 7-role team. Everything the team does is
reported to the local worker and shown live on the dashboard at
**http://127.0.0.1:4519**. The worker *enforces* the workflow: it rejects phase
skips, and a PreToolUse hook blocks writing source files until the plan is
validated. Do not fight the gates — they are the product.

## The command

All reporting goes through one CLI (always use the absolute path):

```
node "${CLAUDE_PLUGIN_ROOT}/worker/cli.mjs" <command>
```

Referred to below as `teamforge`. Every command prints JSON; a nonzero exit
means the worker refused — read stderr and fix the workflow state instead of
retrying.

## The law: phase order

`idea → brainstorm → questions → spec → spec_gate → plan → plan_gate →
implementation → tests → review → done_gate → done`

**On any new build/feature request** (user describes something to create):

1. `teamforge ensure-worker` then `teamforge start --name "<project>" --title "<one-line idea>"`
   Tell the user the dashboard is live at http://127.0.0.1:4519.
2. **brainstorm** — `teamforge phase brainstorm`; `teamforge agent pm --status working --note "brainstorming"`. Explore the idea: purpose, users, constraints, success criteria. NO CODE.
3. **questions** — `teamforge phase questions`. Ask the user clarifying questions (one at a time, multiple choice when possible).
4. **spec** — `teamforge phase spec`. Write a short readable spec (markdown file in the project's `docs/`). Record key choices: `teamforge decide "<title>" --detail "<why>"`.
5. **spec_gate** — `teamforge phase spec_gate`; `teamforge validate ask spec_gate "<summary question>"`. **STOP. Ask the user to validate the spec in chat. Do not proceed on your own.** When they answer: `teamforge validate set <id> approved --answer "<their words>"` (or `changes_requested` → go back to spec).
6. **plan** — `teamforge phase plan`; `teamforge agent architect --status working`. Write the implementation plan; split into small tasks: `teamforge task add "<task title>" --role frontend|backend|qa`. Major architecture decisions: `teamforge decide` + ask the user before locking them in.
7. **plan_gate** — `teamforge phase plan_gate`; `teamforge validate ask plan_gate "..."`. **STOP for user validation again.**
8. **implementation** — `teamforge phase implementation`. Execute tasks in order:
   - Before starting a task: `teamforge task set <id> in_progress` and `teamforge agent <role> --status working --note "<task>"`.
   - **TDD**: write the failing test first, then the minimal implementation.
   - Independent frontend/backend tasks MAY be dispatched to the `teamforge-frontend` / `teamforge-backend` subagents; otherwise do them yourself in that role.
   - After each task: `teamforge task set <id> done`, agent back to `idle`.
9. **tests** — `teamforge phase tests`; `teamforge agent qa --status working`. Run the full test suite; fix failures. Then `teamforge agent security --status working` and do a security pass over the diff (secrets, injection, unsafe input handling).
10. **review** — `teamforge phase review`; `teamforge agent reviewer --status working`. Review the whole diff against the spec (or dispatch the `teamforge-reviewer` subagent). Fix findings.
11. **done_gate** — `teamforge phase done_gate`; `teamforge validate ask done_gate "..."`. **STOP. Show the user a final summary (what was built, files, test results) and ask them to confirm completion.**
12. **done** — `teamforge phase done`. Record remaining decisions with `teamforge decide` and approve the good ones with `teamforge decide-set <id> approved` — these become permanent project memory injected into future sessions.

## Hard rules

- **Never write source code before `implementation`.** The hook will block you; if it does, that is correct behavior — go back and complete the workflow.
- **Never answer a validation yourself.** Gates are the user's voice: ask in chat, wait, then record their answer verbatim.
- **Keep the dashboard honest.** Update agent status when a role starts/stops working; log notable moments with `teamforge event note --json '{"text":"..."}'`.
- Trivial requests (typo fix, one-line change, a question) do NOT need the pipeline — use judgment; the pipeline is for building things.
- If the worker is unreachable, say so and continue working normally (the workflow is not a hostage).
