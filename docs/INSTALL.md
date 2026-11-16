# Installing TeamForge

## Requirements

- Node.js **≥ 22.13** (`node --version`). The worker uses the built-in `node:sqlite`; nothing to install at runtime.
- **GitHub Copilot CLI**, signed in: run `copilot` once in a terminal and complete the login. TeamForge drives that CLI; it never reads its credentials.

## Install

```
git clone https://github.com/bannani/claude-teamforge
cd claude-teamforge
npm link
```

`npm link` puts the `teamforge` command on your PATH. Without it, use
`node /path/to/claude-teamforge/worker/cli.mjs` wherever this guide says `teamforge`.

## Use

```
cd /path/to/your/project
teamforge
```

This starts the worker (if needed) and opens `http://127.0.0.1:4519/?project=<that folder>`.
Type what you want built in the console. After an upgrade, `teamforge` replaces the
old worker by itself.

## Configuration

| Variable | Effect |
|---|---|
| `TEAMFORGE_MODEL` | model passed to Copilot (`--model`), e.g. set before the worker starts |
| `TEAMFORGE_URL` | worker address for the CLI (default `http://127.0.0.1:4519`) |

## Where things live

| Path | Content |
|---|---|
| `~/.claude-teamforge/teamforge.db` | missions, conversation, decisions, allowed programs |
| `~/.claude-teamforge/worker.token` | API token (mode 600) |
| `~/.claude-teamforge/worker.log` | worker output |

## Troubleshooting

- **"No model provider found"** — the `copilot` command is not on the PATH the worker started with. Install it, then stop the worker (`kill $(cat ~/.claude-teamforge/worker.pid)`) and run `teamforge` again.
- **The agent says a write or a command was denied** — before the plan is approved that is the workflow. From implementation on, click **Allow** next to the refused command.
- **Each turn takes ~10 s to start** — Copilot loads its own plugins and MCP servers at every start.
