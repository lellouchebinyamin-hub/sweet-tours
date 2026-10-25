import { send, readJson, fromAdminPage, isAdmin, storageReady, readContent, writeContent, cleanContent, listFiles, delFiles } from './_lib.js';
import { DEFAULT_CONTENT } from './_default.js';

const DAY = 24 * 3600 * 1000;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const admin = Boolean(req.query && req.query.admin !== undefined);
    let cur = null;
    try { cur = await readContent(admin); } catch (e) { console.error('content read', e); }
    return send(res, 200, {
      suites: cur ? cur.suites : DEFAULT_CONTENT.suites,
      updatedAt: cur ? cur.updatedAt : null
    }, { 'Cache-Control': admin ? 'no-store' : 'public, max-age=0, s-maxage=30, stale-while-revalidate=600' });
  }

  if (req.method !== 'PUT') return send(res, 405, { error: 'method' });
  if (!fromAdminPage(req)) return send(res, 403, { error: 'forbidden' });
  if (!isAdmin(req)) return send(res, 401, { error: 'login' });
  if (!storageReady()) return send(res, 503, { error: 'no_storage' });

  try {
    const content = { ...cleanContent(await readJson(req)), updatedAt: new Date().toISOString() };
    await writeContent(content);

    // Drop photos nothing uses any more, with a day's grace so fresh uploads in an unsaved edit survive.
    try {
      const used = new Set(content.suites.flatMap(s => s.images));
      const photos = await listFiles('suites/');
      await delFiles(photos.filter(p => !used.has(p.url) && Date.now() - p.uploadedAt.getTime() > DAY));
    } catch (e) { console.error('cleanup', e); }

    return send(res, 200, { ok: true, ...content });
  } catch (e) {
    console.error('content save', e);
    return send(res, e.status || 500, { error: e.message || 'save_failed' });
  }
}
