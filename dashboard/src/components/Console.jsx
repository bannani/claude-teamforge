import React, { useEffect, useRef, useState } from 'react';
import { Markdown } from './Markdown.jsx';
import { groupSteps, splitAnswer } from '../spike.js';

// The console: where the client talks to the company. Transcript on top
// (messages, the tools the agent ran, errors), input at the bottom.

// Just enough markdown for chat replies: **bold** and `code`. Everything else
// stays as typed (line breaks are kept by CSS).
function Rich({ text }) {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, i) => {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

// Screenshots the team's browser took, or images the client attached.
function Images({ images }) {
  if (!images?.length) return null;
  return (
    <div className="con-images">
      {images.map((img) => (
        <a key={img.file || img.name} href={`/api/attachments/${img.file}`} target="_blank" rel="noopener noreferrer">
          <img src={`/api/attachments/${img.file}`} alt={`Image: ${img.name}`} loading="lazy" />
        </a>
      ))}
    </div>
  );
}

// A spike answer: the functional part, always; the technical part folded under it.
function SpikeAnswer({ text, streaming = false, expert }) {
  const { functional, technical, confidence } = splitAnswer(text);
  return (
    <div className="con-text con-md">
      <Markdown source={functional} />
      {streaming && technical === null && <span className="con-caret" aria-hidden="true" />}
      {confidence && (
        <p className={`con-conf ${confidence.level}`}>
          <span className="con-conf-level">Confidence · {confidence.level}</span>
          {confidence.reason && <span>{confidence.reason}</span>}
        </p>
      )}
      {technical !== null && (
        <details className="con-tech">
          <summary>
            Technical details{expert && <span className="con-agent">{expert}</span>}
            {streaming && <span className="con-tech-note">being written…</span>}
          </summary>
          <Markdown source={technical} />
        </details>
      )}
    </div>
  );
}

// Spike mode: what the team read to answer, folded into one line.
function Steps({ tools, who }) {
  const shown = tools.filter((m) => !isBookkeeping(m));
  if (!shown.length) return null;
  const busy = shown.findLast((m) => m.pending);
  const images = shown.flatMap((m) => m.images || []);
  return (
    <>
    <details className="con-steps">
      <summary>
        <span className="con-mark" aria-hidden="true">{busy ? '…' : '✓'}</span>
        {busy ? 'Reading the code' : 'Read the code'} · {shown.length} step{shown.length > 1 ? 's' : ''}
        {busy && <span className="con-tool-arg">{busy.summary}</span>}
      </summary>
      {shown.map((m) => <ToolLine key={m.key} m={{ ...m, images: undefined }} grants={[]} who={who[m.agent]} canGrant={false} />)}
    </details>
    {/* what the browser showed stays visible when the steps are folded */}
    <Images images={images} />
    </>
  );
}

// The project's other conversations: a new tab starts fresh, this brings one back.
function Sessions({ chat, disabled }) {
  const [list, setList] = useState(null);
  const ref = useRef(null);
  const close = () => { if (ref.current) ref.current.open = false; };
  return (
    <details
      className="con-sessions" ref={ref}
      onToggle={(e) => { if (e.currentTarget.open) { setList(null); chat.listSessions().then(setList); } }}
    >
      <summary title="Go back to another conversation of this project">Sessions</summary>
      <div className="con-sessions-list" role="menu">
        {list === null && <p className="muted">Loading…</p>}
        {list?.length === 0 && <p className="muted">No other conversation yet. Every new tab starts a fresh one.</p>}
        {list?.map((s) => (
          <button
            key={s.id} type="button" role="menuitem" className={s.here ? 'here' : ''}
            disabled={disabled || s.here || s.working}
            onClick={async () => { if (await chat.openSession(s.id)) close(); }}
          >
            <span className="con-sessions-title">{s.title || 'Untitled'}</span>
            <span className="con-sessions-meta">
              <span className={`con-sessions-kind ${s.kind}`}>{s.kind === 'spike' ? 'spike' : s.phase.replace('_', ' ')}</span>
              {s.questions} message{s.questions > 1 ? 's' : ''}
              {s.here ? ' · this tab' : s.working ? ' · the team is working in it' : ''}
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}

const MODES = [
  { id: 'build', label: 'Build', title: 'The company works on your mission' },
  { id: 'spike', label: 'Spike', title: 'Ask how the product behaves today — read-only' },
];

// The agent's own status reports already show on the dashboard; in the
// transcript they are noise unless one was refused.
const isBookkeeping = (m) => m.role === 'tool' && !m.pending && m.ok && /^teamforge\s/.test(m.summary || '');

function ToolLine({ m, grants, running, current, onAllow, who, canGrant }) {
  const state = m.pending ? 'pending' : m.ok ? 'ok' : m.denied ? 'denied' : 'failed';
  const mark = { pending: '…', ok: '✓', denied: '⊘', failed: '✗' }[state];
  // only the latest exchange offers the button: older refusals are history
  const canAllow = canGrant && current && m.denied && m.program && !grants.includes(m.program);
  return (
    <div className={`con-tool ${state}`}>
      <span className="con-mark" aria-hidden="true">{mark}</span>
      {who && <span className="con-agent">{who}</span>}
      {m.action ? (
        // in the browser: "QA · clicks Sign in button", not a tool name and its JSON
        <>
          <span className="con-web-mark" title="In the browser">browser</span>
          <span className="con-tool-name">{m.action.verb}</span>
          <span className="con-tool-arg">{m.action.target}</span>
        </>
      ) : (
        <>
          <span className="con-tool-name">{m.name}</span>
          <span className="con-tool-arg">{m.summary}</span>
        </>
      )}
      {state === 'failed' && m.error && <span className="con-tool-note">{m.error}</span>}
      {state === 'denied' && (
        <span className="con-tool-note">
          {m.program && grants.includes(m.program) ? `${m.program} is now allowed` : 'not allowed'}
        </span>
      )}
      {canAllow && (
        <button type="button" className="con-allow" disabled={running} onClick={() => onAllow(m.program)}>
          Allow <code>{m.program}</code> in this project
        </button>
      )}
      <Images images={m.images} />
    </div>
  );
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// A File → { name, data (base64), url (preview) }
const readImage = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve({ name: file.name || 'pasted-image.png', data: String(reader.result).split(',')[1], url: String(reader.result) });
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

export function Console({ chat, workspace, hasMission, roleNames = {} }) {
  const [text, setText] = useState('');
  const [pick, setPick] = useState(0);
  const [images, setImages] = useState([]);
  const [imageNote, setImageNote] = useState('');
  const fileRef = useRef(null);

  async function addImages(files) {
    const picked = [...files].filter((f) => IMAGE_TYPES.includes(f.type));
    if (!picked.length) { if (files.length) setImageNote('Only PNG, JPEG, GIF and WebP images can be attached.'); return; }
    const small = picked.filter((f) => f.size <= MAX_IMAGE_BYTES);
    const room = Math.max(0, MAX_IMAGES - images.length);
    setImageNote(small.length < picked.length ? 'An image larger than 5 MB was left out.'
      : small.length > room ? `At most ${MAX_IMAGES} images per message.` : '');
    const added = await Promise.all(small.slice(0, room).map(readImage));
    setImages((now) => [...now, ...added].slice(0, MAX_IMAGES));
  }
  const inputRef = useRef(null);
  const logRef = useRef(null);
  const stick = useRef(true);
  const ready = !!workspace?.provider && !!workspace?.project;

  // Follow new output unless the reader scrolled up.
  useEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.draft, chat.running]);

  const onScroll = (e) => {
    const el = e.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  // "/" opens the command list; it closes once a command name is complete.
  const typed = text.trim().toLowerCase();
  const suggestions = text.startsWith('/') && !/\s/.test(text)
    ? (workspace?.commands || []).filter((c) => `/${c.name}`.startsWith(typed) && `/${c.name}` !== typed)
    : [];
  const picked = suggestions[Math.min(pick, suggestions.length - 1)];
  const complete = (c) => {
    setText(c.usage.includes('<') || c.usage.includes('[') ? `/${c.name} ` : `/${c.name}`);
    setPick(0);
    inputRef.current?.focus();
  };

  function onKeyDown(e) {
    if (suggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPick((pick + 1) % suggestions.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPick((pick + suggestions.length - 1) % suggestions.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); complete(picked); return; }
      if (e.key === 'Escape') { e.preventDefault(); setText(''); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  }

  async function submit(e) {
    e?.preventDefault();
    const value = text.trim();
    // while the team works only commands go through (/stop, /status…)
    if ((!value && !images.length) || !ready || (chat.running && !value.startsWith('/'))) return;
    const attached = value.startsWith('/') ? [] : images; // commands take no image
    stick.current = true;
    setText('');
    if (attached.length) setImages([]);
    setImageNote('');
    if (!(await chat.send(value, attached.map(({ name, data }) => ({ name, data }))))) {
      setText(value); // refused: give the text and the images back
      if (attached.length) setImages(attached);
    }
  }

  const model = chat.model === undefined ? workspace?.model : chat.model;
  const empty = chat.messages.length === 0 && !chat.draft;
  const lastUser = chat.messages.findLastIndex((m) => m.role === 'user');
  const spike = chat.mode === 'spike';

  return (
    <section className="panel console" aria-label="Console">
      <header className="con-head">
        <h3>Console</h3>
        <div className="mode-switch" role="group" aria-label="Mode">
          {MODES.map((mode) => (
            <button
              key={mode.id} type="button" className={mode.id} title={mode.title}
              aria-pressed={chat.mode === mode.id} disabled={!ready || chat.running}
              onClick={() => { if (chat.mode !== mode.id) chat.send(`/${mode.id}`); }}
            >
              {mode.label}
            </button>
          ))}
        </div>
        {ready && <Sessions chat={chat} disabled={chat.running} />}
        {workspace?.provider && (
          <span className="con-provider">{workspace.label}{model ? ` · ${model}` : ''}</span>
        )}
        {chat.allowAll && <span className="con-open" title="/allow-all is on: the team can run any shell command from the implementation phase">all commands allowed</span>}
        {chat.browser.length > 0 && (
          <span className="con-web" title={`/browser: the team can act in ${chat.browserKind === 'own' ? 'your own Chrome' : 'a separate browser window'} on ${chat.browser.join(', ')}`}>
            {chat.browserKind === 'own' ? 'your Chrome' : 'browser'} · {chat.browser.map((o) => o.replace(/^https?:\/\//, '')).join(', ')}
          </span>
        )}
        {workspace?.project && <span className="con-project" title={workspace.project}>{workspace.project}</span>}
      </header>

      <div className="con-log" ref={logRef} onScroll={onScroll} role="log" aria-live="polite" tabIndex={0} aria-label="Conversation">
        {empty && (
          <div className="con-empty">
            {ready && spike ? (
              <>
                <p>Ask how the product behaves today. The team reads the code — it cannot change anything — and answers in business terms. The technical detail is one click away under each answer.</p>
                <p className="muted">Try: “What happens when a user asks for a new password?”</p>
              </>
            ) : ready ? (
              <>
                <p>Tell the company what to build. The team will ask its questions here and wait for your approval at each step.</p>
                <p className="muted">Try: “Build a habit tracker with a weekly view”</p>
              </>
            ) : <p>{workspace ? workspace.reason : 'Connecting to the worker…'}</p>}
          </div>
        )}
        {(spike ? groupSteps(chat.messages) : chat.messages).map((m, i) => {
          if (m.role === 'steps') return <Steps key={m.key} tools={m.tools} who={roleNames} />;
          if (isBookkeeping(m)) return null;
          if (m.role === 'tool') return <ToolLine key={m.key} m={m} grants={chat.grants} running={chat.running} current={i > lastUser} onAllow={chat.allow} who={roleNames[m.agent]} canGrant={!spike} />;
          if (m.role === 'error') return <p key={m.key} className="con-error" role="alert">{m.text}</p>;
          if (m.role === 'system') {
            return (
              <div key={m.key} className="con-sys">
                {m.command && <code className="con-cmd">{m.command}</code>}
                <div className="con-text"><Rich text={m.text} /></div>
              </div>
            );
          }
          return (
            <div key={m.key} id={`msg-${m.key}`} className={`con-msg ${m.role}`}>
              {/* a spike answer is the Business Analyst's */}
              <span className="con-who">{m.role === 'user' ? 'You' : roleNames[m.agent] || (spike && roleNames.analyst) || 'Company'}</span>
              {spike && m.role === 'assistant'
                ? <SpikeAnswer text={m.text} expert={roleNames.architect} />
                : <div className="con-text">{m.role === 'user' ? m.text : <Rich text={m.text} />}</div>}
              <Images images={m.images} />
            </div>
          );
        })}
        {chat.draft && (
          <div className="con-msg assistant">
            <span className="con-who">{(spike && roleNames.analyst) || 'Company'}</span>
            {spike
              ? <SpikeAnswer text={chat.draft} streaming expert={roleNames.architect} />
              : <div className="con-text"><Rich text={chat.draft} /><span className="con-caret" aria-hidden="true" /></div>}
          </div>
        )}
        {chat.running && !chat.draft && (
          <p className="con-working"><span className="typing"><i /><i /><i /></span> {spike ? 'reading the code…' : 'working…'}</p>
        )}
      </div>

      {chat.notice && <p className="con-error" role="alert">{chat.notice}</p>}

      {suggestions.length > 0 && (
        <ul className="con-suggest" role="listbox" aria-label="Commands">
          {suggestions.map((c) => (
            <li key={c.name} role="option" aria-selected={c === picked}>
              <button type="button" className={c === picked ? 'active' : ''} tabIndex={-1} onClick={() => complete(c)}>
                <code>{c.usage}</code><span>{c.about}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {(images.length > 0 || imageNote) && (
        <div className="con-attach">
          {images.map((img, i) => (
            <span key={img.url.slice(-40) + i} className="con-thumb">
              <img src={img.url} alt={img.name} />
              <button type="button" aria-label={`Remove ${img.name}`} onClick={() => setImages(images.filter((_, k) => k !== i))}>×</button>
            </span>
          ))}
          {imageNote && <span className="con-attach-note" role="status">{imageNote}</span>}
        </div>
      )}

      <form className="con-form" onSubmit={submit}>
        <input
          ref={fileRef} type="file" accept={IMAGE_TYPES.join(',')} multiple hidden
          onChange={(e) => { addImages(e.target.files); e.target.value = ''; }}
        />
        <button
          type="button" className="con-clip" disabled={!ready || images.length >= MAX_IMAGES}
          aria-label="Attach an image" title="Attach an image (or paste one)" onClick={() => fileRef.current?.click()}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.8" /><path d="M21 16l-5-5-8 9" />
          </svg>
        </button>
        <label className="sr-only" htmlFor="con-input">{spike ? 'Question for the company' : 'Message to the company'}</label>
        <textarea
          id="con-input" ref={inputRef} rows={2} value={text} disabled={!ready}
          placeholder={spike ? 'Ask how something works today…' : hasMission ? 'Answer or give the next instruction…' : 'Describe what you want built…'}
          onChange={(e) => { setText(e.target.value); setPick(0); }}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
            if (files.length) { e.preventDefault(); addImages(files); }
          }}
        />
        {chat.running
          ? <button type="button" className="con-btn stop" onClick={chat.stop}>Stop</button>
          : <button type="submit" className="con-btn" disabled={!ready || (!text.trim() && !images.length)}>Send</button>}
      </form>
      <p className="con-hint">Enter to send · Shift+Enter for a new line · <code>/</code> for commands</p>
    </section>
  );
}
