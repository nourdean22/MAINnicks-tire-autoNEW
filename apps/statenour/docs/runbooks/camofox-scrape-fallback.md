# camofox scrape fallback (Railway setup)

**What it does.** When Firecrawl cannot serve a page (no key, out of credits, vendor error), `scrapeUrl` in
`lib/integrations/firecrawl.ts` asks a self-hosted camofox-browser service instead. It is read-only: the adapter
(`lib/integrations/camofox.ts`) can only create a tab with a URL, read its snapshot and close its tab group. The SSRF
gate runs before either provider. After a credits error, Firecrawl is skipped for 30 minutes per process.
**Off until `CAMOFOX_URL` and `CAMOFOX_API_KEY` are both set on statenour-web.** With either unset, nothing changes.

Nour does these steps; no agent touches Railway. About 20 minutes.

## 1 · Pin the source (supply chain: never track upstream main)

1. Fork `jo-inc/camofox-browser` to `nourdean22/camofox-browser`.
2. In the fork, create branch `pinned-39c8209` at commit `39c82094013480b373df6600d44c7f036f58356e` (v1.18.1, MIT).
3. Upgrading later means moving that branch on purpose after reading the diff. Nothing else moves it.

## 2 · Create the Railway service (same project as statenour-web)

1. New service, from GitHub repo `nourdean22/camofox-browser`, branch `pinned-39c8209`. The repo's `railway.toml`
   builds `Dockerfile.ci` and maps `PORT` to `CAMOFOX_PORT`.
2. Name it `camofox-browser`.
3. Variables on **camofox-browser**:
   - `PORT=9377`
   - `CAMOFOX_ACCESS_KEY=<generate: 32+ random chars>`. This is the key that gates the tab and snapshot routes.
     `CAMOFOX_API_KEY` on this service only gates cookie import and traces (read in `lib/auth.js` and `openapi.json`
     at 39c8209), so do not rely on it for this.
   - `CAMOFOX_CRASH_REPORT_ENABLED=false` (turns off its crash telemetry to GitHub).
   - `NODE_ENV=production`
4. **No public domain.** Do not click "Generate Domain". Private networking only.
5. Turn on App Sleeping (Serverless) if the plan offers it. The first scrape after a sleep may be slow; if it runs
   past the 30 s budget, the scrape fails and the caller skips that page (no fabricated content).

## 3 · Point statenour-web at it

Variables on **statenour-web**:

- `CAMOFOX_URL=http://camofox-browser.railway.internal:9377`
- `CAMOFOX_API_KEY=<the same value as CAMOFOX_ACCESS_KEY above>` (statenour sends it as `Authorization: Bearer`).

Redeploy statenour-web so it reads them.

## 4 · Verify (2 minutes)

1. In chat, ask Nick to read a plain public page, for example "read https://example.com".
2. The `scrapeWebPage` result carries `provider: "camofox"` while Firecrawl has no credits (`"firecrawl"` once they are back).
3. Railway logs for statenour-web: a `scrape_served_by_camofox` line per fallback scrape (it names the Firecrawl
   cause), and no `camofox_tab_close_failed` lines. A `guardian_call_failed` line naming
   `Scrape failed on both providers` means camofox also failed; its text names both causes.
4. If the call fails with a connection error, check the service is running and the port is 9377. On an older
   Railway environment, private networking is IPv6-only and the server must listen on `::` (NOT CHECKED for camofox).

## Rollback

Unset `CAMOFOX_URL` on statenour-web and redeploy. Behaviour returns to Firecrawl-only. The camofox service can then
be removed.

## Known limits

- **Private-network reach.** The browser runs inside the project's private network. A public page that redirects to
  an internal host is refused (the final URL is re-checked), but a page's own scripts could still request internal
  addresses while it renders, and their responses could appear in the snapshot. Keep internal services authenticated.
  Moving camofox to its own Railway project with a public domain plus `CAMOFOX_ACCESS_KEY` removes this reach, at the
  cost of an internet-facing endpoint; that is Nour's call.
- No page `<title>` comes back from camofox (`title: null`); the page text does.
- The breaker is in-process: each restart pays one more failed Firecrawl call (a 402 is not billed).
- Not used: camofox's cookie, login, act, click, type, upload, download and evaluate endpoints. Adding any of them is
  a separate decision (UPSTREAMS Camoufox row).
