# Playbook — review (Tech Lead, Business Analyst, Technical Writer)

- The Tech Lead reads the whole change (`git diff`) against the spec: does it do what the spec says, is anything missing, any bug, dead code, or complexity nobody asked for?
- The Business Analyst takes each acceptance criterion and marks it met, unmet or untested — with the test or the output that shows it.
- Findings are fixed, then the suite is run again. A review that changes code is followed by a test run.
- The Technical Writer updates the README for what changed, and only that.
- The done gate summary quotes real results: what was built, the files, the test counts from the last run, and what is not done.
