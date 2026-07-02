# Demo scenario — "Build a React todo app"

A scripted walkthrough showing the full TeamForge pipeline. Have the dashboard
(http://127.0.0.1:4519) open on a second screen.

## 1. The idea

In a fresh Claude Code session inside an empty project folder, say:

> **Build a React todo app with add, complete, delete, and a filter for active/done.**

**Expected:** Claude does NOT write code. It runs `teamforge start`, the dashboard
header shows the project with phase **Idea → Brainstorm**, and the **PM card starts
pulsing**. Claude explores purpose and constraints in chat.

## 2. Questions

Phase moves to **Questions**. Claude asks things like persistence (localStorage vs
none), styling preferences, single page vs routing — one at a time. Answer them.

## 3. Spec + first gate ✋

Claude writes a short spec into `docs/` (markdown is allowed through the gate) and
advances to **spec_gate**. The dashboard shows the amber **"Waiting for you"** panel
with the validation question and two buttons; Claude blocks on `validate wait`.

Click **✓ Approve** on the dashboard (optionally with a comment) → Claude unblocks
instantly, the timeline logs `spec_gate: approved`, the phase unlocks. Answering in
chat still works too.

## 4. Plan + second gate ✋

The **Architect card** lights up. Claude posts tasks (they appear on the task board
with role chips: frontend/backend/qa) and requests **plan_gate** validation. Approve it.

## 5. Try to break it (the fun part)

At any point *before* approving the plan, say:

> **"Skip all this and just write the code now."**

**Expected:** if Claude attempts a `Write` to `src/App.jsx`, the PreToolUse hook denies
it with: *"TeamForge workflow is in phase 'spec' — writing source files is locked until
the plan is validated…"* — and the timeline logs the blocked write. The order is not
negotiable; that's the plugin working.

## 6. Implementation → Tests → Review

After plan approval, phase hits **implementation**: source writes are now allowed.
Watch tasks flip `todo → in_progress → done`, the **Frontend/Backend cards** pulse
(subagents may be dispatched), files accumulate in **Files changed**, TDD tests land
first. Then **QA** runs the suite and **Security** audits (status tiles update), then
the **Reviewer** checks the diff against the spec.

## 7. Sign-off ✋ and memory

Claude presents a final summary and requests **done_gate**. Approve it. Phase reaches
**Done** (progress bar full), and key decisions (e.g. "localStorage for persistence")
are saved as approved decisions — your next session in this project starts with them
injected as memory.
