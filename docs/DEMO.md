# Demo scenario — a quote tool in five minutes

A walkthrough of the full pipeline. This exact scenario was run end to end
against the real Copilot CLI while building v1.0.

1. **Start.** In an empty folder run `teamforge`. The page shows the console and
   "No active mission".
2. **The idea.** Type: *Build a tiny command-line tool in Node that prints a random
   motivational quote. Keep it very small.* The office appears, the phase bar moves
   to Brainstorm then Questions, and the Product Manager walks to their desk.
3. **Questions.** The Product Manager asks one question in the console (built-in
   quotes or an online API?). Answer it.
4. **Spec gate ✋.** The team writes `docs/spec.md`, the CEO presents it, and the
   validation panel shows **Approve / Request changes**. Nothing else can be
   written yet. Click **Approve** — the conversation continues by itself.
5. **Plan gate ✋.** The CTO writes `docs/plan.md` and adds tasks to the board.
   Approve again.
6. **Implementation.** The Backend Developer writes the failing test, then needs
   to run it: the console shows `⊘ bash node --test — not allowed` with an
   **Allow `node` in this project** button. Click it; the team resumes, the tests
   pass, QA and Security report, the Technical Writer adds the README.
7. **Final gate ✋.** The CEO summarises what was built and what was verified.
   Approve to close the mission; approved decisions become project memory.

Things to try: **Request changes** with a comment at a gate, **Stop** during a
long turn, reload the page mid-mission (the conversation is restored), open an
employee's file while they work.
