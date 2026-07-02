import React from 'react';

function tile(agent) {
  if (!agent) return { state: 'idle', text: 'waiting' };
  if (agent.status === 'working') return { state: 'working', text: agent.note || 'in progress' };
  if (agent.status === 'done') return { state: 'done', text: agent.note || 'complete' };
  if (agent.status === 'blocked') return { state: 'blocked', text: agent.note || 'blocked' };
  return { state: 'idle', text: agent.note || 'waiting' };
}

export function StatusStrip({ agents }) {
  const byRole = Object.fromEntries(agents.map((a) => [a.role, a]));
  const tiles = [
    { label: 'Tests', ...tile(byRole.qa) },
    { label: 'Security', ...tile(byRole.security) },
    { label: 'Review', ...tile(byRole.reviewer) },
  ];
  return (
    <div className="status-strip">
      {tiles.map((t) => (
        <div key={t.label} className={`panel status-tile ${t.state}`}>
          <span className="status-label">{t.label}</span>
          <span className="status-text">{t.text}</span>
        </div>
      ))}
    </div>
  );
}
