# Playbook — implementation (Engineering)

For each task, in order:
1. `teamforge task set <id> in_progress`, and its owner `working` with a note.
2. Write the failing test first. Run it and see it fail for the right reason.
3. Write the least code that makes it pass. Run the tests again.
4. `teamforge task set <id> done`, owner back to `idle`.

- Do the task, nothing around it: no unrelated refactor, no extra option, no dependency for a few lines.
- Follow the conventions of the code you are in.
- When something fails and you do not know why: stop changing code. Read the whole error, reproduce it, find the cause, then fix that — one hypothesis at a time. After three failed fixes, tell the client what you know instead of trying a fourth.
- A denied command is not a bug: say which program you need and end your turn.
