import React from 'react';

const PHASES = [
  { id: 'idea', label: 'Idea' },
  { id: 'brainstorm', label: 'Brainstorm' },
  { id: 'questions', label: 'Questions' },
  { id: 'spec', label: 'Spec' },
  { id: 'spec_gate', label: 'Approval', gate: true },
  { id: 'plan', label: 'Plan' },
  { id: 'plan_gate', label: 'Approval', gate: true },
  { id: 'implementation', label: 'Build' },
  { id: 'tests', label: 'Tests' },
  { id: 'review', label: 'Review' },
  { id: 'done_gate', label: 'Sign-off', gate: true },
  { id: 'done', label: 'Done' },
];

export function PhaseBar({ phase }) {
  const current = Math.max(0, PHASES.findIndex((p) => p.id === phase));
  const meta = PHASES[current];

  return (
    <div
      className="panel phasebar" role="group"
      aria-label={`Workflow: ${meta.label}${meta.gate ? ', waiting for your approval' : ''}, step ${current + 1} of ${PHASES.length}`}
    >
      <div className="phase-seg-row">
        {PHASES.map((p, i) => (
          <div
            key={p.id + i}
            className={`phase-seg ${i < current ? 'past' : ''} ${i === current ? 'current' : ''} ${p.gate ? 'gate' : ''}`}
            aria-current={i === current ? 'step' : undefined}
            title={`${p.label}${i < current ? ' (done)' : i === current ? ' (current)' : ''}`}
          >
            <div className="seg-bar">{p.gate ? (i < current ? '✓' : '🔒') : i < current ? '✓' : ''}</div>
            <span className="seg-label">{p.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
