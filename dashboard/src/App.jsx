import React, { useEffect, useRef, useState } from 'react';
import { useTeamState, useWorkspace } from './useTeamState.js';
import { useChat } from './useChat.js';
import { Console } from './components/Console.jsx';
import { useCelebration } from './useCelebration.js';
import { PhaseBar } from './components/PhaseBar.jsx';
import { Company } from './components/Company.jsx';
import { ValidationPanel } from './components/ValidationPanel.jsx';
import { TaskBoard } from './components/TaskBoard.jsx';
import { Timeline } from './components/Timeline.jsx';
import { FilesPanel } from './components/FilesPanel.jsx';
import { StatusStrip } from './components/StatusStrip.jsx';
import { DecisionsPanel } from './components/DecisionsPanel.jsx';
import { TABS, nextTab } from './layout.js';
import { DocsPanel, DocViewer, useDocs } from './components/Documents.jsx';
import { QuestionsPanel } from './components/QuestionsPanel.jsx';

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

function MobileTabs({ tab, onTab, badges }) {
  const onKeyDown = (e) => {
    const next = nextTab(tab, e.key);
    if (next !== tab) {
      e.preventDefault();
      onTab(next);
      document.getElementById(`tab-${next}`)?.focus();
    }
  };
  return (
    <div className="mobile-tabs" role="tablist" aria-label="Dashboard sections" onKeyDown={onKeyDown}>
      {TABS.map((t) => (
        <button
          key={t.id} id={`tab-${t.id}`} type="button" role="tab"
          aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
          className={`mobile-tab ${tab === t.id ? 'active' : ''}`} onClick={() => onTab(t.id)}
        >
          {t.label}
          {badges[t.id] > 0 && <span className="tab-badge" aria-label={`${badges[t.id]} new`}>{badges[t.id]}</span>}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const workspace = useWorkspace();
  const chat = useChat(workspace?.project);
  const { state, company, connected } = useTeamState(workspace?.project, chat.onChat);
  useCelebration(state);
  const [tab, setTab] = useState('console');
  const [openDoc, setOpenDoc] = useState(null);
  // documents change when the team writes a file or the phase moves
  const docsVersion = state && !state.empty ? `${state.session.id}:${state.session.phase}:${state.files.length}:${state.events[0]?.id ?? 0}` : '';
  const { docs, reload: reloadDocs } = useDocs(state && !state.empty ? workspace?.project : null, docsVersion);
  const seen = useRef(chat.messages.length);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (tab === 'console') { seen.current = chat.messages.length; setUnread(0); }
    else setUnread(Math.max(0, chat.messages.length - seen.current));
  }, [tab, chat.messages.length]);
  const spike = chat.mode === 'spike';
  // from the list of questions back to the answer (on a phone the console is another tab)
  const jumpTo = (key) => {
    setTab('console');
    requestAnimationFrame(() => document.getElementById(`msg-${key}`)?.scrollIntoView({ block: 'start' }));
  };
  const titles = Object.fromEntries(company.roles.map((r) => [r.id, r.title]));
  const console_ = <Console chat={chat} workspace={workspace} hasMission={!!state && !state.empty} roleNames={titles} />;

  if (!state || state.empty) {
    return (
      <div className="empty-hero">
        <Starfield />
        <div className="logo-orb" />
        <h1>TeamForge</h1>
        <p>{spike ? 'Spike mode. Ask how the product behaves today: the team reads the code and answers in business terms.' : 'No active mission. Give the company an idea and the team will assemble.'}</p>
        <div className="hero-console">{console_}</div>
        <span className={`conn ${connected ? 'on' : 'off'}`}>
          {connected ? 'worker connected' : 'connecting…'}
        </span>
      </div>
    );
  }

  const { session, agents, tasks, validations, decisions, events, files } = state;
  const working = agents.filter((a) => a.status === 'working').length;
  const pendingGates = validations.filter((v) => v.status === 'pending').length;
  const roleNames = Object.fromEntries(company.roles.map((r) => [r.id, r.short]));

  return (
    <div className="shell app">
      <header className="topbar panel">
        <div className="brand">
          <div className="logo-orb small" />
          <div>
            <h1>{session.project_name || 'TeamForge'}</h1>
            <p className="subtitle">{session.title}</p>
          </div>
        </div>
        <div className="topbar-right">
          <span className="phase-pill">{spike ? 'spike · read-only' : session.phase.replace('_', ' ')}</span>
          {working > 0 && <span className="live-pill">⚡ {working} of {agents.length} at work</span>}
          <span className={`conn ${connected ? 'on' : 'off'}`} role="status">{connected ? '● live' : '○ reconnecting…'}</span>
        </div>
      </header>

      {!spike && <PhaseBar phase={session.phase} />}

      <MobileTabs tab={tab} onTab={setTab} badges={{ console: unread + pendingGates }} />

      <div className="grid-main">
        <section className="col" id="panel-company" data-active={tab === 'company'}>
          <Company company={company} agents={agents} tasks={tasks} events={events} phase={session.phase} validations={validations} models={chat.models} onSetModel={chat.setModel} />
        </section>
        <section className="col col-console" id="panel-console" data-active={tab === 'console'}>
          {!spike && <ValidationPanel validations={validations} onOpenDoc={setOpenDoc} />}
          {console_}
        </section>
        <section className="col" id="panel-mission" data-active={tab === 'mission'}>
          {spike ? <QuestionsPanel messages={chat.messages} running={chat.running} onExport={() => chat.send('/export')} onJump={jumpTo} /> : (
            <>
              <TaskBoard tasks={tasks} roleNames={roleNames} />
              <StatusStrip agents={agents} events={events} />
              <DocsPanel docs={docs} onOpen={setOpenDoc} />
              <FilesPanel files={files} />
              <DecisionsPanel decisions={decisions} />
            </>
          )}
          <Timeline events={events} />
        </section>
      </div>
      {openDoc && (
        <DocViewer
          key={openDoc} project={workspace.project} path={openDoc} version={docsVersion}
          title={docs.find((d) => d.path === openDoc)?.title || openDoc}
          onClose={() => setOpenDoc(null)} onSaved={reloadDocs}
        />
      )}
    </div>
  );
}
