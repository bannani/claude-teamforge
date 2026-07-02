import React from 'react';

export function FilesPanel({ files }) {
  if (files.length === 0) return null;
  return (
    <div className="panel">
      <h3>Files changed</h3>
      <div className="file-chips">
        {files.map((f) => <code key={f} className="file-chip">{f}</code>)}
      </div>
    </div>
  );
}
