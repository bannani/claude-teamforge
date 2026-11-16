import { TAB } from '../tab.js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Collapsible } from './Collapsible.jsx';
import { Markdown } from './Markdown.jsx';

// The mission documents (spec, stories, design, plan): listed in the Mission
// column, opened in a dialog to read as formatted text or edit as markdown.

export function useDocs(project, version) {
  const [docs, setDocs] = useState([]);
  const load = useCallback(() => {
    if (!project) return;
    fetch(`/api/docs?project=${encodeURIComponent(project)}`)
      .then((r) => (r.ok ? r.json() : { docs: [] }))
      .then((d) => setDocs(d.docs || []))
      .catch(() => {});
  }, [project]);
  useEffect(load, [load, version]);
  return { docs, reload: load };
}

export function DocsPanel({ docs, onOpen }) {
  if (docs.length === 0) return null;
  return (
    <Collapsible title="Documents" count={docs.filter((d) => d.exists).length}>
      <ul className="doc-list">
        {docs.map((d) => (
          <li key={d.path}>
            <button type="button" className={`doc-row ${d.exists ? '' : 'missing'}`} onClick={() => onOpen(d.path)}>
              <span className="doc-title">{d.title}</span>
              <code className="doc-path">{d.path}</code>
              <span className="doc-state">{d.exists ? 'Open' : 'Not written yet'}</span>
            </button>
          </li>
        ))}
      </ul>
    </Collapsible>
  );
}

export function DocViewer({ project, path, title, version, onClose, onSaved }) {
  const dialog = useRef(null);
  const [doc, setDoc] = useState(null);          // { content, rev } — rev null: not written yet
  const [mode, setMode] = useState('read');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [theirs, setTheirs] = useState(null);    // the team's newer revision, after a refused save
  const dirty = mode === 'edit' && doc && draft !== doc.content;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/docs/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`);
      if (res.status === 404) { setDoc({ content: '', rev: null }); return; }
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `worker answered ${res.status}`);
      setDoc({ content: body.content, rev: body.rev });
      setProblem('');
    } catch (err) {
      setProblem(`Could not open the document: ${err.message}`);
    }
  }, [project, path]);

  useEffect(() => { dialog.current?.showModal(); }, []);
  // While reading, follow what the team writes. While editing, the draft is left alone:
  // a newer version is caught when saving.
  const reading = mode === 'read';
  useEffect(() => { if (reading) load(); }, [load, version, reading]);

  const startEditing = () => { setDraft(doc.content); setTheirs(null); setProblem(''); setMode('edit'); };
  const stopEditing = () => { setMode('read'); setTheirs(null); setProblem(''); };

  async function save() {
    setBusy(true);
    try {
      const res = await fetch('/api/docs/file', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project_path: project, tab: TAB, path, content: draft, base_rev: theirs ?? doc.rev }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setDoc({ content: draft, rev: body.rev });
        stopEditing();
        onSaved?.();
      } else if (res.status === 409) {
        setTheirs(body.rev ?? null);
        setProblem('The team changed this document while you were editing. Save again to replace their version with yours, or Discard to load theirs.');
      } else {
        setProblem(body.error || `The worker refused the save (${res.status}).`);
      }
    } catch {
      setProblem('The worker is not reachable. Your text is still here.');
    }
    setBusy(false);
  }

  const leave = (action) => {
    if (dirty && !window.confirm('Discard your changes to this document?')) return;
    action();
  };

  return (
    <dialog
      ref={dialog} className="doc-dialog" aria-labelledby="doc-title"
      onClose={onClose}
      onCancel={(e) => { if (dirty) { e.preventDefault(); leave(() => dialog.current.close()); } }}
    >
      <header className="doc-head">
        <div className="doc-head-id">
          <h2 id="doc-title">{title}</h2>
          <code>{path}</code>
        </div>
        <div className="view-tabs" role="tablist" aria-label="Document mode">
          <button type="button" role="tab" aria-selected={reading} className={`view-tab ${reading ? 'active' : ''}`} onClick={() => !reading && leave(stopEditing)}>Read</button>
          <button type="button" role="tab" aria-selected={!reading} className={`view-tab ${reading ? '' : 'active'}`} disabled={!doc} onClick={() => reading && startEditing()}>Edit</button>
        </div>
        <button type="button" className="popup-close" aria-label="Close document" onClick={() => leave(() => dialog.current.close())}>×</button>
      </header>

      {problem && <p className="con-error" role="alert">{problem}</p>}

      <div className="doc-body">
        {!doc && !problem && <p className="muted">Opening…</p>}
        {doc && reading && (doc.rev === null
          ? (
            <div className="doc-empty">
              <p>The team has not written this document yet.</p>
              <button type="button" className="con-btn" onClick={startEditing}>Write it yourself</button>
            </div>
          )
          : <Markdown source={doc.content} />)}
        {doc && !reading && (
          <textarea
            className="doc-editor" aria-label={`${title} — markdown`} spellCheck="false" autoFocus
            value={draft} onChange={(e) => setDraft(e.target.value)}
          />
        )}
      </div>

      {!reading && (
        <footer className="doc-foot">
          <span className="muted">Markdown. The team is told about your changes on your next message.</span>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => leave(stopEditing)}>Discard</button>
          <button type="button" className="con-btn" disabled={busy || (!dirty && theirs === null)} onClick={save}>
            {theirs !== null ? 'Replace their version' : 'Save'}
          </button>
        </footer>
      )}
    </dialog>
  );
}
