import React from 'react';
import { Collapsible } from './Collapsible.jsx';

export function FilesPanel({ files }) {
  if (files.length === 0) return null;
  return (
    <Collapsible title="Files changed" count={files.length}>
      <div className="file-chips">
        {files.map((f) => <code key={f} className="file-chip" title={f}>{f}</code>)}
      </div>
    </Collapsible>
  );
}
