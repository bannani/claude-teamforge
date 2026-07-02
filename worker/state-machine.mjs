// Pure workflow logic — no I/O. The single source of truth for phases, gates,
// roles, and the write-lock rule enforced by the PreToolUse hook.

export const PHASES = [
  'idea', 'brainstorm', 'questions', 'spec', 'spec_gate', 'plan', 'plan_gate',
  'implementation', 'tests', 'review', 'done_gate', 'done',
];

export const GATES = new Set(['spec_gate', 'plan_gate', 'done_gate']);

export const ROLES = ['pm', 'architect', 'frontend', 'backend', 'qa', 'security', 'reviewer'];

export function phaseIndex(phase) {
  return PHASES.indexOf(phase);
}

export function isGate(phase) {
  return GATES.has(phase);
}

export function canTransition(from, to, { gateApproved = false } = {}) {
  const a = phaseIndex(from);
  const b = phaseIndex(to);
  if (a < 0 || b < 0) {
    return { ok: false, reason: `unknown phase '${a < 0 ? from : to}'` };
  }
  if (b <= a) return { ok: true }; // backward moves (revisions) are always allowed
  if (b !== a + 1) {
    return { ok: false, reason: `cannot skip from '${from}' to '${to}' — phases advance one step at a time (${PHASES.join(' → ')})` };
  }
  if (isGate(from) && !gateApproved) {
    return { ok: false, reason: `gate '${from}' requires an approved user validation before advancing to '${to}'` };
  }
  return { ok: true };
}

const WRITE_OPEN_PHASES = new Set(['implementation', 'tests', 'review', 'done_gate', 'done']);
const ALWAYS_WRITABLE = /(^|\/)(docs|\.claude|\.claude-plugin)(\/|$)/;

export function gateAllowsWrite(phase, filePath) {
  if (WRITE_OPEN_PHASES.has(phase)) return { allow: true };
  if (ALWAYS_WRITABLE.test(filePath) || /\.md$/i.test(filePath)) return { allow: true };
  return {
    allow: false,
    reason: `TeamForge workflow is in phase '${phase}' — writing source files is locked until the plan is validated and the workflow reaches 'implementation'.`,
  };
}
