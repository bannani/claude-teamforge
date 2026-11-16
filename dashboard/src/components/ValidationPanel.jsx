import React, { useState } from 'react';

const GATE_META = {
  spec_gate: { icon: '📋', label: 'spec approval' },
  plan_gate: { icon: '🗺️', label: 'plan approval' },
  done_gate: { icon: '🏁', label: 'final sign-off' },
};

// the document each gate asks the client to approve
const GATE_DOC = { spec_gate: ['docs/spec.md', 'Read the spec'], plan_gate: ['docs/plan.md', 'Read the plan'] };

export function ValidationPanel({ validations, onOpenDoc }) {
  const pending = validations.filter((v) => v.status === 'pending');
  // Nothing to decide → nothing on screen; the panel appears above the console when a gate opens.
  if (pending.length === 0) return null;

  return (
    <div className="panel validation-panel active" role="region" aria-live="polite" aria-label="Pending validation">
      <div className="validation-head">
        <span className="v-ping" />
        <h3>The company is waiting for you</h3>
        <span className="muted">answer here or in chat</span>
      </div>
      {pending.map((v) => <ValidationItem key={v.id} v={v} onOpenDoc={onOpenDoc} />)}
    </div>
  );
}

function ValidationItem({ v, onOpenDoc }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const meta = GATE_META[v.gate] || { icon: '✋', label: v.gate };

  const respond = async (status) => {
    setBusy(true);
    const fallback = status === 'approved' ? 'Approved from dashboard' : 'Changes requested from dashboard';
    try {
      await fetch(`/api/validations/${v.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, answer: answer.trim() || fallback }),
      });
      // 200 or 409 (already answered elsewhere): either way the SSE snapshot
      // reconciles and clears this item, so stay in the busy state.
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="validation-item">
      <div className="validation-meta">
        <span className="gate-icon">{meta.icon}</span>
        <span className="badge pending">{meta.label}</span>
        <span className="muted">{v.ts?.slice(11, 16)}</span>
      </div>
      <p className="validation-question">{v.question}</p>
      {onOpenDoc && GATE_DOC[v.gate] && (
        <button type="button" className="btn-ghost doc-open" onClick={() => onOpenDoc(GATE_DOC[v.gate][0])}>
          {GATE_DOC[v.gate][1]} — you can edit it before approving
        </button>
      )}
      <div className="validation-controls">
        <input
          className="answer-input"
          aria-label="Optional comment for the team"
          placeholder="Optional comment for the team…"
          value={answer}
          disabled={busy}
          onChange={(e) => setAnswer(e.target.value)}
        />
        <button type="button" className="btn approve" disabled={busy} onClick={() => respond('approved')}>
          ✓ Approve
        </button>
        <button type="button" className="btn reject" disabled={busy} onClick={() => respond('changes_requested')}>
          ✎ Request changes
        </button>
      </div>
    </div>
  );
}
