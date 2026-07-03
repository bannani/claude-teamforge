import React from 'react';
import { useTeamState } from './useTeamState.js';
import { useCelebration } from './useCelebration.js';
import { PhaseBar } from './components/PhaseBar.jsx';
import { CrewRoom } from './components/CrewRoom.jsx';
import { ValidationPanel } from './components/ValidationPanel.jsx';
import { TaskBoard } from './components/TaskBoard.jsx';
import { Timeline } from './components/Timeline.jsx';
import { FilesPanel } from './components/FilesPanel.jsx';
import { StatusStrip } from './components/StatusStrip.jsx';
import { DecisionsPanel } from './components/DecisionsPanel.jsx';

function Starfield() {
  // Deterministic pseudo-random star placement (stable across renders).
  const stars = Array.from({ length: 40 }, (_, i) => {
    const a = Math.sin(i * 127.1) * 43758.5453;
    const b = Math.sin(i * 311.7) * 26737.858;
    return {
      left: `${(a - Math.floor(a)) * 100}%`,
      top: `${(b - Math.floor(b)) * 100}%`,
      delay: `${(i % 10) * 0.7}s`,
      size: 1 + (i % 3),
    };
  });
  return (
    <div className="starfield" aria-hidden="true">
      {stars.map((s, i) => (
        <span key={i} className="star" style={{ left: s.left, top: s.top, width: s.size, height: s.size, animationDelay: s.delay }} />
      ))}
    </div>
  );
}

export default function App() {
  const { state, connected } = useTeamState();
  useCelebration(state);

  if (!state || state.empty) {
    return (
      <div className="empty-hero">
        <Starfield />
        <div className="logo-orb" />
        <h1>TeamForge</h1>
        <p>No active mission. Give Claude an idea and the team will assemble.</p>
        <span className="hint-line">try: “build me a habit tracker”</span>
        <span className={`conn ${connected ? 'on' : 'off'}`}>
          {connected ? 'worker connected' : 'connecting…'}
        </span>
      </div>
    );
  }

  const { session, agents, tasks, validations, decisions, events, files } = state;
  const working = agents.filter((a) => a.status === 'working').length;

  return (
    <div className="shell">
      <header className="topbar panel">
        <div className="brand">
          <div className="logo-orb small" />
          <div>
            <h1>{session.project_name || 'TeamForge'}</h1>
            <p className="subtitle">{session.title}</p>
          </div>
        </div>
        <div className="topbar-right">
          <span className="phase-pill">{session.phase.replace('_', ' ')}</span>
          {working > 0 && <span className="live-pill">⚡ {working} agent{working > 1 ? 's' : ''} working</span>}
          <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'live' : 'reconnecting…'}</span>
        </div>
      </header>

      <PhaseBar phase={session.phase} />
      <ValidationPanel validations={validations} />

      <div className="grid-main">
        <section className="col">
          <h2 className="section-title">The Crew</h2>
          <CrewRoom agents={agents} events={events} />
          <StatusStrip agents={agents} events={events} />
        </section>
        <section className="col">
          <h2 className="section-title">Mission</h2>
          <TaskBoard tasks={tasks} />
          <FilesPanel files={files} />
          <DecisionsPanel decisions={decisions} />
        </section>
        <section className="col">
          <h2 className="section-title">Timeline</h2>
          <Timeline events={events} />
        </section>
      </div>
    </div>
  );
}
