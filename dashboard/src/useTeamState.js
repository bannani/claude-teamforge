import { useEffect, useState } from 'react';

const NO_COMPANY = { departments: [], roles: [] };

// Live team state: initial fetch + SSE snapshots. The worker pushes the full
// snapshot on every mutation, so no client-side merging is needed. The company
// (role catalog) is static and fetched once.
export function useTeamState() {
  const [state, setState] = useState(null);
  const [company, setCompany] = useState(NO_COMPANY);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    fetch('/api/state').then((r) => r.json()).then(setState).catch(() => {});
    fetch('/api/roles')
      .then((r) => (r.ok ? r.json() : NO_COMPANY))
      .then((c) => setCompany(Array.isArray(c.roles) && Array.isArray(c.departments) ? c : NO_COMPANY))
      .catch(() => {});
    const es = new EventSource('/events');
    es.onmessage = (e) => setState(JSON.parse(e.data));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  return { state, company, connected };
}
