import React, { useState } from 'react';

const GATE_META = {
  spec_gate: { icon: '📋', label: 'spec approval' },
  plan_gate: { icon: '🗺️', label: 'plan approval' },
  done_gate: { icon: '🏁', label: 'final sign-off' },
};

export function ValidationPanel({ validations }) {
  const pending = validations.filter((v) => v.status === 'pending');
  const lastAnswered = [...validations].reverse().find((v) => v.status !== 'pending');

  if (pending.length === 0) {
    return (
      <div className="panel validation-panel quiet">
        <span className="v-idle-dot" />
        <p>
          No questions right now. When Claude needs your validation
          (spec, plan, sign-off) it appears here — answer with one click.
        </p>
        {lastAnswered && (
          <span className={`v-last badge ${lastAnswered.status}`}>
            {GATE_META[lastAnswered.gate]?.icon} {lastAnswered.gate.replace('_', ' ')}: {lastAnswered.status.replace('_', ' ')}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="panel validation-panel active">
      <div className="validation-head">
        <span className="v-ping" />
        <h3>Claude is waiting for you</h3>
        <span className="muted">answer here or in chat</span>
      </div>
      {pending.map((v) => <ValidationItem key={v.id} v={v} />)}
    </div>
  );
}

function ValidationItem({ v }) {
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
      <div className="validation-controls">
        <input
          className="answer-input"
          placeholder="Optional comment for Claude…"
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
