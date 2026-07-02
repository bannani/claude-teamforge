import React from 'react';

const ORDER = ['todo', 'in_progress', 'testing', 'review', 'done'];

export function TaskBoard({ tasks }) {
  if (tasks.length === 0) {
    return <div className="panel"><h3>Tasks</h3><p className="muted">Tasks appear once the plan is validated.</p></div>;
  }
  const done = tasks.filter((t) => t.status === 'done').length;
  const pct = Math.round((done / tasks.length) * 100);

  return (
    <div className="panel">
      <div className="task-head">
        <h3>Tasks</h3>
        <span className="muted">{done}/{tasks.length} · {pct}%</span>
      </div>
      <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
      <ul className="task-list">
        {[...tasks].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)).map((t) => (
          <li key={t.id} className={`task ${t.status}`}>
            <span className={`badge ${t.status}`}>{t.status.replace('_', ' ')}</span>
            <span className="task-title">{t.title}</span>
            {t.role && <span className="role-chip">{t.role}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
