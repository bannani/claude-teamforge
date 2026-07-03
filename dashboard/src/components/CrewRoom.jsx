import React, { useEffect, useRef, useState } from 'react';

// Among-Us-style crew room: each agent is a bean crewmate. Idle crew hang out
// in the lounge; a working agent walks to its station (CSS position transition)
// and types. Click a crewmate for details.

const CREW = {
  pm: { label: 'PM', color: '#8b7cf6', station: { x: 12, y: 24 } },
  architect: { label: 'Architect', color: '#3b82f6', station: { x: 38, y: 20 } },
  frontend: { label: 'Frontend', color: '#ec4899', station: { x: 64, y: 20 } },
  backend: { label: 'Backend', color: '#22c55e', station: { x: 88, y: 26 } },
  qa: { label: 'QA', color: '#eab308', station: { x: 14, y: 82 } },
  security: { label: 'Security', color: '#ef4444', station: { x: 50, y: 88 } },
  reviewer: { label: 'Reviewer', color: '#4fd8eb', station: { x: 86, y: 82 } },
};

const LOUNGE = {
  pm: { x: 34, y: 50 }, architect: { x: 44, y: 44 }, frontend: { x: 54, y: 50 },
  backend: { x: 64, y: 45 }, qa: { x: 39, y: 58 }, security: { x: 50, y: 62 },
  reviewer: { x: 60, y: 57 },
};

function Crewmate({ color }) {
  return (
    <svg viewBox="0 0 100 120" className="crew-svg">
      <ellipse cx="56" cy="114" rx="28" ry="5" fill="rgba(0,0,0,0.35)" />
      <rect x="6" y="42" width="20" height="46" rx="10" fill={color} style={{ filter: 'brightness(0.7)' }} />
      <path
        d="M32 112 L32 50 Q32 16 58 16 Q84 16 84 50 L84 112 L68 112 L68 97 Q58 93 48 97 L48 112 Z"
        fill={color} stroke="rgba(0,0,0,0.35)" strokeWidth="3"
      />
      <ellipse cx="67" cy="44" rx="17" ry="11.5" fill="#c3e6f2" stroke="rgba(0,0,0,0.3)" strokeWidth="2.5" />
      <ellipse cx="61" cy="41" rx="7" ry="4" fill="rgba(255,255,255,0.75)" />
    </svg>
  );
}

// Track which crew are mid-walk: when an agent's target position changes we
// add a "walking" class for the duration of the CSS position transition.
function useWalking(agents) {
  const [walking, setWalking] = useState({});
  const prev = useRef({});
  const timers = useRef({});
  useEffect(() => {
    for (const a of agents) {
      if (prev.current[a.role] !== undefined && prev.current[a.role] !== a.status) {
        setWalking((w) => ({ ...w, [a.role]: true }));
        clearTimeout(timers.current[a.role]);
        timers.current[a.role] = setTimeout(() => {
          setWalking((w) => ({ ...w, [a.role]: false }));
        }, 2400);
      }
      prev.current[a.role] = a.status;
    }
  }, [agents]);
  // Timers must survive re-renders (snapshots arrive mid-walk); clear only on unmount.
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  return walking;
}

export function CrewRoom({ agents, events }) {
  const [selected, setSelected] = useState(null);
  const walking = useWalking(agents);
  const selectedAgent = agents.find((a) => a.role === selected);
  const recent = selected
    ? events.filter((e) => e.kind === 'agent' && e.payload.role === selected).slice(0, 4)
    : [];

  return (
    <div className="panel crew-panel">
      <div className="crew-room" onClick={() => setSelected(null)}>
        <div className="room-horizon" />
        {Object.entries(CREW).map(([role, meta]) => (
          <div
            key={`station-${role}`}
            className={`station ${agents.find((a) => a.role === role)?.status === 'working' ? 'lit' : ''}`}
            style={{ left: `${meta.station.x}%`, top: `${meta.station.y - 13}%`, '--c': meta.color }}
          />
        ))}
        {agents.map((a) => {
          const meta = CREW[a.role] || { label: a.role, color: '#94a3b8', station: { x: 50, y: 50 } };
          const pos = a.status === 'working' ? meta.station : (LOUNGE[a.role] || { x: 50, y: 50 });
          const depth = 0.88 + (pos.y / 100) * 0.24; // lower on screen = closer = bigger
          return (
            <div
              key={a.role}
              className={`crew ${a.status} ${walking[a.role] ? 'walking' : ''} ${selected === a.role ? 'selected' : ''}`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, zIndex: 2 + Math.round(pos.y), '--depth': depth }}
              onClick={(e) => { e.stopPropagation(); setSelected(selected === a.role ? null : a.role); }}
              title={`${meta.label} — ${a.status}`}
            >
              {a.status === 'working' && (
                <div className="bubble crew-bubble">
                  {(a.note || 'on it').slice(0, 44)}
                  <span className="typing"><i /><i /><i /></span>
                </div>
              )}
              {a.status === 'blocked' && <span className="crew-alert">!</span>}
              {a.status === 'done' && <span className="crew-check">✓</span>}
              <Crewmate color={meta.color} />
              <span className="crew-name" style={{ '--c': meta.color }}>{meta.label}</span>
            </div>
          );
        })}
        {selectedAgent && (
          <div className="crew-popup panel" onClick={(e) => e.stopPropagation()}>
            <div className="crew-popup-head">
              <strong>{CREW[selected]?.label || selected}</strong>
              <span className={`badge ${selectedAgent.status}`}>{selectedAgent.status}</span>
              <button type="button" className="popup-close" onClick={() => setSelected(null)}>×</button>
            </div>
            <p className="crew-popup-note">{selectedAgent.note || 'Nothing to report.'}</p>
            {recent.length > 0 && (
              <ul className="crew-popup-log">
                {recent.map((e) => (
                  <li key={e.id}>
                    <span className="muted">{e.ts?.slice(11, 19)}</span> {e.payload.status}
                    {e.payload.note ? ` — ${e.payload.note}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
