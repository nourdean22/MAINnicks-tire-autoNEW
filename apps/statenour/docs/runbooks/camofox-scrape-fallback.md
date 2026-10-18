# camofox scrape fallback (Railway setup)

**What it does.** When Firecrawl cannot serve a page (no key, out of credits, vendor error), `scrapeUrl` in
`lib/integrations/firecrawl.ts` asks a self-hosted camofox-browser service instead. It is read-only: the adapter
(`lib/integrations/camofox.ts`) can only create a tab with a URL, read its snapshot and close its tab group. The SSRF
gate runs before either provider. After a credits error, Firecrawl is skipped for 30 minutes per process.

**Off until three variables are set on statenour-web:** `CAMOFOX_URL`, `CAMOFOX_API_KEY` and
`CAMOFOX_EGRESS_PROXY=attested`. The third is your statement that the egress proxy below is in place. It is an
attestation, not proof: statenour cannot see the camofox network. With any of the three missing, nothing changes, and
a `camofox_not_attested` warning is logged once per process when the URL and key are set without it.
`CAMOFOX_URL` must be `https://` unless its host is `*.railway.internal` or localhost.

**One supported topology.** A NEW Railway project with two services: `egress-proxy` (Stripe's Smokescreen, private
only) and `camofox-browser` (public https domain, every browser request sent through the proxy). The proxy resolves
each hostname itself and refuses private, loopback, link-local and CGNAT addresses, which is what stops a page from
being steered at internal hosts by DNS rebinding. **Extra cost:** one more small always-on Railway service.

Nour does these steps; no agent touches Railway. About 30 minutes.

## 1 · Pin the source (supply chain: never track upstream main)

1. Fork `jo-inc/camofox-browser` to `nourdean22/camofox-browser`.
2. In the fork, create branch `pinned-39c8209` at commit `39c82094013480b373df6600d44c7f036f58356e` (v1.18.1, MIT).
3. The proxy is built from this repo: `apps/statenour/ops/egress-proxy/Dockerfile` pins Smokescreen v0.1.0 (commit
   `609eb8931420453daf5893509be0b25b21bd9edb`) and both base images by digest.
4. Upgrading either one means changing the pin on purpose after reading the diff. Nothing else moves them.

## 2 · Create the project and its two services

1. New Railway project, for example `camofox`. Its private network is separate from statenour's.
2. **Service `egress-proxy`:**
   - From GitHub repo `nourdean22/MAINnicks-tire-autoNEW`, branch `main`, Root Directory
     `apps/statenour/ops/egress-proxy` (Railway builds the `Dockerfile` there).
   - **No public domain.** Private networking only. It listens on port 4750 on `::`.
   - No variables needed. Smokescreen has no password auth (clients identify by mTLS only), so placement is the
     access control: only services in this project can reach it.
3. **Service `camofox-browser`:**
   - From GitHub repo `nourdean22/camofox-browser`, branch `pinned-39c8209`. Its `railway.toml` builds
     `Dockerfile.ci` and maps `PORT` to `CAMOFOX_PORT`.
   - Variables:
     - `CAMOFOX_ACCESS_KEY=<generate: 32+ random chars>`. It gates every route except `/health`, as long as
       `CAMOFOX_API_KEY` and `CAMOFOX_ADMIN_KEY` stay UNSET on this service (per `lib/auth.js` at 39c8209).
     - `PROXY_HOST=egress-proxy.railway.internal`
     - `PROXY_PORT=4750`
     - Leave `PROXY_USERNAME` / `PROXY_PASSWORD` unset (Smokescreen does not check them). `PROXY_PROTOCOL` defaults to
       `http` (`lib/config.js:84-85`), which is right: https pages go through CONNECT, plain http through the same filter.
     - `CAMOFOX_CRASH_REPORT_ENABLED=false`
     - `NODE_ENV=production`
   - Settings, Networking: **Generate Domain** (a public `*.up.railway.app` domain, served over https).
4. If the project was created on an older Railway environment, private networking is IPv6-only; the proxy already
   listens on `::`.

## 3 · Point statenour-web at it

Variables on **statenour-web** (statenour project), set only after step 4 passes:

- `CAMOFOX_URL=https://<the camofox-browser domain>`
- `CAMOFOX_API_KEY=<the same value as CAMOFOX_ACCESS_KEY>` (sent as `Authorization: Bearer`).
- `CAMOFOX_EGRESS_PROXY=attested`

Redeploy statenour-web so it reads them.

## 4 · Verify the proxy from outside the app (before step 3)

Run these with curl and the key, `K=<CAMOFOX_ACCESS_KEY>`, `D=https://<domain>`. Each test opens one tab; close it after.

1. **The key is required:** `curl -s -o /dev/null -w "%{http_code}\n" $D/tabs` gives 403, and `curl $D/health` answers.
2. **A private target is refused by the proxy:** pick a hostname whose DNS answers a private address (for example a
   name you control pointed at `10.0.0.1`, or a public `*.nip.io` style name for `127.0.0.1`), then
   `curl -s -H "Authorization: Bearer $K" -H "content-type: application/json" -d '{"userId":"verify","sessionKey":"v1","url":"http://<that-name>/"}' $D/tabs`.
   Expected: navigation fails (an error, or `navigationOk:false`), and the egress-proxy logs show a denial for that
   address. A page that loads means the proxy is NOT in the path: stop and do not set the attestation.
3. **A public page works:** the same call with `"url":"https://example.com/"`, then
   `curl -s -H "Authorization: Bearer $K" "$D/tabs/<tabId>/snapshot?userId=verify"`. Expected: text containing
   "Example Domain", and an allowed CONNECT in the egress-proxy logs.
4. Close the test tabs: `curl -s -X DELETE -H "Authorization: Bearer $K" "$D/tabs/group/v1?userId=verify"`.
5. After step 3: ask Nick to "read https://example.com". While Firecrawl has no credits the `scrapeWebPage` result
   carries `provider: "camofox"`, and statenour-web logs show `scrape_served_by_camofox`. Asking it to read the
   private-resolving name from step 2 must fail.

## Rollback

Remove `CAMOFOX_EGRESS_PROXY` (or `CAMOFOX_URL`) on statenour-web and redeploy. Behaviour returns to Firecrawl-only.
The camofox project can then be deleted.

## Residual risk (what the proxy does not settle)

- **The proxy is only as good as Smokescreen's own resolution and address checks.** It resolves every name and
  classifies the address at dial time (smokescreen.go:302-331 and the dial path, v0.1.0). A bug there is a bug here.
  NOT CHECKED live (no Docker on the authoring machine; step 4 is the first live test).
- **camofox's own loopback.** CLAIM (Firefox default, not verified for Camoufox): the browser does not send
  `localhost` / `127.0.0.1` through a proxy, so a page could still reach the camofox container's own port. Every route
  there except `/health` needs `CAMOFOX_ACCESS_KEY`, which the page does not have. NOT CHECKED.
- **Cloud metadata.** Link-local `169.254.0.0/16` is denied by the proxy, but whether Railway exposes any metadata
  service, and on which address, is NOT CHECKED.
- No page `<title>` comes back from camofox (`title: null`); the page text does. `includeTags` / `excludeTags`
  cannot be applied and are reported in `ignoredOptions`.
- The credit breaker is in-process: each restart pays one more failed Firecrawl call (a 402 is not billed).
- Not used: camofox's cookie, login, act, click, type, upload, download and evaluate endpoints. Adding any of them is
  a separate decision (UPSTREAMS Camoufox row).
