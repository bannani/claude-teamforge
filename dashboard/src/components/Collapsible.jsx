import React, { useId, useState } from 'react';

// A panel whose body can be folded away; the header shows a count badge.
export function Collapsible({ title, count, defaultOpen = true, className = '', children }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={`panel collapsible ${open ? 'open' : 'closed'} ${className}`}>
      <button
        type="button" className="collapse-head" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <h3>{title}</h3>
        {count != null && <span className="count-pill">{count}</span>}
        <span className="chevron" aria-hidden="true">▾</span>
      </button>
      <div id={id} className="collapse-body" hidden={!open}>{children}</div>
    </div>
  );
}
