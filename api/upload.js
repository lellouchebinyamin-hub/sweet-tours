import crypto from 'node:crypto';
import { send, readBody, fromAdminPage, isAdmin, storageReady, putFile } from './_lib.js';

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const LIMIT = 4 * 1024 * 1024; // Vercel functions accept up to 4.5 MB; the admin shrinks photos before sending.

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!fromAdminPage(req)) return send(res, 403, { error: 'forbidden' });
  if (!isAdmin(req)) return send(res, 401, { error: 'login' });
  if (!storageReady()) return send(res, 503, { error: 'no_storage' });

  const type = String(req.headers['content-type'] || '').split(';')[0].trim();
  const ext = TYPES[type];
  if (!ext) return send(res, 415, { error: 'type' });
  try {
    const buf = await readBody(req, LIMIT);
    if (buf.length < 100) return send(res, 400, { error: 'empty' });
    const name = 'suites/' + Date.now() + '-' + crypto.randomBytes(5).toString('hex') + '.' + ext;
    const r = await putFile(name, buf, type);
    return send(res, 200, { url: r.url });
  } catch (e) {
    console.error('upload', e);
    return send(res, e.status || 500, { error: e.message || 'upload_failed' });
  }
}
