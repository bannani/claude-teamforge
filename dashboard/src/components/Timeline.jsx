import React from 'react';

const ICONS = {
  prompt: '💬', tool: '🔧', phase: '🚦', agent: '👤', task: '📋',
  decision: '⚖️', validation: '✋', file: '📄', note: '📝',
};

function describe(e) {
  const p = e.payload || {};
  switch (e.kind) {
    case 'prompt': return `user: ${p.text || ''}`;
    case 'phase': return p.to ? `phase ${p.from} → ${p.to}` : `mission started: ${p.title || ''}`;
    case 'agent': return `${p.role} → ${p.status}${p.note ? ` (${p.note})` : ''}`;
    case 'task': return `task "${p.task}" → ${p.status}`;
    case 'decision': return `decision "${p.title}" ${p.status}`;
    case 'validation': return `${p.gate}: ${p.status || 'pending'}${p.question ? ` — ${p.question}` : ''}`;
    case 'file': return `${p.tool} ${p.file}`;
    case 'tool': return `${p.tool}${p.file ? ` ${p.file}` : ''}`;
    default: return p.text || e.kind;
  }
}

export function Timeline({ events }) {
  return (
    <div className="panel timeline">
      {events.length === 0 && <p className="muted">Quiet for now…</p>}
      <ul>
        {events.map((e) => (
          <li key={e.id} className={`event kind-${e.kind}`}>
            <span className="event-icon">{ICONS[e.kind] || '•'}</span>
            <span className="event-text">{describe(e)}</span>
            <span className="event-ts">{e.ts?.slice(11, 19)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
