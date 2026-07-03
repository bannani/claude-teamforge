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
    <div className="panel phasebar">
      <div className="phase-info">
        <div>
          <span className="eyebrow">Current phase</span>
          <h2 className="phase-current">
            {meta.label}
            {meta.gate && <span className="phase-gate-tag">waiting for your approval</span>}
          </h2>
        </div>
        <span className="phase-count">{current + 1} <em>/ {PHASES.length}</em></span>
      </div>
      <div className="phase-seg-row">
        {PHASES.map((p, i) => (
          <div
            key={p.id + i}
            className={`phase-seg ${i < current ? 'past' : ''} ${i === current ? 'current' : ''} ${p.gate ? 'gate' : ''}`}
          >
            <div className="seg-bar">{p.gate ? (i < current ? '✓' : '🔒') : ''}</div>
            <span className="seg-label">{p.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
