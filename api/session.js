import { send, configured, accountNames, isAdmin, storageReady } from './_lib.js';

export default function handler(req, res) {
  return send(res, 200, { configured: configured(), accounts: accountNames(), storage: storageReady(), admin: isAdmin(req) });
}
