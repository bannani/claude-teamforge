import React, { useEffect, useState } from 'react';
import { Crewmate } from './CrewRoom.jsx';

// One employee's file: job description (from the role catalog) + what they
// are doing right now (tasks, status, recent activity).

// Model names seen working with Copilot; any other name can be typed.
const MODEL_HINTS = ['claude-sonnet-5.5', 'gpt-5.6-sol', 'auto'];

// Which model this employee runs on. The CEO is the main agent, so their model
// is the company's; anyone else with a model of their own works as a sub-agent.
function ModelPicker({ person, models, onSetModel }) {
  const isCeo = person.id === 'ceo';
  const own = isCeo ? models.default : models.roles[person.id];
  const [value, setValue] = useState(own || '');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setValue(own || ''); setProblem(''); }, [person.id, own]);
  const inherited = isCeo ? 'Copilot\'s default' : models.default || 'Copilot\'s default';

  async function apply(next) {
    setBusy(true);
    setProblem(await onSetModel(isCeo ? null : person.id, next || null));
    setBusy(false);
  }

  return (
    <form className="model-picker" onSubmit={(e) => { e.preventDefault(); apply(value.trim()); }}>
      <label className="file-label" htmlFor={`model-${person.id}`}>Model</label>
      <div className="model-row">
        <input
          id={`model-${person.id}`} list="model-hints" value={value} disabled={busy} spellCheck="false"
          placeholder={isCeo ? `${inherited} — the whole company` : `Same as the company (${inherited})`}
          onChange={(e) => setValue(e.target.value)}
        />
        <datalist id="model-hints">{MODEL_HINTS.map((m) => <option key={m} value={m} />)}</datalist>
        <button type="submit" className="btn-ghost" disabled={busy || value.trim() === (own || '')}>Set</button>
        {own && <button type="button" className="btn-ghost" disabled={busy} onClick={() => apply('')}>Reset</button>}
      </div>
      <p className="muted">
        {isCeo ? 'The CEO leads every turn: this is the model of everyone who has none of their own.'
          : own ? 'Works as their own agent on this model, from the next turn.'
            : 'No model of their own: the CEO plays this role.'}
      </p>
      {problem && <p className="con-error" role="alert">{problem}</p>}
    </form>
  );
}

export function EmployeeFile({ person, roster, departments, phase, tasks, events, onSelect, onClose, models, onSetModel }) {
  const manager = roster.find((r) => r.id === person.reportsTo);
  const reports = roster.filter((r) => r.reportsTo === person.id);
  const department = departments.find((d) => d.id === person.department)?.name || person.department;
  const myTasks = tasks.filter((t) => t.role === person.id);
  const activity = events.filter((e) => e.kind === 'agent' && e.payload.role === person.id).slice(0, 5);
  const link = (p) => (
    <button key={p.id} type="button" className="person-link" style={{ '--c': p.color }} onClick={() => onSelect(p.id)}>
      {p.short}
    </button>
  );

  return (
    <section className="panel employee-file" style={{ '--c': person.color }} aria-label={`${person.title} file`}>
      <header className="file-head">
        <div className="file-avatar"><Crewmate color={person.color} /></div>
        <div className="file-id">
          <span className="eyebrow">{department}</span>
          <h3>{person.title}</h3>
          {person.mission && <p className="file-mission">{person.mission}</p>}
        </div>
        <span className={`badge ${person.status}`}>{person.status}</span>
        <button type="button" className="popup-close" onClick={onClose} aria-label="Close employee file">×</button>
      </header>

      <p className="file-now">
        <span className="file-label">Now</span>
        {person.note || (person.status === 'idle' ? 'Available.' : 'Nothing to report.')}
      </p>

      {models && onSetModel && <ModelPicker person={person} models={models} onSetModel={onSetModel} />}

      <dl className="file-facts">
        <div>
          <dt>Reports to</dt>
          <dd>{manager ? link(manager) : 'The client (you)'}</dd>
        </div>
        {reports.length > 0 && (
          <div>
            <dt>Manages</dt>
            <dd className="link-row">{reports.map(link)}</dd>
          </div>
        )}
        {person.deliverable && (
          <div>
            <dt>Delivers</dt>
            <dd>{person.deliverable}</dd>
          </div>
        )}
      </dl>

      {person.responsibilities.length > 0 && (
        <>
          <h4 className="file-label">Responsibilities</h4>
          <ul className="file-list">
            {person.responsibilities.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </>
      )}

      {person.phases.length > 0 && (
        <>
          <h4 className="file-label">Works during</h4>
          <div className="phase-chips">
            {person.phases.map((p) => (
              <span key={p} className={`phase-chip ${p === phase ? 'current' : ''}`}>
                {p.replace('_', ' ')}{p === phase ? ' · now' : ''}
              </span>
            ))}
          </div>
        </>
      )}

      <h4 className="file-label">Tasks · {myTasks.length}</h4>
      {myTasks.length === 0
        ? <p className="muted">No task assigned.</p>
        : (
          <ul className="file-tasks">
            {myTasks.map((t) => (
              <li key={t.id}>
                <span className={`badge ${t.status}`}>{t.status.replace('_', ' ')}</span>
                <span>{t.title}</span>
              </li>
            ))}
          </ul>
        )}

      {activity.length > 0 && (
        <>
          <h4 className="file-label">Recent activity</h4>
          <ul className="crew-popup-log">
            {activity.map((e) => (
              <li key={e.id}>
                <span className="muted">{e.ts?.slice(11, 19)}</span> {e.payload.status}
                {e.payload.note ? ` — ${e.payload.note}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
