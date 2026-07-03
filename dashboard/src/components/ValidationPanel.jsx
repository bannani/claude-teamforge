import React, { useState } from 'react';

export function ValidationPanel({ validations }) {
  const pending = validations.filter((v) => v.status === 'pending');

  if (pending.length === 0) {
    return (
      <div className="panel validation-panel quiet">
        <span className="v-idle-dot" />
        <p>
          No questions right now. When Claude needs your validation
          (spec, plan, sign-off) it appears here — answer with one click.
        </p>
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

  const respond = async (status) => {
    setBusy(true);
    const fallback = status === 'approved' ? 'Approved from dashboard' : 'Changes requested from dashboard';
    try {
      await fetch(`/api/validations/${v.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, answer: answer.trim() || fallback }),
      });
      // SSE snapshot clears this item once the worker records the answer.
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="validation-item">
      <div className="validation-meta">
        <span className="badge pending">{v.gate.replace('_', ' ')}</span>
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
