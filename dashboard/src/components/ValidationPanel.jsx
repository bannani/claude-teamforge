import React, { useState } from 'react';

export function ValidationPanel({ validations }) {
  const pending = validations.filter((v) => v.status === 'pending');
  if (pending.length === 0) return null;

  return (
    <div className="panel validation-panel">
      <h3>✋ Waiting for you — answer here or in chat</h3>
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
      // SSE snapshot removes this item once the worker records the answer.
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="validation-item">
      <span className="badge pending">{v.gate}</span>
      <p className="validation-question">{v.question}</p>
      <input
        className="answer-input"
        placeholder="Optional comment for Claude…"
        value={answer}
        disabled={busy}
        onChange={(e) => setAnswer(e.target.value)}
      />
      <div className="validation-actions">
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
