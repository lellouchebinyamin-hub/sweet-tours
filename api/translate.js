import { send, readJson, fromAdminPage, isAdmin } from './_lib.js';

// Hebrew to English for the editor, so the English side follows the Hebrew one.
// Google's public endpoint first, MyMemory as a fallback; neither needs a key.
const google = async text => {
  const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=iw&tl=en&dt=t&q=' + encodeURIComponent(text));
  if (!r.ok) throw new Error('google ' + r.status);
  const d = await r.json();
  return (d[0] || []).map(p => p[0] || '').join('');
};
const myMemory = async text => {
  const r = await fetch('https://api.mymemory.translated.net/get?langpair=he|en&q=' + encodeURIComponent(text));
  if (!r.ok) throw new Error('mymemory ' + r.status);
  const d = await r.json();
  return String((d.responseData && d.responseData.translatedText) || '');
};
const translate = async text => {
  if (!text.trim()) return '';
  for (let i = 0; i < 2; i++) {
    try { return await google(text); } catch (e) { console.error(e.message); await new Promise(r => setTimeout(r, 400)); }
  }
  return myMemory(text);
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method' });
  if (!fromAdminPage(req)) return send(res, 403, { error: 'forbidden' });
  if (!isAdmin(req)) return send(res, 401, { error: 'login' });
  let body;
  try { body = await readJson(req, 16 * 1024); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
  const texts = (Array.isArray(body.texts) ? body.texts : []).slice(0, 10).map(t => String(t || '').slice(0, 900));
  try {
    return send(res, 200, { texts: await Promise.all(texts.map(translate)) });
  } catch (e) {
    console.error('translate', e);
    return send(res, 502, { error: 'translate_failed' });
  }
}
