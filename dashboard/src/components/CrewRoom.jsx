import React, { useEffect, useMemo, useRef, useState } from 'react';
import { officeLayout } from '../company.js';

// The office: each employee is a bean crewmate. Idle staff hang out in the
// lounge; a working employee walks to their desk in their department's zone
// (CSS position transition) and types. Click someone to open their file.

export function Crewmate({ color }) {
  return (
    <svg viewBox="0 0 100 120" className="crew-svg" aria-hidden="true">
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

// Track who is mid-walk: when someone's status changes we add a "walking"
// class for the duration of the CSS position transition.
function useWalking(roster) {
  const [walking, setWalking] = useState({});
  const prev = useRef({});
  const timers = useRef({});
  useEffect(() => {
    for (const a of roster) {
      if (prev.current[a.id] !== undefined && prev.current[a.id] !== a.status) {
        setWalking((w) => ({ ...w, [a.id]: true }));
        clearTimeout(timers.current[a.id]);
        timers.current[a.id] = setTimeout(() => {
          setWalking((w) => ({ ...w, [a.id]: false }));
        }, 2400);
      }
      prev.current[a.id] = a.status;
    }
  }, [roster]);
  // Timers must survive re-renders (snapshots arrive mid-walk); clear only on unmount.
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  return walking;
}

export function CrewRoom({ roster, departments, selected, onSelect }) {
  const walking = useWalking(roster);
  const ids = roster.map((r) => `${r.id}:${r.department}`).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { desks, zones, lounge } = useMemo(() => officeLayout(roster), [ids]);
  const deptName = Object.fromEntries(departments.map((d) => [d.id, d.name]));

  return (
    <div className="crew-room" onClick={() => onSelect(null)}>
      <div className="room-horizon" />
      {zones.map((z) => (
        <span key={z.department} className="zone-label" style={{ left: `${z.x}%`, top: `${z.y}%` }}>
          {deptName[z.department] || z.department}
        </span>
      ))}
      {roster.map((r) => (
        <div
          key={`desk-${r.id}`}
          className={`station ${r.status === 'working' ? 'lit' : ''}`}
          style={{ left: `${desks[r.id].x}%`, top: `${desks[r.id].y - 13}%`, '--c': r.color }}
        />
      ))}
      {roster.map((r) => {
        const pos = r.status === 'working' ? desks[r.id] : lounge[r.id];
        const depth = 0.86 + (pos.y / 100) * 0.2; // lower on screen = closer = bigger
        const edge = pos.x < 22 ? 'edge-l' : pos.x > 78 ? 'edge-r' : '';
        return (
          <button
            type="button"
            key={r.id}
            className={`crew ${r.status} ${edge} ${walking[r.id] ? 'walking' : ''} ${selected === r.id ? 'selected' : ''}`}
            style={{ left: `${pos.x}%`, top: `${pos.y}%`, zIndex: 2 + Math.round(pos.y), '--depth': depth }}
            onClick={(e) => { e.stopPropagation(); onSelect(selected === r.id ? null : r.id); }}
            aria-pressed={selected === r.id}
            aria-label={`${r.title} — ${r.status}${r.note ? `: ${r.note}` : ''}`}
            title={`${r.title} — ${r.status}`}
          >
            {r.status === 'working' && (
              <span className="bubble crew-bubble">
                <span className="bubble-text">{r.note || 'on it'}</span>
                <span className="typing"><i /><i /><i /></span>
              </span>
            )}
            {r.status === 'blocked' && <span className="crew-alert">!</span>}
            {r.status === 'done' && <span className="crew-check">✓</span>}
            <Crewmate color={r.color} />
            <span className="crew-name" style={{ '--c': r.color }}>{r.short}</span>
          </button>
        );
      })}
    </div>
  );
}
