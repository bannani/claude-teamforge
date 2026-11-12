import React, { useState } from 'react';
import { buildRoster, departmentsOf } from '../company.js';
import { CrewRoom } from './CrewRoom.jsx';
import { OrgChart } from './OrgChart.jsx';
import { EmployeeFile } from './EmployeeFile.jsx';

const VIEWS = [
  { id: 'office', label: 'Office' },
  { id: 'org', label: 'Org chart' },
];

// The company column: headcount per department, the office or the org chart,
// and the selected employee's file.
export function Company({ company, agents, tasks, events, phase }) {
  const [view, setView] = useState('office');
  const [selected, setSelected] = useState(null);
  const roster = buildRoster(company, agents);
  const departments = departmentsOf(company, roster);
  const person = roster.find((r) => r.id === selected);

  return (
    <>
      <div className="panel crew-panel">
        <div className="company-head">
          <div className="view-tabs" role="tablist" aria-label="Company view">
            {VIEWS.map((v) => (
              <button
                key={v.id} type="button" role="tab" aria-selected={view === v.id}
                className={`view-tab ${view === v.id ? 'active' : ''}`}
                onClick={() => setView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <ul className="dept-strip" aria-label="Departments">
            {departments.map((d) => {
              const staff = roster.filter((r) => r.department === d.id);
              const busy = staff.filter((r) => r.status === 'working').length;
              return (
                <li key={d.id} className={`dept-chip ${busy ? 'busy' : ''}`}>
                  <span className="dept-name">{d.name}</span>
                  <span className="dept-count">{busy}/{staff.length}</span>
                </li>
              );
            })}
          </ul>
        </div>
        {view === 'office'
          ? <CrewRoom roster={roster} departments={departments} selected={selected} onSelect={setSelected} />
          : <OrgChart roster={roster} departments={departments} selected={selected} onSelect={setSelected} />}
      </div>
      {person
        ? (
          <EmployeeFile
            person={person} roster={roster} departments={departments} phase={phase}
            tasks={tasks} events={events} onSelect={setSelected} onClose={() => setSelected(null)}
          />
        )
        : <p className="muted file-hint">Select an employee to open their file: role, responsibilities, tasks.</p>}
    </>
  );
}
