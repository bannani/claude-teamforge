import React from 'react';

const GROUPS = [
  { id: 'in_progress', label: 'In progress', statuses: ['in_progress', 'testing', 'review'] },
  { id: 'todo', label: 'To do', statuses: ['todo'] },
  { id: 'done', label: 'Done', statuses: ['done'] },
];

function ProgressRing({ pct }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg className="progress-ring" viewBox="0 0 48 48" role="img" aria-label={`${pct}% complete`}>
      <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(140,166,255,0.12)" strokeWidth="5" />
      <circle
        cx="24" cy="24" r={r} fill="none" stroke="url(#ring-grad)" strokeWidth="5"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)}
        transform="rotate(-90 24 24)" className="ring-fill"
      />
      <defs>
        <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#59e0f2" />
          <stop offset="100%" stopColor="#45de8a" />
        </linearGradient>
      </defs>
      <text x="24" y="28" textAnchor="middle" className="ring-text">{pct}%</text>
    </svg>
  );
}

export function TaskBoard({ tasks, roleNames = {} }) {
  if (tasks.length === 0) {
    return <div className="panel"><h3>Tasks</h3><p className="muted">Tasks appear once the plan is validated.</p></div>;
  }
  const done = tasks.filter((t) => t.status === 'done').length;
  const pct = Math.round((done / tasks.length) * 100);

  // Unknown statuses (e.g. blocked) fall into "In progress" — they need attention.
  const grouped = GROUPS.map((g) => ({
    ...g,
    items: tasks.filter((t) => g.statuses.includes(t.status)
      || (g.id === 'in_progress' && !GROUPS.some((x) => x.statuses.includes(t.status)))),
  }));

  return (
    <div className="panel">
      <div className="task-head">
        <div>
          <h3>Tasks</h3>
          <span className="muted">{done}/{tasks.length} complete</span>
        </div>
        <ProgressRing pct={pct} />
      </div>
      {grouped.map((g) => g.items.length > 0 && (
        <div key={g.id} className={`task-group ${g.id}`}>
          <div className="task-group-label">{g.label} · {g.items.length}</div>
          <ul className="task-list">
            {g.items.map((t) => (
              <li key={t.id} className={`task ${t.status}`}>
                <span className={`badge ${t.status}`}>{t.status.replace('_', ' ')}</span>
                <span className="task-title">{t.title}</span>
                {t.role && <span className="role-chip">{roleNames[t.role] || t.role}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
