# camofox scrape fallback (Railway setup)

**What it does.** When Firecrawl cannot serve a page (no key, out of credits, vendor error), `scrapeUrl` in
`lib/integrations/firecrawl.ts` asks a self-hosted camofox-browser service instead. It is read-only: the adapter
(`lib/integrations/camofox.ts`) can only create a tab with a URL, read its snapshot and close its tab group. The SSRF
gate runs before either provider. After a credits error, Firecrawl is skipped for 30 minutes per process.
**Off until `CAMOFOX_URL` and `CAMOFOX_API_KEY` are both set on statenour-web.** With either unset, nothing changes.
`CAMOFOX_URL` must be `https://` unless its host is `*.railway.internal` or localhost (the adapter refuses otherwise,
so the key never crosses the internet in clear text).

Nour does these steps; no agent touches Railway. About 20 minutes.

## 1 · Pin the source (supply chain: never track upstream main)

1. Fork `jo-inc/camofox-browser` to `nourdean22/camofox-browser`.
2. In the fork, create branch `pinned-39c8209` at commit `39c82094013480b373df6600d44c7f036f58356e` (v1.18.1, MIT).
3. Upgrading later means moving that branch on purpose after reading the diff. Nothing else moves it.

## 2 · Create the service in its OWN Railway project (default)

Why its own project: each Railway project is a separate private network. A page the browser renders runs its own
scripts, and in a separate project those scripts cannot reach statenour-web, the worker or any other internal service.

1. New Railway project, for example `camofox`. In it, a new service from GitHub repo `nourdean22/camofox-browser`,
   branch `pinned-39c8209`. The repo's `railway.toml` builds `Dockerfile.ci` and maps `PORT` to `CAMOFOX_PORT`.
2. Name the service `camofox-browser`.
3. Variables on **camofox-browser**:
   - `CAMOFOX_ACCESS_KEY=<generate: 32+ random chars>`. This key gates every route. Per `lib/auth.js` at 39c8209 the
     only routes served without it are `/health`, cookie import (only when `CAMOFOX_API_KEY` is set) and `/stop`
     (only when `CAMOFOX_ADMIN_KEY` is set). Leave `CAMOFOX_API_KEY` and `CAMOFOX_ADMIN_KEY` UNSET on this service,
     so `/health` is the only open route.
   - `CAMOFOX_CRASH_REPORT_ENABLED=false` (turns off its crash telemetry to GitHub).
   - `NODE_ENV=production`
4. Settings, Networking: **Generate Domain** (a public `*.up.railway.app` domain, served over https). Without the key
   it answers nothing but `/health`.
5. Turn on App Sleeping (Serverless) if the plan offers it. The first scrape after a sleep may be slow; if it runs
   past the 30 s budget, the scrape fails and the caller skips that page (no fabricated content).

## 3 · Point statenour-web at it

Variables on **statenour-web** (statenour project):

- `CAMOFOX_URL=https://<the camofox-browser domain from step 2.4>`
- `CAMOFOX_API_KEY=<the same value as CAMOFOX_ACCESS_KEY above>` (statenour sends it as `Authorization: Bearer`).

Redeploy statenour-web so it reads them.

## Alternative, weaker isolation: same project, private network

Use this only if a public domain is not wanted. Create the service inside the statenour project instead of step 2.1,
set `PORT=9377` plus the step 2.3 variables, and do NOT generate a domain. Then on statenour-web:
`CAMOFOX_URL=http://camofox-browser.railway.internal:9377` (plain http is allowed only for `*.railway.internal`).
On an older Railway environment, private networking is IPv6-only and the server must listen on `::` (NOT CHECKED for
camofox). The private-network limit below applies to this variant.

## 4 · Verify (2 minutes)

1. In chat, ask Nick to read a plain public page, for example "read https://example.com".
2. The `scrapeWebPage` result carries `provider: "camofox"` while Firecrawl has no credits (`"firecrawl"` once they are back).
3. Railway logs for statenour-web: a `scrape_served_by_camofox` line per fallback scrape (it names the Firecrawl
   cause), and no `camofox_tab_close_failed` lines. A `guardian_call_failed` line naming
   `Scrape failed on both providers` means camofox also failed; its text names both causes.
4. Default variant: `curl https://<domain>/tabs` without the key must be refused, and `/health` answers.

## Rollback

Unset `CAMOFOX_URL` on statenour-web and redeploy. Behaviour returns to Firecrawl-only. The camofox project can then
be removed.

## Known limits

- **Alternative variant only: private-network reach.** In the same project, the browser sits on statenour's private
  network. A public page that redirects to an internal host is refused (the final URL is re-checked), but a page's own
  scripts could still request internal addresses while it renders, and their responses could appear in the snapshot.
  The default (own project) variant does not have this reach.
- **Default variant: an internet-facing endpoint.** Its safety rests on `CAMOFOX_ACCESS_KEY`; rotate it on both
  services together if it leaks.
- No page `<title>` comes back from camofox (`title: null`); the page text does.
- The breaker is in-process: each restart pays one more failed Firecrawl call (a 402 is not billed).
- Not used: camofox's cookie, login, act, click, type, upload, download and evaluate endpoints. Adding any of them is
  a separate decision (UPSTREAMS Camoufox row).
