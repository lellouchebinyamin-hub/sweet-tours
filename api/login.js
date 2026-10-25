import { send, readJson, fromAdminPage, configured, checkLogin, sessionCookie } from './_lib.js';

// Slow down guessing: a few tries per address per window, per server instance.
const tries = new Map();
const WINDOW = 10 * 60 * 1000, MAX = 8;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!fromAdminPage(req)) return send(res, 403, { error: 'forbidden' });
  if (!configured()) return send(res, 503, { error: 'not_configured' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const t = tries.get(ip);
  if (t && now - t.start < WINDOW && t.n >= MAX) return send(res, 429, { error: 'too_many' });

  let body;
  try { body = await readJson(req, 8 * 1024); } catch (e) { return send(res, e.status || 400, { error: e.message }); }

  if (!checkLogin(body.email, body.password)) {
    const cur = t && now - t.start < WINDOW ? t : { start: now, n: 0 };
    cur.n += 1;
    tries.set(ip, cur);
    await new Promise(r => setTimeout(r, 500));
    return send(res, 401, { error: 'wrong' });
  }
  tries.delete(ip);
  return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req) });
}
