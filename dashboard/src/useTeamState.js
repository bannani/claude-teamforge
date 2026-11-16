import { useEffect, useState } from 'react';

const NO_COMPANY = { departments: [], roles: [], loaded: false };
const FLAT_TEAM = { departments: [], roles: [], loaded: true }; // worker without a role catalog

// Which project this page is for and which model provider is available.
// The project comes from the URL (?project=, set by the `teamforge` launcher)
// or, without it, from the worker (latest mission, else its start directory).
export function useWorkspace() {
  const [workspace, setWorkspace] = useState(null);
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('project');
    fetch(`/api/provider${param ? `?project=${encodeURIComponent(param)}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`worker answered ${r.status}`))))
      .then(setWorkspace)
      .catch((err) => setWorkspace({ project: null, provider: null, reason: `Cannot reach the worker: ${err.message}. Reload the page.` }));
  }, []);
  return workspace;
}

// Live team state: initial fetch + SSE snapshots. The worker pushes the full
// snapshot on every mutation, so no client-side merging is needed. The company
// (role catalog) is static and fetched once. `onChat` receives chat events.
export function useTeamState(project, onChat) {
  const [state, setState] = useState(null);
  const [company, setCompany] = useState(NO_COMPANY);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    fetch('/api/roles')
      .then((r) => (r.ok ? r.json() : FLAT_TEAM))
      .then((c) => setCompany(Array.isArray(c.roles) && Array.isArray(c.departments) ? { ...c, loaded: true } : FLAT_TEAM))
      .catch(() => setCompany(FLAT_TEAM));
  }, []);

  useEffect(() => {
    if (!project) return undefined;
    const query = `?project=${encodeURIComponent(project)}`;
    fetch(`/api/state${query}`).then((r) => r.json()).then(setState).catch(() => {});
    const es = new EventSource(`/events${query}`);
    es.onmessage = (e) => setState(JSON.parse(e.data));
    es.addEventListener('chat', (e) => onChat(JSON.parse(e.data)));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => es.close();
    // onChat is a stable callback (useChat's dispatcher)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  return { state, company, connected };
}
