import React from 'react';
import { Crewmate } from './CrewRoom.jsx';

// Who reports to whom, as an indented tree built from each role's `reportsTo`.

function Node({ person, childrenOf, deptName, selected, onSelect }) {
  const reports = childrenOf[person.id] || [];
  return (
    <li>
      <button
        type="button"
        className={`org-card ${person.status} ${selected === person.id ? 'selected' : ''}`}
        style={{ '--c': person.color }}
        onClick={() => onSelect(selected === person.id ? null : person.id)}
        aria-pressed={selected === person.id}
      >
        <span className="org-avatar"><Crewmate color={person.color} /></span>
        <span className="org-main">
          <span className="org-title">{person.title}</span>
          <span className="org-sub">
            {deptName[person.department] || person.department}
            {person.status === 'working' && person.note ? ` · ${person.note}` : ''}
          </span>
        </span>
        <span className={`badge ${person.status}`}>{person.status}</span>
      </button>
      {reports.length > 0 && (
        <ul className="org-branch">
          {reports.map((p) => (
            <Node key={p.id} person={p} childrenOf={childrenOf} deptName={deptName} selected={selected} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OrgChart({ roster, departments, selected, onSelect }) {
  const ids = new Set(roster.map((r) => r.id));
  const childrenOf = {};
  const roots = [];
  for (const r of roster) {
    if (r.reportsTo && ids.has(r.reportsTo)) (childrenOf[r.reportsTo] ||= []).push(r);
    else roots.push(r);
  }
  const deptName = Object.fromEntries(departments.map((d) => [d.id, d.name]));
  return (
    <ul className="org-tree" aria-label="Organisation chart">
      {roots.map((p) => (
        <Node key={p.id} person={p} childrenOf={childrenOf} deptName={deptName} selected={selected} onSelect={onSelect} />
      ))}
    </ul>
  );
}
