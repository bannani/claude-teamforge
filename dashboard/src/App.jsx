import React from 'react';
import { useTeamState } from './useTeamState.js';
import { PhaseBar } from './components/PhaseBar.jsx';
import { AgentGrid } from './components/AgentGrid.jsx';
import { ValidationPanel } from './components/ValidationPanel.jsx';
import { TaskBoard } from './components/TaskBoard.jsx';
import { Timeline } from './components/Timeline.jsx';
import { FilesPanel } from './components/FilesPanel.jsx';
import { StatusStrip } from './components/StatusStrip.jsx';

export default function App() {
  const { state, connected } = useTeamState();

  if (!state || state.empty) {
    return (
      <div className="empty-hero">
        <div className="logo-orb" />
        <h1>TeamForge</h1>
        <p>No active mission. Give Claude an idea and the team will assemble.</p>
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
          {working > 0 && <span className="live-pill">⚡ {working} agent{working > 1 ? 's' : ''} working</span>}
          <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'live' : 'reconnecting…'}</span>
        </div>
      </header>

      <PhaseBar phase={session.phase} />
      <ValidationPanel validations={validations} />

      <div className="grid-main">
        <section className="col">
          <h2 className="section-title">The Team</h2>
          <AgentGrid agents={agents} />
          <StatusStrip agents={agents} events={events} />
        </section>
        <section className="col">
          <h2 className="section-title">Mission</h2>
          <TaskBoard tasks={tasks} />
          <FilesPanel files={files} />
          {decisions.length > 0 && (
            <div className="panel">
              <h3>Decisions</h3>
              <ul className="decision-list">
                {decisions.map((d) => (
                  <li key={d.id} className={`decision ${d.status}`}>
                    <span className={`badge ${d.status}`}>{d.status}</span> {d.title}
                    {d.detail && <span className="muted"> — {d.detail}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <section className="col">
          <h2 className="section-title">Timeline</h2>
          <Timeline events={events} />
        </section>
      </div>
    </div>
  );
}
