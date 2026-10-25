// Shared helpers for the admin API: sessions, storage (Vercel Blob, or a local folder in dev), content validation.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const LOCAL_DIR = process.env.ST_LOCAL_STORE || '';
const WEEK = 7 * 24 * 3600;

/* ---------- HTTP ---------- */
export const send = (res, status, data, headers = {}) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!headers['Cache-Control']) res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
};

export const readBody = (req, limit) => new Promise((resolve, reject) => {
  if (req.readableEnded && req.body !== undefined) {
    const b = req.body;
    return resolve(Buffer.isBuffer(b) ? b : Buffer.from(typeof b === 'string' ? b : JSON.stringify(b)));
  }
  const chunks = [];
  let size = 0;
  req.on('data', c => {
    size += c.length;
    if (size > limit) { reject(Object.assign(new Error('too_large'), { status: 413 })); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

export const readJson = async (req, limit = 512 * 1024) => {
  const buf = await readBody(req, limit);
  try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { throw Object.assign(new Error('bad_json'), { status: 400 }); }
};

// Mutating calls must carry this header: a cross-site form cannot set it.
export const fromAdminPage = req => req.headers['x-st-admin'] === '1';

/* ---------- Sessions: a signed cookie, no database ---------- */
export const configured = () => Boolean(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD);

// Changing the password in Vercel signs everyone out, because the key depends on it.
const key = () => crypto.createHash('sha256')
  .update(['st-admin', process.env.SESSION_SECRET || '', process.env.ADMIN_EMAIL || '', process.env.ADMIN_PASSWORD || ''].join('|'))
  .digest();
const sign = v => crypto.createHmac('sha256', key()).update(v).digest('base64url');
const sameText = (a, b) => crypto.timingSafeEqual(
  crypto.createHash('sha256').update(String(a)).digest(),
  crypto.createHash('sha256').update(String(b)).digest()
);

export const checkLogin = (email, password) => {
  if (!configured()) return false;
  // Compare both, always, so the answer takes the same time whichever one is wrong.
  const emailOk = sameText(String(email || '').trim().toLowerCase(), process.env.ADMIN_EMAIL.trim().toLowerCase());
  const passOk = sameText(String(password || ''), process.env.ADMIN_PASSWORD);
  return emailOk && passOk;
};

const secureFlag = req => (req.headers['x-forwarded-proto'] === 'http' || LOCAL_DIR ? '' : '; Secure');

export const sessionCookie = req => {
  const exp = String(Math.floor(Date.now() / 1000) + WEEK);
  return 'st_admin=' + exp + '.' + sign(exp) + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + WEEK + secureFlag(req);
};
export const clearCookie = req => 'st_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' + secureFlag(req);

export const isAdmin = req => {
  if (!configured()) return false;
  const m = /(?:^|;\s*)st_admin=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || +exp < Date.now() / 1000) return false;
  const good = sign(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
};

/* ---------- Storage ---------- */
const blob = () => import('@vercel/blob');
export const storageReady = () => Boolean(LOCAL_DIR || process.env.BLOB_READ_WRITE_TOKEN);

export const putFile = async (pathname, body, contentType) => {
  if (LOCAL_DIR) {
    const file = path.join(LOCAL_DIR, pathname);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
    return { url: '/_store/' + pathname, pathname };
  }
  const { put } = await blob();
  const r = await put(pathname, body, { access: 'public', contentType, addRandomSuffix: false, allowOverwrite: true });
  return { url: r.url, pathname: r.pathname };
};

export const listFiles = async prefix => {
  if (LOCAL_DIR) {
    const dir = path.join(LOCAL_DIR, prefix);
    const names = await fs.readdir(dir).catch(() => []);
    return Promise.all(names.map(async n => {
      const st = await fs.stat(path.join(dir, n));
      return { url: '/_store/' + prefix + n, pathname: prefix + n, uploadedAt: st.mtime };
    }));
  }
  const { list } = await blob();
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    out.push(...r.blobs.map(b => ({ url: b.url, pathname: b.pathname, uploadedAt: new Date(b.uploadedAt) })));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
};

export const delFiles = async files => {
  if (!files.length) return;
  if (LOCAL_DIR) {
    await Promise.all(files.map(f => fs.rm(path.join(LOCAL_DIR, f.pathname), { force: true })));
    return;
  }
  const { del } = await blob();
  await del(files.map(f => f.url));
};

/* ---------- Content ---------- */
// One file, overwritten on each save. Visitors read it straight from the blob CDN (cheap reads, no listing),
// so a save can take up to a minute or two to reach everyone.
const LIVE = 'content/live.json';
const liveUrl = () => {
  const storeId = (process.env.BLOB_READ_WRITE_TOKEN || '').split('_')[3] || '';
  return 'https://' + storeId + '.public.blob.vercel-storage.com/' + LIVE;
};

export const readContent = async (fresh = false) => {
  if (!storageReady()) return null;
  if (LOCAL_DIR) {
    try { return JSON.parse(await fs.readFile(path.join(LOCAL_DIR, LIVE), 'utf8')); } catch { return null; }
  }
  const r = await fetch(liveUrl() + (fresh ? '?t=' + Date.now() : ''), { cache: 'no-store' });
  if (r.status === 404 || r.status === 403) return null;
  if (!r.ok) throw new Error('read_failed ' + r.status);
  return r.json();
};

export const writeContent = async content => {
  const body = JSON.stringify(content);
  if (LOCAL_DIR) return putFile(LIVE, body, 'application/json');
  const { put } = await blob();
  return put(LIVE, body, { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
};

const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const pair = (o, max) => ({ he: str(o && o.he, max), en: str(o && o.en, max) });
const okImage = u => typeof u === 'string' && u.length < 600 && (
  /^img\/[\w.-]+\.(jpe?g|png|webp)$/i.test(u) ||
  /^\/_store\/suites\/[\w.-]+$/.test(u) ||
  /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/suites\/[\w.-]+$/i.test(u)
);

export const cleanContent = input => {
  const list = Array.isArray(input && input.suites) ? input.suites.slice(0, 30) : null;
  if (!list) throw Object.assign(new Error('bad_content'), { status: 400 });
  const seen = new Set();
  const suites = list.map(s => {
    let id = str(s && s.id, 40).replace(/[^\w-]/g, '') || 's' + crypto.randomBytes(4).toString('hex');
    while (seen.has(id)) id += 'x';
    seen.add(id);
    const price = Math.round(Number(s.price));
    return {
      id,
      name: pair(s.name, 60),
      line: pair(s.line, 200),
      mood: pair(s.mood, 40),
      story: pair(s.story, 900),
      price: Number.isFinite(price) && price >= 0 && price <= 100000 ? price : 1200,
      images: (Array.isArray(s.images) ? s.images : []).filter(okImage).slice(0, 12),
      hidden: Boolean(s.hidden),
      promo: { on: Boolean(s.promo && s.promo.on), ...pair(s.promo, 60), until: /^\d{4}-\d{2}-\d{2}$/.test(s.promo && s.promo.until) ? s.promo.until : '' }
    };
  });
  return { suites };
};
