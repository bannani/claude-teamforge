import React, { useEffect, useState } from 'react';

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

// Worker timestamps are UTC ("YYYY-MM-DD HH:MM:SS").
function relative(ts, now) {
  if (!ts) return '';
  const t = Date.parse(`${ts.replace(' ', 'T')}Z`);
  if (Number.isNaN(t)) return ts.slice(11, 19);
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function Timeline({ events }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="panel timeline">
      {events.length === 0 && <p className="muted">Quiet for now…</p>}
      <ul className="timeline-rail">
        {events.map((e) => (
          e.kind === 'phase' ? (
            <li key={e.id} className="event-separator">
              <span className="sep-line" />
              <span className="sep-text">{describe(e)}</span>
              <span className="sep-line" />
            </li>
          ) : (
            <li key={e.id} className={`event kind-${e.kind}`}>
              <span className="event-dot" data-kind={e.kind}>{ICONS[e.kind] || '•'}</span>
              <span className="event-text">{describe(e)}</span>
              <span className="event-ts" title={e.ts}>{relative(e.ts, now)}</span>
            </li>
          )
        ))}
      </ul>
    </div>
  );
}
