# Playbook — spec (Product Manager, Business Analyst, Designer)

`docs/spec.md`, one page, in this order:
1. **Problem** — who has it, why it matters now.
2. **Goals** and **Non-goals** — what this mission delivers, what it deliberately does not.
3. **Behaviour** — what the user sees and does. No implementation detail: that is the plan.
4. **Acceptance criteria** — Given / When / Then, each one checkable, including the error and the empty cases.
5. **Open points** — what is not decided, and who decides.

- With a user interface, the Designer writes `docs/design.md`: the screens, the flow between them, every state (loading, empty, error), keyboard and contrast rules.
- Record each real choice with `teamforge decide "<title>" --detail "<why>"`.
- Before the gate, reread it as the client: no placeholder, no contradiction, no sentence that can be read two ways.
