export const TABS = [
  { id: 'company', label: 'Company' },
  { id: 'console', label: 'Console' },
  { id: 'mission', label: 'Mission' },
];

// Arrow / Home / End navigation for the mobile tab bar (wraps around).
export function nextTab(current, key) {
  const ids = TABS.map((t) => t.id);
  const i = Math.max(0, ids.indexOf(current));
  if (key === 'Home') return ids[0];
  if (key === 'End') return ids[ids.length - 1];
  if (key === 'ArrowRight') return ids[(i + 1) % ids.length];
  if (key === 'ArrowLeft') return ids[(i - 1 + ids.length) % ids.length];
  return current;
}

// Statuses other than todo/done (review, testing, blocked…) need attention,
// so they count as in progress, like the task board groups them.
export function countTasks(tasks) {
  const out = { todo: 0, in_progress: 0, done: 0, total: tasks.length };
  for (const t of tasks) {
    if (t.status === 'todo') out.todo += 1;
    else if (t.status === 'done') out.done += 1;
    else out.in_progress += 1;
  }
  return out;
}

export function truncate(text, max) {
  const s = text ?? '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
