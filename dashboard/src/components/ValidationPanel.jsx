import React from 'react';

export function ValidationPanel({ validations }) {
  const pending = validations.filter((v) => v.status === 'pending');
  if (pending.length === 0) return null;

  return (
    <div className="panel validation-panel">
      <h3>✋ Waiting for you</h3>
      {pending.map((v) => (
        <div key={v.id} className="validation-item">
          <span className="badge pending">{v.gate}</span>
          <p>{v.question}</p>
          <p className="muted">Answer Claude in the chat to unlock the next phase.</p>
        </div>
      ))}
    </div>
  );
}
