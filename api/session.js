import { send, configured, accountNames, isAdmin, storageReady } from './_lib.js';

export default function handler(req, res) {
  return send(res, 200, { configured: configured(), accounts: accountNames(), storage: storageReady(), admin: isAdmin(req), version: (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7) });
}
