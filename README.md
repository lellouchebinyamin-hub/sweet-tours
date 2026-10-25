# Sweet tours

Website for Sweet tours, six sea-view suites in Netanya (Hebrew + English), with a small admin at `/admin`.

- `index.html`: the whole public site (HTML, CSS and JS in one file)
- `img/`: built-in suite and section images
- `admin/index.html`: the admin (login, suites, photos, promotions)
- `api/`: Vercel functions for the admin
  - `login`, `logout`, `session`: sign-in with a signed, HttpOnly cookie
  - `content`: GET the suites (public), PUT to save them (admin)
  - `upload`: add a photo (admin); photos are resized in the browser first
- `api/_default.js`: the suites as first built, shown until the first save

## Vercel setup

1. Storage → create a **Blob** store (public access) and connect it to this project. This adds `BLOB_READ_WRITE_TOKEN`.
2. Settings → Environment Variables: set `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Optional: `SESSION_SECRET` (any long random string).
3. Redeploy so the new variables apply.

Saved content lives in the blob store at `content/live.json`; uploaded photos under `suites/`.
Photos that no suite uses any more are removed on the next save after a day.
Changing `ADMIN_PASSWORD` signs out every open admin session.
