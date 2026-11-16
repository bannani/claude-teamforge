import React from 'react';
import { parseBlocks, parseInline } from '../markdown.js';

function Inline({ text }) {
  return parseInline(text).map((p, i) => {
    if (p.type === 'code') return <code key={i}>{p.text}</code>;
    if (p.type === 'strong') return <strong key={i}>{p.text}</strong>;
    if (p.type === 'em') return <em key={i}>{p.text}</em>;
    if (p.type === 'link') return <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>;
    return p.text;
  });
}

export function Markdown({ source }) {
  return (
    <div className="md">
      {parseBlocks(source).map((b, i) => {
        switch (b.type) {
          case 'heading': {
            const Tag = `h${Math.min(6, b.level + 1)}`; // the dialog title is the h2
            return <Tag key={i} className={`md-h md-h${b.level}`}><Inline text={b.text} /></Tag>;
          }
          case 'code': return <pre key={i}><code>{b.text}</code></pre>;
          case 'rule': return <hr key={i} />;
          case 'quote': return <blockquote key={i}><Inline text={b.text} /></blockquote>;
          case 'list': return (
            <ul key={i} className="md-list">
              {b.items.map((it, k) => (
                <li key={k} style={{ marginLeft: `${it.depth * 20}px` }} className={it.checked ? 'checked' : ''}>
                  <span className="md-marker" aria-hidden={it.checked === null}>
                    {it.checked === null ? it.marker : it.checked ? '☑' : '☐'}
                  </span>
                  <span><Inline text={it.text} /></span>
                </li>
              ))}
            </ul>
          );
          case 'table': return (
            <div key={i} className="md-table-wrap">
              <table>
                <thead><tr>{b.head.map((c, k) => <th key={k} scope="col"><Inline text={c} /></th>)}</tr></thead>
                <tbody>
                  {b.rows.map((r, k) => <tr key={k}>{b.head.map((_, c) => <td key={c}><Inline text={r[c] ?? ''} /></td>)}</tr>)}
                </tbody>
              </table>
            </div>
          );
          default: return <p key={i}><Inline text={b.text} /></p>;
        }
      })}
    </div>
  );
}
