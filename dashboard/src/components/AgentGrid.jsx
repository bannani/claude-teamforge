import React from 'react';

const META = {
  pm: { icon: '🧭', label: 'Product Manager' },
  architect: { icon: '📐', label: 'Architect' },
  frontend: { icon: '🎨', label: 'Frontend' },
  backend: { icon: '⚙️', label: 'Backend' },
  qa: { icon: '🧪', label: 'QA / Test' },
  security: { icon: '🛡️', label: 'Security' },
  reviewer: { icon: '🔍', label: 'Reviewer' },
};

export function AgentGrid({ agents }) {
  return (
    <div className="agent-grid">
      {agents.map((a) => {
        const meta = META[a.role] || { icon: '🤖', label: a.role };
        return (
          <div key={a.role} className={`panel agent-card ${a.status}`}>
            <div className="agent-head">
              <span className="agent-icon">{meta.icon}</span>
              <span className={`badge ${a.status}`}>{a.status}</span>
            </div>
            <h3>{meta.label}</h3>
            <p className="agent-note">{a.note || '—'}</p>
          </div>
        );
      })}
    </div>
  );
}
