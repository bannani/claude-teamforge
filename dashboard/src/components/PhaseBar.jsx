import React from 'react';

const PHASES = [
  { id: 'idea', label: 'Idea' },
  { id: 'brainstorm', label: 'Brainstorm' },
  { id: 'questions', label: 'Questions' },
  { id: 'spec', label: 'Spec' },
  { id: 'spec_gate', label: 'Spec ✋', gate: true },
  { id: 'plan', label: 'Plan' },
  { id: 'plan_gate', label: 'Plan ✋', gate: true },
  { id: 'implementation', label: 'Build' },
  { id: 'tests', label: 'Tests' },
  { id: 'review', label: 'Review' },
  { id: 'done_gate', label: 'Sign-off ✋', gate: true },
  { id: 'done', label: 'Done' },
];

export function PhaseBar({ phase }) {
  const current = PHASES.findIndex((p) => p.id === phase);
  const pct = current <= 0 ? 0 : (current / (PHASES.length - 1)) * 100;

  return (
    <div className="panel phasebar">
      <div className="phase-track">
        <div className="phase-fill" style={{ width: `${pct}%` }} />
        {PHASES.map((p, i) => (
          <div
            key={p.id}
            className={`phase-node ${p.gate ? 'gate' : ''} ${i < current ? 'past' : ''} ${i === current ? 'current' : ''}`}
            style={{ left: `${(i / (PHASES.length - 1)) * 100}%` }}
          >
            <span className="dot">{p.gate ? '🔒' : ''}</span>
            <span className="phase-label">{p.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
