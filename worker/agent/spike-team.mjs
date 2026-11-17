// Who answers a spike. The reading — the code map, files, tests — is most of the
// tokens, so it runs on a light model: the Business Analyst leads the investigation
// and writes the answer. Before answering, they consult the CTO, an advisor on a
// stronger model who checks the reasoning against the code and corrects it. The
// advisor sees a short brief, not the whole investigation: strong judgement where it
// matters, at the price of a few thousand tokens.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SPIKE_MODEL = 'claude-haiku-5.5';
export const ADVISOR_MODEL = 'claude-sonnet-5.5';
export const ADVISOR_AGENT = 'teamforge-advisor';
const GRAPH_LINE = ', and use the map of the code (the `codegraph` tools: `get_node`, `get_neighbors`, `query_graph`, `shortest_path`)';

// Written to a directory of TeamForge's own, passed with --add-dir: nothing in the
// project. A directory apart from the browser operator's, so a mission never loads it.
export function writeAdvisor(home, { model, graph = null }) {
  const dir = join(home, '.github', 'agents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${ADVISOR_AGENT}.agent.md`), `---
name: ${ADVISOR_AGENT}
description: "TeamForge CTO, advisor of the spike: checks an analysis of the code against the code and corrects it before the client gets the answer."
model: ${model}
---
You are the **CTO** of the TeamForge company, advising the Business Analyst who is
answering a Product Owner's question about how the product behaves today. They
send you the question, how they understood it, and their findings: the rules they
found, each with its \`file:line\`. You do not answer the client: you make sure the
answer they are about to give is right.

Read-only: read the code, search it${graph ? GRAPH_LINE : ''}. Never change anything.

1. Is the question understood the right way? If it could mean another feature, say which.
2. Check the decisive points yourself: open the references that carry each rule and confirm the condition as coded. Do not re-read everything — the points the answer rests on.
3. Look for what is missing: a branch, a setting or right, a special case, a test that contradicts the analysis, another entry point that leads to the same rule.

Answer in a few lines, in this order:
- **Verdict:** sound / needs corrections / wrong track
- **Corrections:** each wrong or imprecise rule, with the right one and its \`file:line\`
- **Missing:** what to check or add, with where to look
- **Confidence:** high, medium or low, and why
Nothing else: no restating of what is right, no answer for the client.
`);
  return home;
}

// The part of the briefing about the advisor.
export const advisorBriefing = (model) => `## Your advisor
You lead the investigation and write the answer. Before writing a real answer,
consult the CTO, your advisor on a stronger model (\`${model}\`), once: hand the
task to the \`${ADVISOR_AGENT}\` agent with the task tool (agent_type ${ADVISOR_AGENT}).
Give them the client's question, how you understood it, and your findings as a
short list of rules, each with its \`file:line\` — not the code itself, they read
it. Apply their corrections and check what they say is missing; consult them a
second time only if their verdict was "wrong track". Use their confidence for
yours. No advisor for a clarification question or a reply that is not an answer.
`;
