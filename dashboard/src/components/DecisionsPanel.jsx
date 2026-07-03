import React from 'react';

const STATUS_ICON = { approved: '✓', rejected: '✕', proposed: '…' };

export function DecisionsPanel({ decisions }) {
  return (
    <div className="panel">
      <h3>Decisions</h3>
      {decisions.length === 0 ? (
        <p className="muted decisions-empty">
          Key technical choices land here and become permanent project memory once approved.
        </p>
      ) : (
        <ul className="decision-list">
          {decisions.map((d) => (
            <li key={d.id} className={`decision-card ${d.status}`}>
              <span className={`decision-icon ${d.status}`}>{STATUS_ICON[d.status] || '…'}</span>
              <div className="decision-body">
                <span className="decision-title">{d.title}</span>
                {d.detail && <span className="decision-detail">{d.detail}</span>}
              </div>
              <span className={`badge ${d.status}`}>{d.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
