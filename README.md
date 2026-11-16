# ⚒ TeamForge

**A visible software company of AI agents that can't skip steps.**

[![GitHub Copilot CLI](https://img.shields.io/badge/GitHub_Copilot-CLI-8957e5)](https://github.com/features/copilot)
[![Tests](https://img.shields.io/badge/tests-161_passing-brightgreen)](tests/)
[![Node](https://img.shields.io/badge/node-%E2%89%A5_22.13-339933?logo=node.js&logoColor=white)](package.json)
[![Runtime deps](https://img.shields.io/badge/runtime_deps-0-blue)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

A local web app that runs a **visible software company of AI agents** on your
project, with an enforced idea-to-done workflow and a live dashboard.

![TeamForge dashboard: a mission going from idea to done, with the team working and the gates approved from the dashboard](docs/assets/teamforge-demo.gif)

> Until v0.5 TeamForge was a Claude Code plugin. From v1.0 it is a standalone app
> driven by GitHub Copilot CLI: the plugin (hooks, skill, marketplace manifest) is
> gone from this branch. The last plugin version is commit `cc45d7d`.

```
Brainstorm → Questions → Spec → ✋ → Plan → ✋ → Implementation → Tests → Review → ✋ → Done
```

You type what you want in the **console**. The company asks its questions there,
and stops at each ✋ gate until you click **Approve** or **Request changes**. The
gates are enforced by the worker, not by politeness: before you approve the plan
the agent can only write four documents under `docs/`, and it cannot answer a gate
itself.

## How it works

```
browser (dashboard + console)                  worker (Node, zero deps)
┌──────────────────────────────┐   POST /api/chat   ┌────────────────────────────┐
│ console ─ your messages      ├───────────────────►│ conversation manager       │
│ office · org chart · tasks   │◄── SSE: chat + ────┤ state machine + gates      │
│ gates: Approve / Changes     │       state        │ SQLite ~/.claude-teamforge │
└──────────────────────────────┘                    └──────────┬─────────────────┘
                                                               │ one `copilot -p` per turn,
                                                               │ tools limited by phase
                                                    ┌──────────▼─────────────────┐
                                                    │ GitHub Copilot CLI         │
                                                    │ reports with `teamforge …` │
                                                    └────────────────────────────┘
```

**Model provider** — GitHub Copilot, through the `copilot` CLI you already have
installed and signed in. TeamForge never reads its token. Providers with API keys
(Anthropic, OpenAI, GitHub Models) are specified in
`docs/specs/2026-11-12-standalone-webapp-design.md` and not built yet.

**A lean turn** — each turn is a fresh `copilot` process. TeamForge starts it without
your own Copilot plugins and MCP servers: the team cannot use them (TeamForge decides
its tools), and loading them was paid on every turn — measured on a one-word turn,
8.5 s and 34k input tokens with them, 4.4 s and 24k without. Your own Copilot
sessions are not affected.

**Permissions** — the agent's tools depend on the phase:

| Phase | The agent may |
|---|---|
| before `implementation` | read the project, write `docs/spec.md`, `docs/stories.md`, `docs/design.md`, `docs/plan.md`, run `ls`, `cat`, `git status/log/diff` |
| from `implementation` | also write any file, and run the programs you allowed |

When the agent needs a program (`node`, `npm`, `git`…), the console shows an
**Allow** button. Allowing a program lets the agent run it with any arguments in
that project (`npm` can run any script) — allow only what you would run yourself.

**Spike mode** — for a Product Owner who wants to know how the product behaves
today. Switch with the **Build / Spike** toggle in the console header (or `/spike`,
`/build`), then ask a functional question: “What happens when a patient asks for a
fourth refill?”. The CTO reads the code, the Business Analyst answers:

- the answer is always **functional** — rules, conditions, cases, an example, and
  how sure the team is — with no file, class or table name;
- a **confidence badge** (high / medium / low) says what the answer rests on;
- what the team read to answer is folded into one line, “Read the code · n steps”;
- **Technical details** under each answer unfolds the developer's view of the same
  answer: call path as `file:line`, the conditions as coded, data, tests, edge cases;
- the team is **read-only**: it cannot write a file or run a program, whatever
  `/allow` or `/allow-all` say, and nothing is created in your project;
- a spike has no phases and no gates. It keeps its own conversation next to your
  mission: `/build` brings the mission back where it was, `/new` closes the spike;
- **Questions asked** lists your questions; click one to go back to its answer;
- **Save as a document** (or `/export`) writes the questions and both parts of each
  answer to `docs/spikes/<date>-<first question>.md`. TeamForge writes that file
  itself: the team stays read-only.

Both parts come from one reading of the code, so opening the details costs nothing
more. Answers are in the language of your question.

**Console commands** — a line starting with `/` is for TeamForge, not for the agent
(type `/` to get the list):

| Command | Effect |
|---|---|
| `/help` | list the commands |
| `/status` | phase, tasks, pending gate, model |
| `/stop` | stop the running turn |
| `/clear` | clear the conversation and the agent's memory of it; mission, tasks and documents stay |
| `/new` | close the current mission; the next message starts a new one |
| `/export` | spike mode: save the questions and answers to `docs/spikes/` |
| `/spike` · `/build` | switch to spike mode (read-only questions about the code), or back to the mission |
| `/permissions` | what the agent may run in this project |
| `/allow <program>` · `/deny <program>` | let the agent run a program, or take it back |
| `/allow-all` · `/allow-all off` | let the agent run **any** shell command from the implementation phase |
| `/browser <url>` · `/browser off` · `/browser own\|separate` · `/browser model <name>` | let the team act in your Chrome on a site, take it back, choose between your Chrome and a separate window, or choose the model that reads the screen |
| `/model` · `/model <name\|default>` · `/model <employee> <name\|default>` | show the models; choose the company's, or one employee's |

`/allow-all` never opens anything before the plan is approved, and it does not open
URLs or MCP tools (the browser is its own switch, `/browser`). It does let the agent delete files or install packages without
asking: use it on projects you can restore.

**Your browser, driven by the team** — `/browser localhost:4200` (or any site of
yours) lets the team act in **your own Chrome**, the way Claude does with its Chrome
extension: your tabs, your sign-ins. It opens pages, clicks, types, reads the page
and takes screenshots. QA checks the acceptance criteria in the running product, the
Designer checks the screens; in spike mode the team may look at the product to
confirm what the code says. The console tells it as it happens — “QA · clicks Sign
in button” — and shows the screenshots; what is typed in a password field is never
shown or stored. In the page itself you see where the team acts: a second
cursor, TeamForge's own, that travels to what it clicks and stays there — it never
follows your mouse — a ripple on each of its clicks, and a glowing frame with
“TeamForge is working in this tab”.

Set-up, once — the **TeamForge Browser** extension (the `extension/` folder):
1. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load
   unpacked** and choose the `extension` folder of TeamForge. Under WSL its Windows
   path is `\\wsl.localhost\<distribution>\home\<you>\…\claude-teamforge\extension`.
2. Open (or reload) the TeamForge page in that Chrome: the extension pairs with the
   worker by itself. Its icon shows a green dot when it is connected. A click on it
   from a web page puts that page in the **TeamForge** tab group, makes it the tab
   the team works in, and opens TeamForge beside it — then “summarise this page”
   is enough. The team still only reads sites you allowed with `/browser`.
3. In TeamForge: `/browser <the address of a page>` — the page opens at once — or
   `/browser <a site>` and then ask for something.

How it works:
- The team works in a tab of its own, in a **TeamForge** tab group, with your
  sign-ins. It does not touch your other tabs. Chrome shows “TeamForge Browser
  started debugging this browser” while it does: that is the extension driving the tab.
- The extension holds a token that is only good for receiving browser commands: it
  cannot start the agent or read your conversation. It only talks to the TeamForge
  worker on this machine.
- **The sites are a real limit here.** A site you did not allow is refused before
  anything is sent to it, and if a click or a redirect leads elsewhere the tab goes
  back and the team is told. Pages still load whatever they need from other sites
  (scripts, styles), as in any browser.
- The team gets eleven tools: open, go back, read the page, click, hover, type,
  press a key, choose an option, scroll, wait, screenshot. Nothing that runs code
  or reads your files. What is in a password field is never read out of the page.
- `/browser separate` uses a browser window of TeamForge's own instead — no
  extension, its own profile kept per project under `~/.claude-teamforge/browser/`,
  driven by Playwright (`npx` downloads it the first time); there, the sites are
  checked when the team navigates, which stops what follows but not a request
  already sent. `/browser own` goes back. `/browser <url>` again adds a site,
  `/browser off` takes the browser back.
- The team acts as whoever is signed in, and what it clicks is real: give it a test
  environment, not production. In spike mode it is told to observe only — that is an
  instruction, not a lock.
- **Reading the screen runs on a light model.** A page snapshot or a screenshot is
  thousands of tokens, so the browser is driven by a *browser operator*, an agent of
  its own on `claude-haiku-5.5`: the team tells it what to open, do and report, and
  gets a short account back. The console shows the hand-over (“operator reads the
  screen on claude-haiku-5.5”). `/browser model <name>` chooses another model,
  `/browser model default` goes back. Its definition is kept in TeamForge's data
  directory, not in your project.

**Images** — attach up to four images (PNG, JPEG, GIF, WebP, 5 MB each) to a
message with the image button, or paste one into the input. They are stored under
`~/.claude-teamforge/attachments/`, not in your project, and handed to the agent.

**A model per employee** — open an employee's file and set their model, or type
`/model backend gpt-5.6-sol`. An employee with a model of their own stops being a
role played by the CEO and runs as a real Copilot sub-agent on that model; the
dashboard shows them walking to their desk when the CEO hands them a task. The
CEO's model is the company's (`/model <name>`). Two things to know:

- Copilot only loads sub-agents from the project, so TeamForge keeps one generated
  file per such employee in `.github/agents/teamforge-<role>.agent.md`, removes it
  when the model is reset, and lists the pattern in `.git/info/exclude` so it stays
  out of your commits.
- A model name is not checked until it runs. If Copilot cannot run that model as a
  sub-agent, the console says so and the employee shows as blocked
  (`claude-haiku-5.5` failed that way with Copilot CLI 1.0.109; `gpt-5.6-sol` worked).

**Documents** — the spec, user stories, design and plan (`docs/*.md`) open in the
browser from the Mission column, or from the button on the spec and plan gates.
Read them formatted, or edit the markdown and save. The team is told about your
edit on your next message; if the team changed the file while you were editing,
the save is refused until you choose whose version wins.

**Security** — the worker listens on `127.0.0.1` only, every API call needs a
token (cookie set when the page loads, `~/.claude-teamforge/worker.token` for the
CLI), and requests from another site or host name are refused.

**The company** — 14 employees in 5 departments, each with a job description,
a manager and the phases they work in (`worker/roles.mjs`):

| Department | Employees |
|---|---|
| Direction | CEO |
| Product | Product Manager · Business Analyst · UX/UI Designer |
| Engineering | CTO · Frontend · Backend · Database · DevOps |
| Quality | Tech Lead · QA · Security |
| Delivery | Scrum Master · Technical Writer |

The dashboard shows them three ways: the **office** (a floor plan with one room
per department, a meeting room, a cafeteria and a central corridor), the
**org chart** (who reports to whom) and an **employee file** (mission,
responsibilities, tasks, activity). Every status change animates live: workers
sit at their desk (their room lights up), idle staff go to the cafeteria, people
cross the corridor through the doors, colleagues from other departments drop by
with a speech bubble, the CEO waits in the meeting room while a gate is pending
and a small party starts there when it is approved. `prefers-reduced-motion`
turns all of this movement off.

**Charters and playbooks** — how the company works is written in markdown you can
edit: `agents/<role>.md` says how an employee does their job, `skills/<phase>.md`
how a phase is run (one question at a time, the layout of the spec, test first,
find the cause before fixing…). The agent does not get all of it up front: a
playbook arrives when the team enters its phase, a charter when that employee
first sits down to work. Edit a file and restart the worker to change the method.

**One session per tab** — every TeamForge tab in your browser is its own session:
a new tab starts with an empty conversation, its own mission (or spike) and its own
mode, while the tab you came from keeps its work. Reloading a tab stays in its
session. The team works on one tab's request at a time per project: another tab is
told to wait. What you allowed (`/allow`, `/browser`, models) is shared by the
project's tabs. **Sessions**, in the console header, lists the project's open
conversations: click one and it moves to the tab you are in — that is how you get
back to a mission after closing its tab. What the tab was showing is set aside, and
stays in the list.

**Memory** — decisions you approve are kept per project in SQLite and given to
the company at the start of every later mission.

## Quick start

Requirements: Node ≥ 22.13 and the GitHub Copilot CLI, signed in.

```
git clone https://github.com/bannani/claude-teamforge && cd claude-teamforge
npm link                 # puts `teamforge` on your PATH
cd /path/to/your/project
teamforge                # starts the worker and opens the web app for this folder
```

Details: [docs/INSTALL.md](docs/INSTALL.md) · walkthrough: [docs/DEMO.md](docs/DEMO.md).

## Development

```
npm test                              # worker + dashboard layout helpers
cd dashboard && npm install && npm run build   # rebuild the committed dist/
```

Tests never call a model: the conversation tests use a fake agent, the provider
tests a fake `copilot` script.

### Dashboard layout

- ≥ 1200 px: three columns (Company · Console · Mission); ≥ 1800 px they widen, content capped at 1760 px.
- 800–1200 px: two columns. < 800 px: one column with a bottom tab bar (Company / Console / Mission) — arrow keys, Home and End move between tabs; badges show unread console messages and pending gates.
- A pending gate sticks to the top while you scroll. Files, Decisions and Timeline panels fold away.
- Pure layout helpers live in `dashboard/src/layout.js` (tested in `tests/layout.test.mjs`). Animations stop under `prefers-reduced-motion`.

## Layout

- `worker/` — HTTP + SSE server, SQLite layer, state machine, auth, `teamforge` CLI
- `worker/agent/` — conversation manager and the briefing given to the agent
- `worker/providers/` — the Copilot provider
- `worker/browser/` — the team's browser tools (an MCP server) and the bridge to the extension
- `extension/` — TeamForge Browser, the Chrome extension that acts in your Chrome
- `worker/roles.mjs` — the company: roles, departments, reporting line
- `agents/` — one charter per employee (`<role>.md`), handed to the agent the first time that employee works, and to the employee's own agent when they have a model of their own
- `skills/` — the company's methods: one playbook per phase (`brainstorm.md` … `review.md`), handed over when the phase is entered, and `spike.md`, the briefing of spike mode
- `dashboard/` — React + Vite source; prebuilt `dist/` committed
- `docs/` — specs, plans, install guide, demo scenario

## Author

Built by **Mohamed Fares Bannani**, Senior Software Engineer and AI Engineering Lead in Bordeaux. I design agentic development workflows and the tooling around them: agents, skills, hooks, plugins and MCP servers.

[LinkedIn](https://www.linkedin.com/in/mohamed-fares-bannani-440881151) · [GitHub](https://github.com/bannani)

If TeamForge is useful to you, a ⭐ on the repo helps a lot.

## Credits

Inspired by [Superpowers](https://github.com/obra/superpowers) for workflow discipline and
[claude-mem](https://github.com/thedotmack/claude-mem) for the worker → SQLite → UI
architecture.

## License

[MIT](LICENSE)
