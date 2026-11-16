// Images the client attaches to a console message. They are kept outside the
// project (under the worker's data directory), handed to the agent as
// attachments, and served back to the dashboard for the transcript.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class AttachmentError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// The type comes from the bytes, never from what the browser claims.
export function sniffImage(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('latin1'))) return { ext: 'gif', type: 'image/gif' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

const TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

// images: [{ name, data }] with data = base64. Checks everything before anything
// is written, so a refused message leaves no trace.
export function decodeImages(images) {
  if (images === undefined || images === null) return [];
  if (!Array.isArray(images)) throw new AttachmentError(400, 'images must be a list');
  if (images.length > MAX_IMAGES) throw new AttachmentError(400, `at most ${MAX_IMAGES} images per message`);
  return images.map((img, i) => {
    if (typeof img?.data !== 'string') throw new AttachmentError(400, 'image data missing');
    const buf = Buffer.from(img.data, 'base64');
    if (buf.length > MAX_IMAGE_BYTES) throw new AttachmentError(413, `image ${i + 1} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
    const kind = sniffImage(buf);
    if (!kind) throw new AttachmentError(400, `attachment ${i + 1} is not a PNG, JPEG, GIF or WebP image`);
    const label = String(img.name || 'image').replace(/\.[^.]*$/, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image';
    return { buf, kind, name: String(img.name || `image.${kind.ext}`).slice(0, 80), label };
  });
}

// Returns [{ file, name, path }]; `file` is the id the dashboard uses to fetch the image back.
export function storeImages(dir, sessionId, decoded) {
  if (!decoded.length) return [];
  const folder = join(dir, String(sessionId));
  mkdirSync(folder, { recursive: true });
  const stamp = Date.now().toString(36);
  return decoded.map((d, i) => {
    const base = `${stamp}-${i}-${d.label}.${d.kind.ext}`;
    writeFileSync(join(folder, base), d.buf, { mode: 0o600 });
    return { file: `${sessionId}/${base}`, name: d.name, path: join(folder, base) };
  });
}

// file: "<session id>/<name>" as returned by saveImages — nothing else resolves.
export function readAttachment(dir, file) {
  if (!/^\d+\/[\w-]+\.(png|jpg|gif|webp)$/.test(file)) throw new AttachmentError(400, 'bad attachment id');
  const root = resolve(dir);
  const path = resolve(root, file);
  if (!path.startsWith(root + sep)) throw new AttachmentError(400, 'bad attachment id');
  try {
    return { content: readFileSync(path), type: TYPES[file.split('.').pop()] };
  } catch {
    throw new AttachmentError(404, 'attachment not found');
  }
}
