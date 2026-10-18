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

**Deployed 2026-10-18.** On Nour's go, the manager session deployed both services with the Railway CLI, from clean
local exports. There is no fork, no public repo and no Railway GitHub grant. Railway project `camofox`
(`874af65a-f4f3-475a-8e5b-ecee0b50c750`), environment `production` (`f78ce6c7-813b-4ee2-8217-be1fd624237a`):

- `egress-proxy` (`93d3e175-7283-4049-86f4-de9ab10252d2`): no domain, listens on 4750.
- `camofox-browser` (`8074a5d4-ccd5-4980-b198-d856f57da2f3`): public domain
  `https://camofox-browser-production-fdc5.up.railway.app`, target port 9377.
- On statenour-web, `CAMOFOX_URL`, `CAMOFOX_API_KEY` and `CAMOFOX_EGRESS_PROXY=attested` were set at 19:41Z.

The ids are not secrets. No key or other variable value is written in this repo. The steps below are how to REBUILD
it. They differ from the first draft of this runbook, which assumed a fork and GitHub sources.

## 1 · Pin the source (supply chain: never track upstream main)

1. **Camofox, the method used and tested:** download the GitHub tarball of `jo-inc/camofox-browser` at commit
   `39c82094013480b373df6600d44c7f036f58356e` (v1.18.1, MIT) and extract it into an empty directory with
   `tar --strip-components=1` (its top directory is `jo-inc-camofox-browser-39c8209`). That directory is the upload.
2. **Proxy:** export it from this repo with `git archive origin/main apps/statenour/ops/egress-proxy`.
   `apps/statenour/ops/egress-proxy/Dockerfile` pins Smokescreen v0.1.0 (commit
   `609eb8931420453daf5893509be0b25b21bd9edb`) and both base images by digest. It has no `COPY` from the build
   context, so the upload only has to hold that Dockerfile.
3. **Alternative, NOT used:** fork `jo-inc/camofox-browser` to `nourdean22/camofox-browser`, create branch
   `pinned-39c8209` at the same commit and deploy from GitHub. Nobody has run this path.
4. Upgrading either one means changing the pin on purpose after reading the diff. Nothing else moves them.

## 2 · Create the project and its two services

1. New Railway project, for example `camofox`. Its private network is separate from statenour's.
2. **Service `egress-proxy`:**
   - Deploy the proxy export from step 1 with `railway up`, run inside the export directory.
   - **No public domain.** Private networking only. It listens on port 4750 on every interface (INFERRED
     from Go's empty-address default; camofox reached it over IPv4 on 2026-10-18 and IPv6 was never observed).
     The Dockerfile passes no `--listen-ip` on purpose: `--listen-ip=::` crash-loops Smokescreen v0.1.0, which builds
     the address as ":::4750" (`tests/integrations/egress-proxy-dockerfile.test.ts` pins this).
   - No variables needed. Smokescreen has no password auth (clients identify by mTLS only), so placement is the
     access control: only services in this project can reach it.
3. **Service `camofox-browser`:**
   - Deploy the camofox export from step 1 with `railway up`, run inside the export directory. An absolute `PATH`
     argument outside the current directory fails with "prefix not found". Its `railway.toml` maps `PORT` to
     `CAMOFOX_PORT`.
   - Three gotchas of a CLI upload (all hit on 2026-10-18):
     1. Railway ignores `dockerfilePath` in `railway.toml` for a CLI upload and builds `Dockerfile`. Set the service
        variable `RAILWAY_DOCKERFILE_PATH=Dockerfile.ci`.
     2. An upload from Windows drops file exec bits. The default `Dockerfile` then dies on
        `RUN /tmp/install-plugin-deps.sh` (exit 126). `Dockerfile.ci` runs `sh scripts/install-plugin-deps.sh`, which
        needs no exec bit.
     3. The same lost bit makes that install script skip plugin post-install hooks. The only hook is
        `plugins/youtube/post-install.sh`, and statenour does not use the YouTube plugin.
   - Variables:
     - `CAMOFOX_ACCESS_KEY=<generate: 32+ random chars>`. It gates every route except `/health`, as long as
       `CAMOFOX_API_KEY` and `CAMOFOX_ADMIN_KEY` stay UNSET on this service (per `lib/auth.js` at 39c8209).
     - `PROXY_HOST=egress-proxy.railway.internal`
     - `PROXY_PORT=4750`
     - Leave `PROXY_USERNAME` / `PROXY_PASSWORD` unset (Smokescreen does not check them). `PROXY_PROTOCOL` defaults to
       `http` (`lib/config.js:84-85`), which is right: https pages go through CONNECT, plain http through the same filter.
     - `CAMOFOX_CRASH_REPORT_ENABLED=false`
     - `NODE_ENV=production`
     - `PORT=9377`
     - `RAILWAY_DOCKERFILE_PATH=Dockerfile.ci`
   - Settings, Networking: **Generate Domain** (a public `*.up.railway.app` domain, served over https, target
     port 9377).

## 3 · Point statenour-web at it

Variables on **statenour-web** (statenour project), set only after step 4 passes:

- `CAMOFOX_URL=https://<the camofox-browser domain>`
- `CAMOFOX_API_KEY=<the same value as CAMOFOX_ACCESS_KEY>` (sent as `Authorization: Bearer`).
- `CAMOFOX_EGRESS_PROXY=attested`

Redeploy statenour-web so it reads them.

## 4 · Verify the proxy from outside the app (before step 3)

Run these with curl and the key, `K=<CAMOFOX_ACCESS_KEY>`, `D=https://<domain>`. Each test opens one tab; close it after.

1. **The key is required:** `curl -s -o /dev/null -w "%{http_code}\n" $D/tabs` gives 401 with no key and 401 with a
   wrong key (not 403), and 200 with the key. `curl $D/health` answers 200 without a key. On 2026-10-18 `/`,
   `/docs`, `/openapi.json`, `/metrics`, `/version`, `/sessions` and `/cookies` also gave 401 without a key.
2. **A private target is refused by the proxy:** pick a hostname whose DNS answers a private address (for example a
   name you control pointed at `10.0.0.1`, or a public `*.nip.io` style name for `127.0.0.1`), then
   `curl -s -H "Authorization: Bearer $K" -H "content-type: application/json" -d '{"userId":"verify","sessionKey":"v1","url":"http://<that-name>/"}' $D/tabs`.
   Expected: `navigationOk:false` with `httpStatus` 407 (the proxy's deny code), and the egress-proxy logs show the
   rule in `decision_reason`. A page that loads means the proxy is NOT in the path: stop and do not set the
   attestation. Probe classes run on 2026-10-18, with what the proxy log said:
   - `127.0.0.1.nip.io`: "Deny: Not Global Unicast".
   - `169.254.169.254`, as a name and as a literal: "Deny: Not Global Unicast".
   - `10.0.0.1.nip.io`: "Deny: Private Range".
   - `egress-proxy.railway.internal:4750`: "Deny: Self Connection".
   - An IPv4-mapped IPv6 literal: error `invalid domain "[::ffff:7f00:1]": disallowed rune U+005B`, status 407.
   - A public httpbin.org page that answers 302 to `http://169.254.169.254/`: the CONNECT to httpbin.org was
     allowed and the redirect target was denied ("Deny: Not Global Unicast").
   - `http://[::1]/`, `http://2130706433/` and `http://0x7f000001/` never reached the proxy. camofox answered
     "Internal server error" and opened no tab: Firefox does not proxy loopback, and nothing listens on port 80 in
     the container.
3. **A public page works:** the same call with `"url":"https://example.com/"`, then
   `curl -s -H "Authorization: Bearer $K" "$D/tabs/<tabId>/snapshot?userId=verify"`. Expected: `navigationOk:true`,
   HTTP 200, and snapshot text that starts `paragraph: This domain is for use in documentation examples without
   needing permission...`. The page text has changed before ("Example Domain" is no longer in it), so match the
   proxy log first. It must show `CANONICAL-PROXY-DECISION` with `allow=true`, `proxy_type` connect,
   `requested_host` `example.com:443` and the reason "Egress ACL is not configured".
4. Close the test tabs: `curl -s -X DELETE -H "Authorization: Bearer $K" "$D/tabs/group/v1?userId=verify"`.
   `GET $D/tabs?userId=verify` should then list 0 tabs.
5. The real adapter was run against the live service on 2026-10-18 (`lib/integrations/camofox.ts`, only the logger
   and the SSRF gate stubbed). `scrapeWithCamofox("https://example.com/")` returned provider `camofox`, 1047
   characters, in 854 ms. `http://10.0.0.1.nip.io/` threw "camofox navigation returned HTTP 407". Both user ids it
   used listed 0 tabs afterwards, so the close in its `finally` works against the real server.
6. After step 3: ask Nick to "read https://example.com". While Firecrawl has no credits the `scrapeWebPage` result
   carries `provider: "camofox"`, and statenour-web logs show `scrape_served_by_camofox`. Asking it to read the
   private-resolving name from step 2 must fail. Not yet observed through Nick: the 2026-10-18 proof above used
   the adapter directly.

## Rollback

Remove `CAMOFOX_EGRESS_PROXY` (or `CAMOFOX_URL`) on statenour-web and redeploy. Behaviour returns to Firecrawl-only.
The camofox project (`874af65a-f4f3-475a-8e5b-ecee0b50c750`) can then be deleted.

## Residual risk (what the proxy does not settle)

- **FACT, observed 2026-10-18:** both images build on Railway (the proxy by digest, and its commit check passes);
  the camofox container reaches the proxy over the project's private network, over IPv4 in a project created that day
  (the proxy log shows an inbound 10.x address); and the proxy refused every private-target class listed in step 4,
  each with the rule named in its log.
- **The proxy is only as good as Smokescreen's own resolution and address checks.** It resolves every name and
  classifies the address at dial time (smokescreen.go:302-331 and the dial path, v0.1.0). A bug there is a bug here.
  The probe classes in step 4 were all refused. A class nobody probed is NOT CHECKED.
- **camofox's own loopback, measured.** The browser does reach its own loopback: `http://127.0.0.1:9377/health` loaded
  with HTTP 200 and snapshot text "ok", so the proxy is bypassed for loopback. Every other route needs
  `CAMOFOX_ACCESS_KEY`, which the page does not have (step 4 item 1), so the exposure is `/health` only.
- **Cloud metadata.** `169.254.169.254` is denied by the proxy, as a name and as a literal. Whether Railway exposes
  any metadata service, and on which address, is NOT CHECKED.
- No page `<title>` comes back from camofox (`title: null`); the page text does. `includeTags` / `excludeTags`
  cannot be applied and are reported in `ignoredOptions`.
- The credit breaker is in-process: each restart pays one more failed Firecrawl call (a 402 is not billed).
- Not used: camofox's cookie, login, act, click, type, upload, download and evaluate endpoints. Adding any of them is
  a separate decision (UPSTREAMS Camoufox row).
