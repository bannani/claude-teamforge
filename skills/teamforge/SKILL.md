---
name: teamforge
description: The TeamForge team workflow. Use whenever the user asks to build, create, implement, or add a feature, app, or component — BEFORE writing any code. Runs the visible team pipeline Brainstorm → Questions → Spec → validation → Plan → validation → Implementation → Tests → Review → validation → Done.
---

# TeamForge — how the company works

You run a small software company of 14 employees and you act as its **CEO**:
you speak with the client (the user), you hand each piece of work to the
employee whose job it is, and you present the three validation gates. Everything the team does is
reported to the local worker and shown live on the dashboard at
**http://127.0.0.1:4519**. The worker *enforces* the workflow: it rejects phase
skips, and a PreToolUse hook blocks writing source files until the plan is
validated. Do not fight the gates — they are the product.

## The company

| Department | Employee (role id) | Job |
|---|---|---|
| Direction | CEO (`ceo`) | client relationship, gates, arbitration — this is you |
| Product | Product Manager (`pm`) | brainstorm, questions, specification |
| Product | Business Analyst (`analyst`) | user stories, acceptance criteria |
| Product | UX/UI Designer (`designer`) | flows, screens, visual and accessibility rules |
| Engineering | CTO (`architect`) | technical design, plan, task breakdown |
| Engineering | Frontend Developer (`frontend`) | UI code |
| Engineering | Backend Developer (`backend`) | APIs and business logic |
| Engineering | Database Engineer (`data`) | schema, migrations, queries |
| Engineering | DevOps Engineer (`devops`) | build, run, CI |
| Quality | Tech Lead (`reviewer`) | code review, leads QA and Security |
| Quality | QA Engineer (`qa`) | test suite and edge cases |
| Quality | Security Engineer (`security`) | security pass |
| Delivery | Scrum Master (`scrum`) | board, blockers, progress |
| Delivery | Technical Writer (`writer`) | README and delivery notes |

Each employee has an agent definition `teamforge-<role id>`. Give a task to the
employee who owns it; an employee who is not needed for a small project simply
stays idle — do not invent work for them. Whoever is working must show as
`working` on the dashboard, with a note saying what they are doing.

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
   This auto-opens the dashboard in the user's browser (`teamforge open` reopens it).
   If the output says `"opened":false`, give the user the link http://127.0.0.1:4519 instead.
2. **brainstorm** — `teamforge phase brainstorm`; `teamforge agent pm --status working --note "brainstorming"`. The Product Manager explores the idea: purpose, users, constraints, success criteria. NO CODE.
3. **questions** — `teamforge phase questions`. The Product Manager asks the user clarifying questions (one at a time, multiple choice when possible); the Business Analyst (`analyst`) turns the answers into user stories.
4. **spec** — `teamforge phase spec`. The Product Manager writes a short readable spec (markdown file in the project's `docs/`), with the Business Analyst's acceptance criteria and, when there is a user interface, the Designer's (`designer`) screens and flows. Record key choices: `teamforge decide "<title>" --detail "<why>"`.
5. **spec_gate** — `teamforge phase spec_gate`; `teamforge validate ask spec_gate "<summary question>"` (note the returned validation `id`). **STOP — this is the user's decision.** Follow the gate procedure below.
6. **plan** — `teamforge phase plan`; `teamforge agent architect --status working`. The CTO writes the implementation plan and splits it into small tasks: `teamforge task add "<task title>" --role frontend|backend|data|devops|qa|writer`. The Scrum Master (`scrum`) keeps the board from here until review. Major architecture decisions: `teamforge decide` + ask the user before locking them in.
7. **plan_gate** — `teamforge phase plan_gate`; `teamforge validate ask plan_gate "..."`. **STOP for user validation again.**
8. **implementation** — `teamforge phase implementation`. Execute tasks in order:
   - Before starting a task: `teamforge task set <id> in_progress` and `teamforge agent <role> --status working --note "<task>"`.
   - **TDD**: write the failing test first, then the minimal implementation.
   - Independent tasks MAY be dispatched to the owner's subagent (`teamforge-frontend`, `teamforge-backend`, `teamforge-data`, `teamforge-devops`); otherwise do them yourself in that role.
   - After each task: `teamforge task set <id> done`, agent back to `idle`.
9. **tests** — `teamforge phase tests`; `teamforge agent qa --status working`. Run the full test suite; fix failures. Then `teamforge agent security --status working` and do a security pass over the diff (secrets, injection, unsafe input handling). The DevOps Engineer checks that a clean install, build and start work.
10. **review** — `teamforge phase review`; `teamforge agent reviewer --status working`. The Tech Lead reviews the whole diff against the spec (or dispatch the `teamforge-reviewer` subagent); the Business Analyst checks each acceptance criterion. Fix findings. The Technical Writer (`writer`) updates the README and writes the delivery notes.
11. **done_gate** — `teamforge phase done_gate`; `teamforge agent ceo --status working --note "presenting delivery"`; `teamforge validate ask done_gate "..."`. **STOP. Show the user a final summary (what was built, files, test results) and ask them to confirm completion.**
12. **done** — `teamforge phase done`. Record remaining decisions with `teamforge decide` and approve the good ones with `teamforge decide-set <id> approved` — these become permanent project memory injected into future sessions.

## Gate procedure (all three gates)

1. `teamforge validate ask <gate> "<question>"` → note the `id` in the JSON output.
2. Tell the user in chat what needs validating, and that they can **click ✓ Approve or ✎ Request changes on the dashboard** — no need to type in the terminal.
3. Run `teamforge validate wait <id> --timeout 240` (use a Bash timeout ≥ 250s). Outcomes:
   - Prints `"status":"approved"` → thank them (mention their comment if any) and advance the phase.
   - Prints `"status":"changes_requested"` → read the `answer` comment, go back to the previous phase, revise, then gate again.
   - Exit code 4 (timeout) → they haven't clicked; ask again in chat and wait for a chat reply, then record it with `teamforge validate set <id> <status> --answer "<their words>"`.
   - If the user answers in chat while you wait, use `validate set` with their words.

## Hard rules

- **Never write source code before `implementation`.** The hook will block you; if it does, that is correct behavior — go back and complete the workflow.
- **Never answer a validation yourself.** Gates are the user's voice: ask in chat, wait, then record their answer verbatim.
- **Keep the dashboard honest.** Update agent status when a role starts/stops working; log notable moments with `teamforge event note --json '{"text":"..."}'`.
- Trivial requests (typo fix, one-line change, a question) do NOT need the pipeline — use judgment; the pipeline is for building things.
- If the worker is unreachable, say so and continue working normally (the workflow is not a hostage).
