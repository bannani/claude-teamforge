import { useEffect, useRef } from 'react';

const COLORS = ['#59e0f2', '#8f7ff8', '#45de8a', '#f6b95c', '#f472b6', '#eef2fb'];

// Tasteful DOM confetti — no deps, cleans itself up, honors reduced motion.
export function burstConfetti(count = 60) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  for (let i = 0; i < count; i += 1) {
    const bit = document.createElement('span');
    bit.className = 'confetti-bit';
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = COLORS[i % COLORS.length];
    bit.style.setProperty('--dx', `${(Math.random() - 0.5) * 220}px`);
    bit.style.setProperty('--rot', `${360 + Math.random() * 540}deg`);
    bit.style.setProperty('--dur', `${2 + Math.random() * 1.6}s`);
    bit.style.animationDelay = `${Math.random() * 0.5}s`;
    layer.appendChild(bit);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 4500);
}

// Fire confetti when a validation flips to approved, and a bigger burst when
// the mission reaches 'done'. Compares snapshots across SSE updates.
export function useCelebration(state) {
  const prev = useRef(null);
  useEffect(() => {
    if (!state || state.empty) { prev.current = null; return; }
    const last = prev.current;
    prev.current = { phase: state.session.phase, approved: state.validations.filter((v) => v.status === 'approved').length };
    if (!last) return;
    if (state.session.phase === 'done' && last.phase !== 'done') burstConfetti(140);
    else if (prev.current.approved > last.approved) burstConfetti(60);
  }, [state]);
}
