import { useEffect, useState } from 'react';

// Live team state: initial fetch + SSE snapshots. The worker pushes the full
// snapshot on every mutation, so no client-side merging is needed.
export function useTeamState() {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    fetch('/api/state').then((r) => r.json()).then(setState).catch(() => {});
    const es = new EventSource('/events');
    es.onmessage = (e) => setState(JSON.parse(e.data));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  return { state, connected };
}
