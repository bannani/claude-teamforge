# Playbook — plan (CTO)

- Read the code that will change before planning, and follow the patterns already there. Boring and dependency-light first.
- `docs/plan.md`: the approach in a few lines, then the tasks in order.
- A task is one behaviour: its exact files, the test that proves it, its owner. Small enough to finish and check on its own.
- No "write the tests" task: every task carries its own test.
- A choice that is hard to undo (framework, storage, protocol, a new dependency) is a `teamforge decide`, shown to the client at the gate.
- Then one `teamforge task add "<title>" --role <role id>` per task. From here the Scrum Master keeps the board true.
