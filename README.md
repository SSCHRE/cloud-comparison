# Cloud Comparrison

The site is static and hosted on GitHub Pages. The "Report wrong info" form and the `/admin` page talk to a
small Cloudflare Worker (`worker/index.js`, free tier) that stores reports and checks the admin password.

## Run locally

- Site: `python -m http.server 8765`, then open http://localhost:8765
- Report API: `npx wrangler dev --port 8787` with a `.dev.vars` file containing `ADMIN_PASSWORD=something`
  (a throwaway password, never your real one), and temporarily set `meta.apiBase` in `data/providers.json`
  to `http://127.0.0.1:8787`.

## Set up the report API (one time)

1. `npx wrangler login`
2. `npx wrangler kv namespace create REPORTS` and paste the printed `id` into `wrangler.toml`
3. `npx wrangler secret put ADMIN_PASSWORD` and type your admin password
4. `npx wrangler deploy` (it prints a URL like `https://cloud-comparison-api.<you>.workers.dev`)
5. Put that URL in `data/providers.json` as `meta.apiBase`, commit and push

Run `npx wrangler deploy` again only when `worker/index.js` changes. The site itself keeps deploying through
GitHub Pages as usual.

Reports show up at `https://sschre.github.io/cloud-comparison/admin/`.
If the site moves to another address, add it to `ALLOWED_ORIGINS` in `wrangler.toml` and redeploy.
