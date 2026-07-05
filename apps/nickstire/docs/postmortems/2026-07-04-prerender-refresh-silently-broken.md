# Postmortem · 2026-07-04 · Weekly Prerender Refresh Silently Broken for 2 Weeks

**Severity:** SEV-3 (no customer-visible outage; crawl surface served to Googlebot drifted stale ~2 weeks — SEO-latent, not user-facing)
**Author:** Claude (GSC-audit session) · written 2026-07-04
**Reviewed by:** operator (pending)
**Related PRs:** `#514` (crawl hygiene) · `#518` (workflow env boot gate) · `#519` (workflow workspace-deps — the real fix)
**Related runs:** prerender-refresh `#21`, `#22` (scheduled, failed) · `#23`, `#24`, `#25` (dispatched, failed) · `#26` (SUCCESS)
**Companion doc:** [`2026-05-24-prerender-to-all-users.md`](./2026-05-24-prerender-to-all-users.md) — same workflow, different failure. That postmortem leaned on "regen runs weekly" as a safety cadence; this one is about that weekly job itself being dead.

---

## Summary

`prerender-refresh.yml` (regenerates the committed `prerendered/*.html` that nickstire serves to crawlers, Mondays 08:00 UTC) had been failing on **every run since 2026-06-22** — runs #21 and #22 (scheduled) plus #23–#25 (manually dispatched during this session) all died at ~1m35s. Because Railway deploys don't regenerate prerender (`PRERENDER_ON_BUILD` is off for fast deploys) and the only refresh path was this broken weekly job, the HTML Googlebot received drifted ~2 weeks stale: the `/tires` conversion overhaul and `/diagnose` hero shipped to source but never reached the prerendered tree crawlers read. Discovered during a GSC audit when live `/tires` HTML lacked the merged "PUMP WATER" hero. Two independent bugs were fixed in sequence; run #26 succeeded and the bot committed fresh HTML now live in prod.

---

## Timeline (all times ET)

| Time | Event |
|---|---|
| ~2026-06-19 | Last SUCCESSFUL run (#20, manual, 15m38s). Prerender tree current as of here. |
| ~2026-06-22 | GBP-publisher integration (`#299`) had earlier added `@nour/gbp-publisher` as a server import. First scheduled run after the drift, #21, fails at ~1m33s. Nobody watching scheduled-run status. |
| 2026-06-29 | Run #22 (scheduled) fails ~1m33s. Still unnoticed — scheduled failures send no alert. |
| 2026-07-04 ~08:15 | GSC audit finds live `/tires` prerender missing the merged PAS hero. Root-caused to stale prerender + broken refresh job. |
| ~08:20 | Dispatched run #23 (via operator's browser, permission-gated) — fails ~1m38s. Logs show only `[regen] Server failed to start` (the underlying server log was never surfaced in CI). |
| ~08:30 | Fix #518 shipped: `server/_core/index.ts` REQUIRED_ENV hard-exits without OWNER_OPEN_ID/ADMIN_API_KEY/STATENOUR_SYNC_KEY and enforces ≥32-char keys; the workflow passed only DATABASE_URL + a 31-char JWT dummy. Added ≥32-char boot dummies + an `if: failure()` step that `cat`s `tmp/regen-server.log`. |
| ~08:45 | Run #24, then #25 — still fail ~1m36s. But #25's new failure-log step finally printed the real error: `ERR_MODULE_NOT_FOUND: @nour/gbp-publisher/dist/index.js`. |
| ~09:00 | Fix #519 shipped: `turbo run build --filter "nicks-tire-auto^..."` before regen, so workspace runtime deps have `dist/`. Turbo filter scope dry-run-verified = exactly `@nour/gbp-publisher` + `@nour/utils`. |
| ~09:15 | Run #26 dispatched — runs past the ~1m37s death zone, completes SUCCESS in ~15 min. Bot commits `chore: weekly prerender refresh [skip ci]` to main. |
| ~09:35 | Live-verified: `nickstire.org/tires` (curl as Googlebot) serves the PAS hero + `87 feet` + `$0 add-on`. Chain closed. |

---

## Root cause · 5 whys

**Why did Googlebot see 2-week-stale `/tires` HTML?**
Because the committed `prerendered/` tree — what crawlers are served — hadn't been regenerated since ~June 19, so the merged conversion copy never reached it.

**Why wasn't it regenerated?**
Because the only refresh path, `prerender-refresh.yml`, failed on every run since June 22. Railway deploys don't regenerate prerender (`PRERENDER_ON_BUILD` off for speed), so a broken weekly job = zero refresh.

**Why did every run fail?**
Two independent boot failures, in order: **(1)** the regen boots the prod server, which imports `@nour/gbp-publisher` + `@nour/utils` as externals resolved via node_modules symlinks — but CI never built those workspace packages' `dist/`, so the server threw `ERR_MODULE_NOT_FOUND` at import. **(2)** Even once imports resolve, `server/_core/index.ts` REQUIRED_ENV hard-exits without OWNER_OPEN_ID/ADMIN_API_KEY/STATENOUR_SYNC_KEY and rejects the 31-char JWT dummy (min 32). Bug (1) fires first and was the active killer; bug (2) was latent behind it.

**Why did bug (1) appear only recently?**
The `@nour/gbp-publisher` server import landed with the GBP-publisher integration (`#299`, ~mid-June). The regen script builds only the app, not its workspace deps — fine locally where `dist/` already exists from prior builds, fatal in clean CI.

**Why did it stay undetected for 2 weeks?**
Scheduled-workflow failures produce no alert anyone was watching, AND the CI logs surfaced only `[regen] Server failed to start` — the actual server boot error sat in `tmp/regen-server.log`, which the workflow never printed. Three runs failed blind before the log step was added.

---

## Contributing factors

1. **Silent scheduled-failure blindness** · a `schedule:`-triggered workflow that fails sends no notification to the operator. Two weekly failures passed unnoticed; it took a manual GSC audit to catch the downstream staleness.

2. **The diagnostic log existed but was never surfaced** · `regen-prerender.mjs` explicitly writes `tmp/regen-server.log` and its console message says "Check tmp/regen-server.log" — but CI had no step to print it. Three runs were debugged blind until a one-line `cat` on failure exposed the truth in run #25.

3. **Two-bug masking** · fixing the env gate (#518) first was a real bug but not the active one; the import failure fired earlier. Without the log step, this looks like "my fix didn't work" and invites thrash. The lesson: surface the real error before hypothesizing the cause.

4. **Local/CI environment divergence** · `pnpm run regen` works locally because `packages/*/dist/` already exist from earlier builds. Clean CI has no such state. "Works on my machine" in its structural form.

5. **Refresh cadence vs. content velocity** · the crawl surface only updates weekly by design, so any week the job fails, high-value merged copy silently doesn't reach crawlers. The single point of failure had no monitoring.

---

## What we changed

### Immediate (already shipped + live)

1. **`#519` workspace-deps build** · `turbo run build --filter "nicks-tire-auto^..."` runs after install, before regen — builds exactly the server's runtime workspace deps (`@nour/gbp-publisher`, `@nour/utils`). This is the fix that unblocked run #26.
2. **`#518` env boot gate + failure log** · ≥32-char boot dummies for the four REQUIRED_ENV vars (still needed — it's the gate right after imports), and an `if: failure()` step that prints `tmp/regen-server.log`. The log step is what made #519 diagnosable.
3. **`#514` crawl hygiene** (same audit, separate concern) · sitemap now filters `isRedirectedPath()` at all three emission points (removed 12 URLs that answered 301), trailing-slash + www→apex 301 middleware, navbar Estimate → `/pricing`. Live-verified: `/appointment` and `/estimate` gone from live sitemap.

### Verified end-to-end (not just CI-green)

- Run #26 conclusion = `success` (API-confirmed)
- Bot committed `chore: weekly prerender refresh` to main
- Committed `/tires` prerender contains the merged copy (`pump water`, `you surf`, `87 feet`, `add-on fee` — grepped clean-decoded, not from a colorized capture)
- **Live** `nickstire.org/tires` (curl as Googlebot) serves it — Railway already redeployed

---

## What we should change

### Alert on scheduled-workflow failure (highest leverage)

The 2-week gap existed purely because nobody saw the red. Options:
- **A · GitHub's built-in** — GitHub emails the workflow-file's last committer on scheduled-run failure by default; confirm the operator's notification settings have "Actions" failures on. Zero code.
- **B · Telegram ping** — add a final `if: failure()` step posting to the ops Telegram (the repo already has `sendTelegramMessage`); a broken refresh becomes a phone notification, not a silent SEO leak. ~15 LOC. **Recommended** — matches how the operator already receives ops signals.

### Make CI environment parity structural

Any workflow that boots the server must build workspace deps first. Either bake `turbo run build --filter "<app>^..."` into `pnpm run regen` itself (so local and CI take the identical path), or document it as a required pre-step for every server-booting job. Preferring the former — one code path, no divergence.

### Always surface the diagnostic the script already points at

The `cat tmp/regen-server.log` on failure should be the pattern for any CI step that shells a subprocess writing its own log. If the code says "Check <file>", CI must print `<file>` on failure. Cheap, and it turned a blind 3-run debug into a one-look fix.

### Consider closing the staleness window entirely

The companion May-24 postmortem recommended `PRERENDER_ON_BUILD=true` on Railway (regen every deploy, +3-5 min/build) as the durable fix for prerender staleness. That would also make this weekly job non-load-bearing. Still the strongest option; deferred only for build-time cost. Revisit if crawl-surface staleness bites a third time.

---

## Operator-facing impact

- **No customer-visible outage** · the live app renders client-side for real users regardless of prerender state. This was crawler-only.
- **SEO-latent cost** · for ~2 weeks Googlebot re-crawling `/tires`, `/diagnose`, etc. saw pre-overhaul HTML — the merged conversion copy and updated schema/meta didn't reach the index. No ranking loss measured, but the improvements simply hadn't propagated. Now resolved and live.
- **`/services`** was separately "Discovered - currently not indexed"; Request Indexing was submitted via GSC during this session (on Google's clock now).
- **One remaining operator action** (unrelated to this workflow) · add `www` CNAME → `t9i4z184.up.railway.app` at the registrar + `www.nickstire.org` Railway custom domain. The 301 redirect code is already live and dormant, waiting on DNS.
- **Content nit spotted, not fixed (out of scope)** · `/tires` prerender meta-description says "from $60 installed" while title/hero say "$25" — pre-existing drift worth a later look.

---

## Skill-port note

Follows the B1 postmortem template established in [`2026-05-24-prerender-to-all-users.md`](./2026-05-24-prerender-to-all-users.md): Summary → Timeline → Root cause (5 whys) → Contributing factors → What we changed → What we should change → Operator-facing impact. SEV-3 gets a doc here too because the failure mode (silent scheduled-job death with no alert) is a class worth institutional memory, not a one-off.
