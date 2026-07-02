import React from 'react';

const META = {
  pm: { icon: '🧭', label: 'Product Manager', hue: 265 },
  architect: { icon: '📐', label: 'Architect', hue: 215 },
  frontend: { icon: '🎨', label: 'Frontend', hue: 320 },
  backend: { icon: '⚙️', label: 'Backend', hue: 150 },
  qa: { icon: '🧪', label: 'QA / Test', hue: 45 },
  security: { icon: '🛡️', label: 'Security', hue: 5 },
  reviewer: { icon: '🔍', label: 'Reviewer', hue: 185 },
};

export function AgentGrid({ agents }) {
  return (
    <div className="workspace">
      {agents.map((a) => {
        const meta = META[a.role] || { icon: '🤖', label: a.role, hue: 200 };
        return (
          <div key={a.role} className={`panel desk ${a.status}`} style={{ '--hue': meta.hue }}>
            <div className="avatar-wrap">
              <div className="avatar">
                <span className="avatar-face">{meta.icon}</span>
              </div>
              <span className={`status-dot ${a.status}`} />
            </div>
            <h3 className="desk-name">{meta.label}</h3>
            <span className={`badge ${a.status}`}>{a.status}</span>
            {a.status === 'working' ? (
              <div className="bubble">
                {a.note || 'on it'}
                <span className="typing"><i /><i /><i /></span>
              </div>
            ) : (
              <p className="agent-note">{a.note || '·'}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
