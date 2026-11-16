import React, { useEffect, useMemo, useRef, useState } from 'react';
import { officeLayout, placeOf, pickVisit } from '../company.js';

// The office: each employee is a bean crewmate. Every department has its own
// room, plus a meeting room, all opening on a wide lounge in the middle. Idle
// staff stand in the lounge; a working employee walks (out by a door, across
// the lounge, in by the other door) to their desk and types. Click someone to
// open their file.
//
// Everything is sized in container units (cqw), so the room keeps its
// proportions at any column width, and people move with `translate` (composited)
// instead of left/top.

export const ROOM_RATIO = 0.9; // height / width, mirrored by `aspect-ratio` in CSS

export function Crewmate({ color }) {
  return (
    <svg viewBox="0 0 100 120" className="crew-svg" aria-hidden="true">
      <ellipse cx="56" cy="114" rx="28" ry="5" fill="rgba(0,0,0,0.35)" />
      <g className="crew-bob">
        <rect className="leg leg-l" x="32" y="86" width="17" height="26" rx="6" fill={color} stroke="rgba(0,0,0,0.35)" strokeWidth="3" />
        <rect className="leg leg-r" x="67" y="86" width="17" height="26" rx="6" fill={color} stroke="rgba(0,0,0,0.35)" strokeWidth="3" />
        <rect x="6" y="42" width="20" height="46" rx="10" fill={color} style={{ filter: 'brightness(0.7)' }} />
        <path
          d="M32 98 L32 50 Q32 16 58 16 Q84 16 84 50 L84 98 Q58 92 32 98 Z"
          fill={color} stroke="rgba(0,0,0,0.35)" strokeWidth="3"
        />
        <ellipse cx="67" cy="44" rx="17" ry="11.5" fill="#c3e6f2" stroke="rgba(0,0,0,0.3)" strokeWidth="2.5" />
        <ellipse cx="61" cy="41" rx="7" ry="4" fill="rgba(255,255,255,0.75)" />
      </g>
    </svg>
  );
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// How each person moves to their current spot: out of their room by its door,
// across the lounge, in by the destination's door. The path is a list of
// segments played one after the other; a timer re-renders at each boundary.
// The first placement (or reduced motion) is instant. Kept in a ref so
// re-renders mid-walk don't restart anything.
function segment(from, to) {
  const dx = to.x - from.x;
  const dy = (to.y - from.y) * ROOM_RATIO;
  return { x: to.x, y: to.y, ms: Math.round(Math.min(1500, Math.max(250, Math.hypot(dx, dy) * 28))), dx };
}

// The lounge is open space: only real rooms are entered and left by their door.
// Each stretch that goes through a doorway says which door it opens.
function planPath(from, spot, layout, midWalk) {
  const dest = layout.byId[spot.room];
  const src = layout.byId[from.room];
  const points = [];
  if (spot.room !== from.room) {
    if (src && !src.open && !midWalk) points.push({ ...src.inner, door: src.id }, { ...src.lane, door: src.id });
    if (dest && !dest.open) points.push({ ...dest.lane, door: dest.id }, { ...dest.inner, door: dest.id });
  }
  points.push(spot);
  const segs = [];
  let cur = from;
  for (const p of points) {
    segs.push({ ...segment(cur, p), door: p.door });
    cur = p;
  }
  return { segs };
}

function useMotion(roster, spotOf, layout) {
  const memory = useRef({});
  const [, rerender] = useState(0);
  const now = performance.now();
  const reduced = prefersReducedMotion();
  const motion = {};
  const opened = new Set();
  let nextBoundary = 0;
  for (const r of roster) {
    const spot = spotOf(r);
    let m = memory.current[r.id];
    if (!m) {
      m = { x: spot.x, y: spot.y, ms: 0, face: 1, room: spot.room, tx: spot.x, ty: spot.y, plan: null };
    } else if (m.tx !== spot.x || m.ty !== spot.y) {
      if (reduced) {
        m = { ...m, x: spot.x, y: spot.y, ms: 0, room: spot.room, tx: spot.x, ty: spot.y, plan: null };
      } else {
        const { segs } = planPath({ x: m.x, y: m.y, room: m.room }, spot, layout, Boolean(m.plan));
        m = { ...m, room: spot.room, tx: spot.x, ty: spot.y, plan: { start: now, segs } };
      }
    }
    let walking = false;
    if (m.plan) {
      let end = m.plan.start;
      let index = -1;
      for (let i = 0; i < m.plan.segs.length && index < 0; i += 1) {
        end += m.plan.segs[i].ms;
        if (now < end) index = i;
      }
      if (index < 0) {
        m = { ...m, plan: null };
      } else {
        const seg = m.plan.segs[index];
        m = { ...m, x: seg.x, y: seg.y, ms: seg.ms, face: Math.abs(seg.dx) < 1 ? m.face : Math.sign(seg.dx) };
        walking = true;
        nextBoundary = nextBoundary ? Math.min(nextBoundary, end) : end;
        if (seg.door) opened.add(seg.door);
      }
    }
    memory.current[r.id] = m;
    motion[r.id] = { ...m, walking };
  }
  useEffect(() => {
    if (!nextBoundary) return undefined;
    const timer = setTimeout(() => rerender((n) => n + 1), Math.max(30, nextBoundary - performance.now() + 30));
    return () => clearTimeout(timer);
  }, [nextBoundary]);
  return { motion, opened };
}

const VISIT_EVERY_MS = 14000;
const VISIT_LASTS_MS = 6000;
const PARTY_LASTS_MS = 3400;
const CONFETTI = Array.from({ length: 16 }, (_, i) => ({
  left: 8 + ((i * 37) % 84), delay: (i % 5) * 0.15, hue: ['#59e0f2', '#8f7ff8', '#45de8a', '#f6b95c', '#f472b6'][i % 5],
}));
const FIXED_NAMES = { meeting: 'Meeting room', cafeteria: 'Lounge', team: 'Team' };

// Colleagues from other departments drop by now and then, and whenever the
// phase changes: one visitor at a time, back at their desk afterwards.
function useVisits(roster, phase, gatePending) {
  const [visit, setVisit] = useState(null);
  const latest = useRef({ roster, gatePending });
  latest.current = { roster, gatePending };
  const seq = useRef(0);
  const clear = useRef(null);
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const start = () => {
      const { roster: now, gatePending: gate } = latest.current;
      const v = pickVisit(gate ? now.filter((r) => r.id !== 'ceo') : now, seq.current);
      seq.current += 1;
      if (!v) return;
      setVisit(v);
      clearTimeout(clear.current);
      clear.current = setTimeout(() => setVisit(null), VISIT_LASTS_MS);
    };
    const first = setTimeout(start, 1800);
    const every = setInterval(start, VISIT_EVERY_MS);
    return () => { clearTimeout(first); clearInterval(every); clearTimeout(clear.current); };
  }, [phase]);
  return visit;
}

// A short party in the meeting room when a gate gets approved.
function useParty(approved) {
  const [party, setParty] = useState(false);
  const last = useRef(approved);
  useEffect(() => {
    const grew = approved > last.current;
    last.current = approved;
    if (!grew || prefersReducedMotion()) return undefined;
    setParty(true);
    const timer = setTimeout(() => setParty(false), PARTY_LASTS_MS);
    return () => clearTimeout(timer);
  }, [approved]);
  return party;
}

export function CrewRoom({ roster, departments, selected, onSelect, phase = '', validations = [] }) {
  const ids = roster.map((r) => `${r.id}:${r.department}`).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => officeLayout(roster), [ids]);
  const gatePending = validations.some((v) => v.status === 'pending');
  const approved = validations.filter((v) => v.status === 'approved').length;
  const visit = useVisits(roster, phase, gatePending);
  const party = useParty(approved);
  const deptName = Object.fromEntries(departments.map((d) => [d.id, d.name]));

  const worker = (id) => roster.find((r) => r.id === id && r.status === 'working');
  const visitSpot = (r) => {
    if (!visit || visit.visitor !== r.id || !worker(visit.host) || !worker(r.id)) return null;
    const desk = layout.desks[visit.host];
    const room = layout.byId[desk.room];
    return { x: desk.x + 7 > room.x + room.w - 2 ? desk.x - 7 : desk.x + 7, y: desk.y, room: desk.room };
  };
  const spotOf = (r) => visitSpot(r) || placeOf(r, layout, { gatePending });
  const { motion, opened } = useMotion(roster, spotOf, layout);
  const roomName = (room) => FIXED_NAMES[room.id] || deptName[room.id] || room.id;
  const activeIn = (room) => {
    if (room.kind === 'meeting') return gatePending;
    return roster.some((r) => r.status === 'working' && placeOf(r, layout, { gatePending }).room === room.id);
  };

  return (
    <div className="crew-room" onClick={() => onSelect(null)}>
      {layout.rooms.map((room) => {
        const active = activeIn(room);
        const staff = roster.filter((r) => r.status === 'working' && placeOf(r, layout, { gatePending }).room === room.id).length;
        const tint = roster.find((r) => layout.desks[r.id].room === room.id)?.color; // the room wears its department's colour
        return (
          <div
            key={room.id}
            role="group"
            aria-label={`${roomName(room)}${room.kind === 'department' ? ` — ${staff} working` : ''}`}
            className={`room room-${room.kind} ${active ? 'active' : ''} ${party && room.kind === 'meeting' ? 'party' : ''}`}
            style={{ left: `${room.x}%`, top: `${room.y}%`, width: `${room.w}%`, height: `${room.h}%`, '--rc': tint }}
          >
            <span className="room-sign">{roomName(room)}{room.kind === 'department' && staff > 0 ? ` · ${staff}` : ''}</span>
            {room.kind === 'meeting' && <span className="meeting-table" aria-hidden="true" />}
            {room.kind === 'cafeteria' && (
              <span className="lounge-decor" aria-hidden="true">
                <i className="cafe-counter" /><i className="cafe-table t1" /><i className="cafe-table t2" /><i className="cafe-table t3" />
                <i className="plant p1" /><i className="plant p2" />
              </span>
            )}
            {party && room.kind === 'meeting' && CONFETTI.map((c, i) => (
              <i key={i} className="party-bit" style={{ left: `${c.left}%`, animationDelay: `${c.delay}s`, background: c.hue }} aria-hidden="true" />
            ))}
          </div>
        );
      })}
      {layout.rooms.filter((room) => room.door).map((room) => (
        <span
          key={`door-${room.id}`}
          className={`door ${room.door.y < 50 ? 'door-top' : 'door-bottom'} ${opened.has(room.id) ? 'open' : ''}`}
          style={{ left: `${room.door.x}%`, top: `${room.door.y}%` }}
          aria-hidden="true"
        />
      ))}
      {roster.map((r) => {
        const desk = layout.desks[r.id];
        const m = motion[r.id];
        const lit = r.status === 'working' && !m.walking && m.room === desk.room && m.x === desk.x && m.y === desk.y;
        return (
          <div
            key={`desk-${r.id}`}
            className={`station ${lit ? 'lit' : ''}`}
            style={{ left: `${desk.x}%`, top: `${desk.y - 10.5}%`, '--c': r.color }}
          />
        );
      })}
      {roster.map((r, i) => {
        const m = motion[r.id];
        const visiting = visit?.visitor === r.id && !m.walking && m.tx !== layout.desks[r.id].x;
        const depth = 0.94 + (m.y / 100) * 0.08; // a hint of depth: lower on screen = slightly bigger
        // standing in the lounge, neighbours turn towards each other
        const face = !m.walking && m.room === 'cafeteria' ? (i % 2 ? -1 : 1) : m.face;
        const edge = m.x < 22 ? 'edge-l' : m.x > 78 ? 'edge-r' : '';
        return (
          <button
            type="button"
            key={r.id}
            className={`crew ${r.status} ${edge} ${m.walking ? 'walking' : ''} ${visiting ? 'visiting' : ''} ${selected === r.id ? 'selected' : ''}`}
            style={{
              '--x': m.x, '--y': m.y, '--walk': `${m.ms}ms`, '--depth': depth, '--face': face,
              // nobody breathes in step with their neighbour
              '--idle': `${3.4 + (i % 5) * 0.45}s`, '--idle-delay': `${-(i * 0.7)}s`,
              zIndex: 2 + Math.round(m.y),
            }}
            onClick={(e) => { e.stopPropagation(); onSelect(selected === r.id ? null : r.id); }}
            aria-pressed={selected === r.id}
            aria-label={`${r.title} — ${r.status}${r.note ? `: ${r.note}` : ''}`}
            title={`${r.title} — ${r.status}`}
          >
            <span className="crew-fig">
              {r.status === 'working' && !m.walking && (
                <span className="bubble crew-bubble">
                  <span className="bubble-text">{r.note || 'on it'}</span>
                  <span className="typing"><i /><i /><i /></span>
                </span>
              )}
              {r.status === 'blocked' && <span className="crew-alert">!</span>}
              <span className="crew-flip"><Crewmate color={r.color} /></span>
              <span className={`crew-name ${r.status === 'done' ? 'is-done' : ''}`} style={{ '--c': r.color }}>{r.short}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
