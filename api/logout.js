import { send, fromAdminPage, clearCookie } from './_lib.js';

export default function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!fromAdminPage(req)) return send(res, 403, { error: 'forbidden' });
  return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req) });
}
