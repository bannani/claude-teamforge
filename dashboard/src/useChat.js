import { useCallback, useEffect, useReducer } from 'react';
import { TAB } from './tab.js';

// The conversation with the company: saved transcript + live chat events.

const initial = { messages: [], draft: '', running: false, grants: [], allowAll: false, browser: [], browserKind: 'own', extension: true, mode: 'build', model: undefined, models: { default: null, roles: {} }, notice: '' };
let localId = 0;
const withKey = (m) => ({ key: m.id ? `m${m.id}` : `l${localId += 1}`, ...m });

function reduce(state, action) {
  switch (action.type) {
    case 'loaded':
      return { ...state, messages: action.messages.map(withKey), running: action.running, grants: action.grants, allowAll: action.allowAll, browser: action.browser || [], browserKind: action.browserKind || 'own', extension: action.extension !== false, mode: action.mode || 'build', model: action.model, models: action.models || initial.models, draft: '' };
    case 'system': // a line from TeamForge itself: command replies, notices
      return { ...state, notice: '', messages: [...state.messages, withKey({ role: 'system', text: action.text, command: action.command })] };
    case 'mode': // build ⇄ spike: each has its own conversation
      return { ...state, mode: action.mode, messages: (action.messages || []).map(withKey), draft: '', notice: '' };
    case 'cleared':
      return { ...state, messages: [], draft: '', notice: '' };
    case 'permissions':
      return { ...state, grants: action.grants, allowAll: action.allowAll, browser: action.browser || [], browserKind: action.browserKind || 'own', extension: action.extension !== false };
    case 'extension': // is the TeamForge Chrome extension there?
      return state.extension === action.connected ? state : { ...state, extension: action.connected };
    case 'models': // the company's model and each employee's own
      return { ...state, model: action.models.default, models: action.models };
    case 'notice':
      return { ...state, notice: action.text };
    case 'granted':
      return { ...state, grants: action.grants };
    case 'user':
      return { ...state, notice: '', messages: [...state.messages, withKey({ role: 'user', text: action.text, images: action.images })] };
    case 'turn_start':
      return { ...state, running: true };
    case 'text':
      return { ...state, draft: state.draft + action.text };
    case 'message':
      // an employee's own agent reports while the CEO may still be mid-sentence
      return { ...state, draft: action.agent ? state.draft : '', messages: [...state.messages, withKey({ role: 'assistant', text: action.text, agent: action.agent })] };
    case 'tool_start':
      return { ...state, messages: [...state.messages, withKey({ role: 'tool', callId: action.id, name: action.name, summary: action.summary, agent: action.agent, pending: true })] };
    case 'tool_end': {
      const { type, id, project, ...tool } = action;
      const done = { role: 'tool', ...tool };
      const at = state.messages.findIndex((m) => m.pending && m.callId === id);
      const messages = at < 0
        ? [...state.messages, withKey(done)]
        : state.messages.map((m, i) => (i === at ? { ...done, key: m.key } : m));
      return { ...state, messages };
    }
    case 'error':
      return { ...state, messages: [...state.messages, withKey({ role: 'error', text: action.text })] };
    case 'turn_end': {
      // a stopped turn keeps whatever was already streamed
      const messages = state.draft ? [...state.messages, withKey({ role: 'assistant', text: state.draft })] : state.messages;
      return { ...state, running: false, draft: '', messages: messages.map((m) => (m.pending ? { ...m, pending: false, ok: false, error: 'interrupted' } : m)) };
    }
    default:
      return state;
  }
}

const post = (path, body) => fetch(path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

export function useChat(project) {
  const [state, dispatch] = useReducer(reduce, initial);

  useEffect(() => {
    if (!project) return;
    fetch(`/api/chat?project=${encodeURIComponent(project)}&tab=${TAB}`)
      .then((r) => r.json())
      .then((h) => dispatch({ type: 'loaded', messages: h.messages || [], running: !!h.running, grants: h.grants || [], allowAll: !!h.allowAll, browser: h.browser, browserKind: h.browserKind, extension: h.extension, mode: h.mode, model: h.model, models: h.models }))
      .catch(() => {});
  }, [project]);

  // While the team may act in the client's Chrome, keep an eye on the extension.
  const watchExtension = state.browser.length > 0 && state.browserKind === 'own';
  useEffect(() => {
    if (!watchExtension) return undefined;
    const check = () => fetch('/api/bridge/status').then((r) => r.json()).then((s) => dispatch({ type: 'extension', connected: !!s.connected })).catch(() => {});
    const timer = setInterval(check, 10000);
    return () => clearInterval(timer);
  }, [watchExtension]);

  const send = useCallback(async (text, images = []) => {
    try {
      const res = await post('/api/chat', { project_path: project, tab: TAB, text, images: images.length ? images : undefined });
      if (res.ok) return true;
      const body = await res.json().catch(() => ({}));
      dispatch({ type: 'notice', text: body.error || `The worker refused the message (${res.status}).` });
    } catch {
      dispatch({ type: 'notice', text: 'The worker is not reachable. Run `teamforge` again, then reload.' });
    }
    return false;
  }, [project]);

  const stop = useCallback(() => { post('/api/chat/stop', { project_path: project }).catch(() => {}); }, [project]);

  const allow = useCallback(async (program) => {
    try {
      const res = await post('/api/grants', { project_path: project, tab: TAB, program });
      const body = await res.json().catch(() => ({}));
      if (res.ok) dispatch({ type: 'granted', grants: body.grants || [] });
      else dispatch({ type: 'notice', text: body.error || 'Could not allow that program.' });
    } catch {
      dispatch({ type: 'notice', text: 'The worker is not reachable.' });
    }
  }, [project]);

  // role null = the company's model; model null = back to the default
  const setModel = useCallback(async (role, model) => {
    try {
      const res = await fetch('/api/models', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project_path: project, role, model }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { dispatch({ type: 'models', models: body.models }); return ''; }
      return body.error || `The worker refused (${res.status}).`;
    } catch {
      return 'The worker is not reachable.';
    }
  }, [project]);

  // The project's open sessions, and taking one back into this tab.
  const listSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions?project=${encodeURIComponent(project)}&tab=${TAB}`);
      return res.ok ? (await res.json()).sessions || [] : [];
    } catch { return []; }
  }, [project]);

  const openSession = useCallback(async (id) => {
    try {
      const res = await post(`/api/sessions/${id}/adopt`, { project_path: project, tab: TAB });
      if (res.ok) return true;
      const body = await res.json().catch(() => ({}));
      dispatch({ type: 'notice', text: body.error || 'Could not open that session.' });
    } catch {
      dispatch({ type: 'notice', text: 'The worker is not reachable.' });
    }
    return false;
  }, [project]);

  return { ...state, onChat: dispatch, send, stop, allow, setModel, listSessions, openSession };
}
