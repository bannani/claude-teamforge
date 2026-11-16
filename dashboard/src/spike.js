// Spike answers come in two parts: the functional answer, then — after a marker
// line — the technical detail the console keeps folded until the client opens it.

export const TECH_MARKER = '===TECHNICAL===';

// The line as models actually write it: spaces, bold, another case.
const MARKER_LINE = /^[ \t]*[*_`]*={3,}[ \t]*TECHNICAL[ \t]*={3,}[*_`]*[ \t]*$/im;

// "Confidence: high — covered by tests": the last line of the functional part.
const CONFIDENCE_LINE = /^[ \t]*[*_]*confidence[*_]*[ \t]*:[ \t*_`]*(high|medium|low)\b[*_`]*[ \t]*[—–:,.-]?[ \t]*(.*)$/im;

// Takes the confidence line out of the functional text so it can be shown as a badge.
function withConfidence(functional) {
  const m = CONFIDENCE_LINE.exec(functional);
  if (!m) return { functional, confidence: null };
  const rest = `${functional.slice(0, m.index)}${functional.slice(m.index + m[0].length)}`.trim();
  return { functional: rest, confidence: { level: m[1].toLowerCase(), reason: m[2].trim() } };
}

// → { functional, technical, confidence }. technical is null when the answer has
// one part only; confidence is null when the answer does not state one.
export function splitAnswer(text) {
  const s = text ?? '';
  const m = MARKER_LINE.exec(s);
  if (m) return { ...withConfidence(s.slice(0, m.index).trimEnd()), technical: s.slice(m.index + m[0].length).trim() };
  // while streaming the marker arrives in pieces: do not flash "===TECH"
  const tail = s.lastIndexOf('\n') + 1;
  const last = s.slice(tail).trim();
  if (last.length >= 3 && TECH_MARKER.startsWith(last)) return { ...withConfidence(s.slice(0, tail).trimEnd()), technical: null };
  return { ...withConfidence(s), technical: null };
}

// A Product Owner does not need every file the team opened: runs of tool lines
// become one { role: 'steps', tools } entry the console shows folded.
export function groupSteps(messages) {
  const out = [];
  for (const m of messages) {
    const last = out.at(-1);
    if (m.role !== 'tool') out.push(m);
    else if (last?.role === 'steps') last.tools.push(m);
    else out.push({ role: 'steps', key: `steps-${m.key}`, tools: [m] });
  }
  return out;
}
