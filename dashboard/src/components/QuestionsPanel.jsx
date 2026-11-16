import React from 'react';
import { Collapsible } from './Collapsible.jsx';
import { truncate } from '../layout.js';

// Spike mode: what the client has asked so far.
export function QuestionsPanel({ messages, running, onExport, onJump }) {
  const asked = messages.filter((m) => m.role === 'user');
  return (
    <Collapsible title="Questions asked" count={asked.length}>
      {asked.length === 0 ? (
        <p className="muted decisions-empty">Your questions about the product are listed here.</p>
      ) : (
        <>
          <ol className="question-list">
            {asked.map((m) => (
              <li key={m.key}>
                <button type="button" title="Show this question in the console" onClick={() => onJump(m.key)}>{truncate(m.text, 160)}</button>
              </li>
            ))}
          </ol>
          <button
            type="button" className="con-allow question-save" onClick={onExport}
            disabled={running || !messages.some((m) => m.role === 'assistant')}
          >
            Save as a document
          </button>
        </>
      )}
    </Collapsible>
  );
}
