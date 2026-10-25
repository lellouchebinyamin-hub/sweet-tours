import { send, configured, isAdmin, storageReady } from './_lib.js';

export default function handler(req, res) {
  return send(res, 200, { configured: configured(), storage: storageReady(), admin: isAdmin(req) });
}
