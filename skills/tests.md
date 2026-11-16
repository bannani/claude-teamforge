# Playbook — tests (QA, Security, DevOps)

- QA runs the **whole** suite now, not from memory, and reports the real counts. "Should pass" is not a result.
- A failure is fixed at its cause. Never weaken or delete a test to get to green.
- QA adds the missing cases: empty input, errors, boundaries, and each acceptance criterion of the spec.
- Security reads the changes: input checked at the boundary, no secret in code or logs, who is allowed to do what, injection, every dependency that was added.
- DevOps proves it from scratch: clean install, build, start.
- What cannot be fixed here is reported as it is, with the output.
