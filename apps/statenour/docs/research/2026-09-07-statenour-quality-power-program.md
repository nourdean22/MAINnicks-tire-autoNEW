# StateNour (bdnick.info) — Quality & Power Program

**Date:** 2026-09-07 · **Author:** Claude Fable 5.1 session `statenour-bdnick-research` · **Inspected:** `origin/main @ 9cc0c0ac2`, production `b3bebde` (read back from `/api/version`), the operator's signed-in Chrome, Railway CLI, Sentry org `statenour`.
**Evidence classes:** **C** = verified at runtime (curl, browser, Railway, Sentry) · **A** = verified in source · **G** = verified by running the repo's own gates · **H** = hypothesis / needs verification · **P** = proposal (design taste or product judgement, labelled as such).
**Companion:** the 2026-09-01 plan (`docs/research/2026-09-01-statenour-plan.md`) is not re-litigated; its R1–R8 shipped. The pasted external report of 2026-09-07 ("Report B") was gated: 4 of its 6 source findings confirmed, 1 reclassified, 1 metadata-only (§14).

---

## 0. What StateNour actually is

**Observed (C/A):** a single-operator personal operating system ("NOUR OS") for Nour, behind Google OAuth with a one-email allowlist. Not a SaaS, not a shop console, not a public knowledge base. Its loop, as the surfaces implement it: **capture → judge (approvals, commitments, contradictions) → execute (missions, next move, bounded agent actions) → verify (receipts, action ledger) → learn (brain memory, journal takes, calibration)**, with an AI chief-of-staff ("Nick", 181 catalogued tools, ~24 exposed per turn) threaded through every step.

**Users:** one. Roles collapse to *operator* (Nour on phone and desktop), *operator's agent* (Nick, plus the MCP/Actions bridges Nour uses from other tools), and *machines* (crons, the Windows local agent, Telegram, Apple Health shortcut, the nickstire bridge).

**Surfaces (A):** 36 pages, 377 API routes, 28 tRPC routers, 105 Prisma models, 55 migrations, ~78 cron manifest entries (Inngest mega fan-out + a worker), pgvector/tsvector on Neon, AI SDK v6 provider chain, Langfuse + Sentry, iOS standalone PWA. Bottom chrome: Home · Chat · Missions · Journal · More (Capture / Execute / Reflect / Operate sections).

**Highest-leverage bottleneck (C):** the **truth-and-delivery loop**. Merged code stopped reaching production three days ago and nothing noticed; the Home headline has read "System degraded" every day on the strength of camera rows last seen in April and an approval backlog aging 330 hours; the app's own quality gate was red at HEAD. When the system's alarms are always on, real failures (like the deploy) are invisible. Every product-power item below is subordinate to making the system's own signals trustworthy first.

---

## 1. Verified baseline (2026-09-07, 20:53–21:30Z)

| Fact | Value | Class |
|---|---|---|
| Production commit | `b3bebde` (#2103), process started 2026-09-04T12:08Z; `origin/main` at `9cc0c0ac2`; statenour commits not live: #2096 (43 files), #2160, #2161 | C |
| Railway | `statenour-web: Deploy failed (8h43m)`, `statenour-worker: Deploy failed (3d)`; deployments FAILED at 07:44 and 08:15 EDT today; build log: `COPY apps/statenour/patches … not found` | C |
| Headers on `/` | CSP `script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src 'unsafe-inline'`, `object-src 'none'`, `frame-ancestors 'none'`; HSTS 1y includeSubDomains (no preload); `X-Frame-Options: DENY`; nosniff; Referrer-Policy strict-origin-when-cross-origin; Permissions-Policy `camera=(), microphone=(self), geolocation=()`; `Cache-Control: no-store` on `/api/*`; **no X-Robots-Tag** (fixed in PR) | C |
| Auth boundary | every page → 307 to `/auth/sign-in?callbackUrl=`; `/api/*` → 401 JSON; dotted-path bypass (R1) confirmed closed | C |
| robots.txt | `User-Agent: * / Disallow: /`; sign-in page had no robots meta (fixed) | C |
| Public surfaces | `/api/version` (identity + configured booleans), `/api/system/heartbeat` (db latency), `/api/actions/openapi` (19 KB tool catalogue for the Custom GPT importer), `/api/nour-os/query` GET (query catalogue), `/api/short/<code>`, `/api/images/<id>`, `/api/auth/*`, `/manifest.webmanifest` | C |
| Session-exempt prefixes probed anonymously (38 GETs) | all deny except the intended public ones; **`/api/brain/pinned` → 500** (fixed) | C |
| Sentry (24h) | `TRPCError permission (10002)` ×112 from nickstire's public PhotoRibbon calling an admin procedure (lands in StateNour's project); `ServiceError: Unauthorized /api/brain/pinned` (my probe); `Failed to find Server Action` ×1 on sign-in | C |
| Repo gates at HEAD | `check:lint-baseline` RED (home-brain-graph 1→2), `check:soft-delete` RED (brain-wisdom aggregate), `check:policy-coverage` crashes without a DB; get-auth 179/179, crons, runbooks, raw-sql, prompt-injection, et-clock, mutations, anti-slop, stale-docs STRICT green | G |
| Home load (signed in, desktop) | TTFB 104 ms, DOMContentLoaded 290 ms, load 1.41 s, document 41 KB, 36 fetches 107 KB, 22 scripts (SW-cached), service worker active | C |
| Home a11y probe | `lang=en`, skip link, `<main>`, 1 `<h1>`, 0 unnamed controls, 0 low-contrast text (computed), 2 sub-24px targets (skip link, one inline link); **27 text nodes at 9–11 px**; sections use styled labels, not headings | C |
| Fonts on Home | GeistSans 100 nodes · Barlow Condensed 2 · `ui-monospace` 35 — **Geist Mono never rendered** (fixed) | C |
| Home content | "System degraded — 18 silent crons · 20 devices offline. 31 items need your judgment." · 23 approvals, oldest 330 h · commitments proposed by Nick with ACCEPT/× | C |
| Missions | "HEALTH DATA IS 76 DAYS OLD — READINESS UNKNOWN" (honest stale label) · NICK FAB overlaps the capture "+" | C |
| Journal | Nick panel quoted "ACTIVE_THREADS is empty" (fixed) · emoji mood chips · Instrument Serif italic prompt · NICK FAB overlaps "ANSWER NOW" | C |
| Stats | XP levels, "Linear regression over 14d snap history", violet tab underline, teal "Graduated" | C |
| RSC prefetches | 7/7 returned **503** at 16:58 local; 4/4 returned 200 at 17:03 | C (intermittent) |
| ⌘K on /settings | once produced the root error boundary ("THE ROOT RENDER FAILED"); not reproducible; Chrome intercepts ctrl+k so the palette did not open on retry | C (once) |
| Phone-width capture | window resize refused by the harness (viewport stayed 1090 CSS px) — mobile ergonomics NOT captured this session | — |

---

## 2. VERIFIED CURRENT DEFECTS

**Status 2026-09-08 (end of day).** D10 #2180 + #2185 · D11 #2181 · D12 #2181 · D13 #2183 + #2195 (flag prerequisites; the flip is Railway env) · D14 #2196 · D15 #2180 · D16 #2180 + #2186 · D17 #2180 · D18 #2188 · D19 #2189 · U3 #2177 + #2198 · U4 #2198 · U5 #2185 · U6 #2193 (+ Langfuse model prices registered) · U7 #2198 · §5.1/5.10/5.11 #2198 + #2185 · §5.2 #2189 · /market MOVED (#2195 + #2196) · Neon branch protected. Open: Sentry split (operator), HSTS preload submission (operator), §5.3/5.4/5.8 design pass.

Fields: evidence · confidence · surface · impact · action · acceptance · dependencies · placement. **FIXED** = in PR #2175 `statenour/bdnick-quality-program-p1` (https://github.com/nourdean22/MAINnicks-tire-autoNEW/pull/2175 — implemented + tested; deployment and runtime verification recorded in RECONCILIATION once merged).

**D1 · Every deploy fails since 2026-09-04 (P0) — FIXED.** C. Railway build log; both Dockerfiles `COPY apps/statenour/patches` after #2096 deleted the only file there. Impact: merged ≠ deployed for 3 days; prod DB migrated for a writer that is not running. Action: drop the dead COPY; gate every build-context COPY source against `git ls-files` plus the inverse (declared patches must be copied). Acceptance: Railway deployments `SUCCESS` for web + worker; `/api/version` commit is a descendant of the merge. Deps: merge. Phase 1 (this branch).

**D2 · `verify:hard` red at HEAD — FIXED.** G. lint-baseline regression from #2090; soft-delete finding on `brain-wisdom.ts` where the filter is present via a shared `where` const. Impact: a permanently red gate is a gate nobody reads. Action: re-snapshot with the reason; allowlist by signature with the reason. Acceptance: both gates green on the branch. Phase 1.

**D3 · `/api/brain/pinned` anonymous → 500 — FIXED, then corrected.** C. `requireSession` outside try/catch under a session-exempt prefix. Impact: wrong status, error-log and Sentry noise per probe. #2175 mapped every throw to 401, which (as the Codex thread and Report C pointed out) would have relabelled the guard's own 503 "Authentication is unavailable" as an expired login. Follow-up: 401 only for a `ServiceError` 401, 503 preserved, anything else a sanitized 500 with one structured log line; every branch still denies. Acceptance: four verbs × {no session → 401, auth unavailable → 503, unexpected → 500 sanitized, valid owner → 200}; `check:get-auth` 179/179. Phase 1.

**D4 · Geist Mono never rendered — FIXED.** C. `document.fonts` "GeistMono: unloaded" while the woff2 downloaded; `--font-mono` unbridged in `@theme`. Impact: every label/eyebrow/timestamp in system mono (Consolas on Windows), wasted bytes each cold load, design-system drift. Acceptance: `getComputedStyle(label).fontFamily` starts with GeistMono; test pins the bridge values. Phase 1.

**D5 · `/save` silently discarded corrections — FIXED in two steps.** A. Cosine > 0.95 in the same category → old row kept, new text dropped, confirmation said "Saved". Impact: changed amounts/dates/negations lost; trust in memory undermined. Action (#2175): identical statement (whitespace/case) = duplicate with an honest "Already saved · seen N×"; different wording = new row linked via `metadata.nearDuplicateOf`, both kept, never auto-merged. Action (follow-up PR, after the #2175 review threads and Report C): identity is decided BEFORE any embedding call (exact row, then normalized match over recent rows) so a provider outage cannot bypass dedupe; an embedding outage still saves the text and reports `embedded: false` (the existing embed-backfill cron indexes it later); a near-duplicate pair is queued into the EXISTING contradiction review (`BrainMemory` category `contradiction`, key = sha1 of the pair, signal `near_duplicate`), and `resolveContradiction` now writes `supersededById` + `validUntil` on the loser — the columns every recall lane already filters on. Correction: the program's earlier line "no code reads the new columns yet" was stale; `contextual-recall.ts`, `cold-memory.ts` and the brain tools filter `supersededById IS NULL AND (validUntil IS NULL OR validUntil > now)`, and that null-or-future rule is the right one (a future-expiring fact is still current). Still open (Phase 2): an explicit as-of query path for dated questions, and propagation of a resolution into cached briefs and mission notes. Acceptance: dedupe tests (9), resolution tests (6), legacy cases migrated. Phase 1.

**D6 · Service-worker cache predicate too broad — FIXED.** A + local reproduction. Any asset-extension URL on any origin cached forever. Action: same-origin `/_next/static/` only; `CACHE_NAME` v11. Acceptance: vm-sandbox test with 7 never-store cases and a mutation canary. Phase 1.

**D7 · Internal identifiers in operator-facing prose — FIXED.** C. "ACTIVE_THREADS is empty" on /journal. Action: plain-word prompt headings plus a rule. Acceptance: next day's brief (daily cache key) contains no SCREAMING_SNAKE tokens. Phase 1.

**D8 · SECURITY.md described a CSP that has not been served since June — FIXED.** C vs A. Impact: the canonical "auth gates + security posture" doc misled readers (unsafe-inline/eval, Vercel hosts, `/api/health` public). Acceptance: the doc's CSP block equals the live header; endpoint table equals `route-policy.ts`. Phase 1.

**D9 · Private app without noindex on its one public page — FIXED.** C. Action: `X-Robots-Tag` on every response + robots metadata on sign-in; robots.txt unchanged. Acceptance: `curl -sI /` shows the header; the gate test reads the real config. Phase 1.

**D10 · NICK floating button overlaps primary actions.** C (screenshots of /journal "ANSWER NOW" and /missions capture "+" at 1090 CSS px). Confidence high. Impact: the primary CTA is partly unclickable at common laptop widths. Action (P): reserve a gutter — on ≥lg render the FAB inside the content column's right margin or dock it into the bottom chrome's More slot; on narrow widths hide it on pages that own a composer (chat, journal). Acceptance: no fixed element intersects any button's bounding box on /journal, /missions, /chat at 390, 768, 1090, 1460 px (Playwright). Deps: design decision. Phase 1 (small) or 2.

**D11 · Stale device rows permanently degrade Home.** C. `/api/system/devices`: cameras last seen 2026-04-14 (`staleness: lost`), "20 devices offline" in the headline; `POST /api/devices/retire-stale` exists but is manual and unscheduled. Impact: the headline cries wolf daily; real degradation is invisible. Action (revised after Report C — retire by intended lifecycle, never by outage age alone): an expected device that has been gone for weeks is still an unresolved incident whose *notification* may be acknowledged, not a healthy one; only an owner-confirmed retirement moves a device out of active health and into history; devices with an unknown lifecycle are shown as "needs classification", never as green. Retire-stale becomes a one-tap owner action on the classified list, not a blind weekly purge. Acceptance: an old unresolved fault stays inspectable and stops re-alerting; a retired camera leaves the count; a planted fresh-offline device still counts and still interrupts. Deps: operator classifies the 20 rows once. Phase 1 next slice.

**D12 · Approvals never expire.** C. 23 deferred actions, oldest 330 h; `lib/automation/approval-queue.ts` has no TTL/expiry path. Impact: a queue that only grows stops being a queue; the "Review approvals" CTA is a chore, not a decision. Action (revised after Report C — expire *authorization*, not obligations): a pending approval past its risk-specific freshness becomes `EXPIRED` (the action can no longer execute on stale state) with a receipt; no human decline is fabricated; the underlying decision or commitment stays visible in its own state; refreshing an expired approval re-checks the actual payload against current state. Freshness is per effect class (a draft cleanup and an outbound message do not share a TTL). Acceptance: an expired permission cannot execute; nothing is recorded as "declined" without a human; the obligation remains listed; a refreshed approval re-validates the payload. Deps: operator sets the per-class freshness. Phase 1 next slice.

**D13 · `/api/images/[id]` serves generated AND improved photos anonymously with `Cache-Control: public`.** A (Report B SN-01 confirmed). Consumers: chat markdown, /content publish tab, `social-actions.ts`, photo-improver (the operator's own photos). Impact: unguessable id is the only protection; intermediaries may cache. Action: signed, expiring URLs (HMAC over id+exp with `AUTH_SECRET`) for external consumers (social publish, Telegram), session for in-app; keep the raw-id path only until every consumer migrates. Acceptance: anonymous GET of an unsigned id → 404/401; a signed URL works until expiry; /content publish and social posting still succeed end-to-end. Deps: operator authorization (behaviour change on a load-bearing path); consumer inventory above. Phase 1 next slice after authorization.

**D14 · nickstire's public PhotoRibbon calls an admin procedure, into StateNour's Sentry project.** C. 112 events/23 h. Impact: shop-site noise in the personal OS's error budget; adaptive photo sort never works for visitors. Action: task chip spawned for nickstire; Sentry project split or an `app` tag (operator). Phase 1 (nickstire) / operator.

**D15 · Read mode does not cover typed `/save`.** A (Report B SN-02, reclassified). `stripMutatingTools` strips model-selected mutating tools; interceptor fast paths (`/save`, "remember that") are the operator's own typed commands and run regardless. Not a hole — the trust boundary is Nour — but the label promises more than the policy. Action: document the exception at the picker ("Read: Nick cannot run mutating tools; commands you type still execute") and pin it with an HTTP-level test. Phase 1 small.

**D16 · Nothing detected a failed deploy for three days.** C. Action (revised after Report C): the observer must not live inside the thing it watches — a cron in the worker shares the worker's failure mode. Use the native GitHub/Railway deployment events first (verify what Railway already notifies before adding anything), then an independent observer that compares each service against its *expected release* (a deployment that was approved as a rollback is a state, not an outage; an unrelated nickstire or docs-only commit must not raise StateNour drift), verifies image identity and schema compatibility, and alerts through the existing Telegram/push channel; show the verdict on /system. The new CI Docker context gate (follow-up PR) builds the real deps stage for both services on every change to a Dockerfile, lockfile, patch or package manifest, with an in-line canary — the COPY-source test alone only checks tracked paths. Acceptance: a simulated failed deployment and a simulated stale service both alert within 20 minutes; an approved rollback is explained, not alarmed; a docs-only merge is quiet. Phase 1 next slice.

**D17 · `inbound-crm` webhook still accepts the secret as a query parameter.** A. Deprecated fallback with a warning. Action: remove after confirming the caller sends `x-sync-key`; test that `?secret=` is rejected. Phase 1 small.

**D18 · `middleware.ts` is deprecated in Next 16** (proxy.ts, Node runtime, edge unsupported in proxy). A + primary docs. Not a breakage. Action: migrate in a dedicated PR; verify `auth()` and the nonce pipeline under Node; keep `tests/security/middleware-boundary.test.ts` as the subject. Phase 2.

**D19 · Design debt with a diagnostic smell (P, from C):** violet accents in journal components (`text-violet-*`, the AI "sparkle" trope) and a violet tab underline on Stats; emoji mood chips; Instrument Serif italic for the daily prompt; four identical wrench icons on chat starters; "181 CATALOG TOOLS" badge; 27 text nodes ≤ 11 px on Home. §5 carries the direction.

---

## 3. NEEDS RUNTIME / REPO VERIFICATION

| Item | What was seen | How to settle it |
|---|---|---|
| Root render crash | once, after ⌘K on /settings; "The error has been reported"; not reproducible | Sentry: search `global-error` digests around 21:05Z; if absent, the boundary's report path is the bug |
| RSC prefetch 503s | 7/7 at one moment, 0/4 five minutes later | Railway runtime logs for `status=503` around 20:58Z; check whether the app or the edge answered |
| "18 silent crons" | headline only; `/api/settings/crons` shows 15 entries with `success14d: 0` on several | `lib/system/cron-diagnostics.ts` silent list from the operator session; cross-check `cron_log`; note the worker has run the 09-04 image throughout |
| `/api/system/errors` empty while /system says 10 errors / 24h | list endpoint returned `data: []` | read the window params; if the list and the count read different tables, unify |
| Langfuse token/cost = 0 | carried from 09-02 | provider `usage` on a planted call; add model prices |
| Apple Health ingest | "76 days old" | shortcut still installed? last `health_samples` row? |
| `/api/actions/openapi` public | by design for the Custom GPT | is the Custom GPT still used? if not, gate it |
| Phone ergonomics | not captured | operator's phone: target sizes, FAB, keyboard + composer, More sheet |
| 13 parked components, AI SDK v7, drive/calendar/reviews intake, S-1 end-to-end attack | unchanged from the 09-01 plan | operator decisions / spikes |

---

## 4. Highest-leverage product-power upgrades

Ranked by leverage × confidence × reversibility ÷ risk. Each: user job · evidence · minimum useful implementation · risks · acceptance.

**U1 · Trustworthy operations signal (Phase 1).** Job: know in one glance whether the system itself is healthy, and be told only when something *new* breaks. Evidence: D1, D11, D12, D16. MUI: deploy-drift + failed-deploy alert (D16), device staleness exclusion (D11), approval TTL (D12), and a Home headline that names the *newest* degradation with its since-time instead of a running total. Risk: suppression hides a real fault → every suppression carries a reason and a planted positive test. Acceptance: for 7 days the headline changes only when a new fault appears; a simulated deploy failure alerts within 20 min.

**U2 · Judgment queue that decides, not accumulates (Phase 1–2).** Job: clear approvals and commitments in minutes with enough context to be right. Evidence: 31 items, oldest 330 h, ACCEPT/× rows with no consequence shown. MUI: group by rule/type, show "what happens if you approve / decline / wait", batch-decline, TTL from D12, and provenance labels (§8) on each item. Risk: batch actions approve blindly → previews with exact args and diffs (MCP guidance). Acceptance: queue age p95 < 3 days; approval time per item < 20 s; zero "what was this?" re-opens.

**U3 · Correctable memory (Phase 2).** Job: fix a wrong fact once and have Nick use the correction. Evidence: D5; BDN-310 columns exist unread. MUI: Brain Review action "supersede A with B" writing `supersededById` + `validUntil`, recall filters `validUntil IS NULL`, the `nearDuplicateOf` link from this PR as the candidate feed. Risk: over-merging distinct facts → human action only, never automatic. Acceptance: corrected fact wins the current query; historical query with a date still returns the old fact; eval:memory case added.

**U4 · Trust labels + sink policy through the existing approval queue (Phase 2, security).** Job: content from email/web/MCP can never trigger an external side effect without a human. Evidence: fencing is probabilistic (Willison 2026: models key on formatting), FIDES/CaMeL/Rule-of-Two consensus. MUI: label every tool result and recall block `{integrity: trusted|untrusted}`; once an untrusted span is in the turn, any tool without `readOnlyHint` or with external reach routes to the approval queue (dry-run mode first, read the log). Risk: approval fatigue → rare, legible prompts. Acceptance: AgentDojo-style workspace injection cases in `tests/eval` show attack-success 0 for external actions; canary that strips one label goes red.

**U5 · Resume record on missions (Phase 2).** Job: after 48 h away, reconstruct where a mission stands in 30 s. Evidence: park/resume shipped (#2052); no "last verified step + evidence links" record. MUI: on park, persist intended outcome, last verified step, links to artifacts/sources, open question, next physical action; render in the Execution Deck. Risk: stale summaries as instructions → timestamp + "verify" affordance. Acceptance: resume friction < 30 s in a timed test.

**U6 · Cost and usage truth (Phase 2).** Job: know what a useful outcome costs. Evidence: cost = 0 in Langfuse; "$0.060 / $5.00" on /system rests on partial data. MUI: `usage` from every provider in the failover chain, model prices in Langfuse, `@langfuse/client` scores from chat thumbs keyed by traceId, per-lane budgets as deterministic stops. Acceptance: a planted call shows non-zero tokens and cost; per-lane spend visible.

**U7 · Progressive tool disclosure (Phase 3).** Job: fewer, better tool choices. Evidence: 181 catalogued, ~24 exposed, selection telemetry now recording. MUI: three SKILL.md-style playbooks loaded on intent; measure selection accuracy with the telemetry. Acceptance: exposed-tool count per turn and wrong-tool rate both fall.

Deliberately not proposed: policy engines, CRDTs, E2EE, a second memory store, a workflow engine, a public sitemap, gamification expansion (settled or rejected verdicts stand).

---

## 5. Design-system and IA direction (P, grounded in C)

**Keep:** the gold-on-void identity, Barlow Condensed display, Geist body, editorial 60ch reading width, honest stale/unknown labels, the calm sign-in card, two-tap confirms, measured bottom chrome. The app is not generic: no Inter, no purple gradient hero, no stock imagery.

**Change (ordered by cost):**
1. **Type**: Geist Mono now renders (D4). Raise the floor: 9 px → 11 px, 10 px → 12 px for anything read on a phone; keep tracking on eyebrows only. Retire Instrument Serif italic from the daily prompt (the decorative-serif cliché); reserve one editorial slot if at all.
2. **Colour semantics**: gold = brand + primary action only; status uses the OKLCH severity tiers already computed in `tokens.css`; retire the violet AI accent (`--status-ai`, `text-violet-*` in journal) — AI attribution is a mono "NICK ·" mark, not a hue. Green as the Reflect card theme dilutes "positive"; use neutral surfaces.
3. **Surfaces**: rows and dividers over nested glass cards; `backdrop-filter` only on overlays (iOS cost); one card level per view.
4. **Density**: desktop uses ~60 % of a 1460 px viewport; Home and Missions earn a second column (queue + context/evidence) at ≥ 1280 px.
5. **Iconography**: Lucide is fine; icons never carry meaning alone; drop the repeated wrench on chat starters and the "181 CATALOG TOOLS" badge (feature theatre).
6. **States**: keep the stale-data banners; add "unknown" everywhere a read failed (already the house rule); empty states say what would fill them.
7. **Motion**: `NeuralBackground`/`AmbientAura` must honour `prefers-reduced-motion` (verify); no scroll-reveal on controls.
8. **Mobile**: FAB collision (D10); 24 px minimum targets, 44 px for frequent ones; focus not obscured by the tab bar; test the composer with the soft keyboard.
9. **Headings**: section labels ("NEEDS YOUR JUDGMENT", "HORIZON") become real `<h2>` styled as eyebrows, so screen readers and ⌘K-style navigation get structure.
10. **Copy voice**: sharp, specific, no internal identifiers, no counts as badges. Observed → proposed: "lands in decide, never in today" → "Captured items go to Decide. Nothing is scheduled for today."; "Everything the system knows about you." → "What is saved, where it came from, and what is inferred."; "System degraded — 18 silent crons · 20 devices offline" → "New since 09:10: cron `weekly-review` silent 3 days" (only new faults); chat starters "Find the biggest revenue leaks · Leads, estimates, callbacks" → personal-OS starters ("What needs my judgment", "Resume the last mission"); "181 CATALOG TOOLS" → remove.
11. **IA**: `/market` (GSC + brand radar from the shop bridge), the "Check Business Dashboard" quick action and the shop-flavoured chat starters are the same class as the deleted `/business` — an operator decision (MOVE to Nick's Tire admin or RETIRE), not agent initiative. Brain's More-sheet sub-links list 4 of 9 tabs; derive from `nav-items.ts` (Phase 2, low).

---

## 6. Security / privacy / data-integrity gates

**Already correct (do not re-do):** nonce + `strict-dynamic` CSP single-sourced; fail-closed middleware; end-anchored matcher + `isStaticFile`; route-policy invariant with tests; webhook secrets via timing-safe compare (Stripe all `v1=` candidates + replay window); SSRF guard on scraping; `<tool_data>` fencing at every prompt assembler (#2064/#2065 gates); mutation lock fails closed; approval queue with atomic claim; read-mode tool stripping; per-tool quotas; AI-route rate limits; SameSite=Lax `__Host-`/`__Secure-` cookies; gitleaks + secret scans; error-message sanitisation (ADR-0012); pgvector kept as `Unsupported` so `db push` cannot drop it.

**Gates to add (Phase 1–2):** signed URLs for `/api/images/[id]` (D13) · `?secret=` removal on inbound-crm (D17) · per-integration kill switches with a canary proving the live path is gated (Telegram, Gmail ingest, social publish, MCP bridge) · idempotency keys on every mutating tool + webhook event-id dedupe · MCP bridge to the 2026-07-28 model: audience-bound tokens, scope step-up for `runPython`-class tools, `readOnlyHint`/`destructiveHint` plus server-side classification · egress allowlist for the worker and any code-execution path · Sentry project split (nickstire vs statenour) · remove `http://localhost:11434` from the production `connect-src` (harmless, untidy) · HSTS `preload` only if the operator accepts the one-way door.

**Data integrity and recovery (facts from Report C's connected Neon reads, 2026-09-07, metadata only):** project `statenour`, PostgreSQL 17, default branch `production`; point-in-time history **6 hours**; snapshots daily at 08:00 UTC kept **30 days** and weekly at 09:00 UTC kept **35 days**; 6 snapshots present (5 automated, 1 manual baseline from 2026-09-03); the `production` branch is **not marked protected**; the organization does **not require MFA** (which says nothing about the operator's own account). What this means: a mistake discovered more than six hours later is recovered from a daily snapshot, i.e. up to a day of memory, journal and receipts can be lost — decide whether that is acceptable (RPO) and how long a restore may take (RTO) instead of assuming "PITR" covers it. Gates to add: an authorized restore drill into an isolated branch with outbound effects disabled (Telegram, email, social publish, crons) so a restore never replays old messages; re-apply deletion tombstones before enabling recall on restored data; Neon branch protection on `production` and MFA enforcement are one-click operator decisions. 6,319 of 17,926 BrainMemory rows are soft-deleted (the gate's own figure): define archive vs suppress-from-recall vs supersede vs erase separately — an erasure must cover raw content, embeddings, full-text documents, derived summaries, caches, exports and snapshot expiry; index maintenance is not an erasure certificate (my earlier "purge must rebuild the index" line was too narrow).

---

## 7. Accessibility / performance / reliability gates

**Accessibility (WCAG 2.2 AA; WCAG 3.0 is a March-2026 working draft, not a target):** 2.5.8 target size 24 px (audit the mono chips and "28 MORE"); 2.4.11 focus not obscured by the fixed tab bar and sheets; 2.5.7 alternatives to drag/swipe (swipe navigation exists — keep tab links); 3.3.8 accessible auth passes (Google OAuth); 1.3.1 section headings (§5.9); reduced motion for the ambient layers; keyboard: verify visible focus on the gold buttons. Add `@axe-core/playwright` (MPL-2.0, dev-only) to the existing e2e on `/`, `/chat`, `/missions` with serious+ failing.

**Performance:** thresholds unchanged (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, p75); CrUX will never hold this origin, so ship `web-vitals` v6 with `reportSoftNavs` into Sentry; the dense keyboard-driven surfaces make INP the metric that bites. Keep the 3D cluster parked and out of routine paths (mount-graph test exists).

**Reliability:** Inngest idempotency is a 24-hour window, not exactly-once — durable operation ids + reconciliation for retries outside it; the client 180 s stall is still the only chat deadline (settled); Railway healthcheck `/api/system/heartbeat` exists; **failed deploys are silent (D16)**; the worker has been on the 09-04 image since its own deploy failed.

**PWA (iOS 26):** Web Push + badging work only from the Home Screen app (used); Web Share Target still unsupported (the Shortcut→POST capture path stands); Background Sync not implemented; passkeys in standalone mode unverified — test on the operator's phone before relying on it.

---

## 8. AI architecture, evals, safety

**Already matches 2026 guidance (9 of 16 principles):** deterministic mutation lock (fails closed), approval queue with resumable state, request-level tool stripping in read mode, fencing (a probabilistic layer, correctly not trusted alone), SSRF guard, the five-layer fabrication defence (the action-language contract is the standout), tracing + audit, per-tool quotas, memory commit gateway with an evidence ladder and a review inbox, tool pruning to ~24, prompt caching with a failover chain.

**Three labels, not one (Report C's correction to U4 is right):** a single trusted/untrusted bit gated on `readOnlyHint` is too coarse — a read-only search can exfiltrate private data in its query, a trusted source can carry confidential content, and an untrusted page can be summarized safely. Track **provenance** (where the content came from, what it can establish), **confidentiality** (where it may be disclosed) and **authority** (which operation the operator authorized, on which object, under which limits), and enforce at the real boundaries: the tool call, the network destination, storage, code execution and publication. MCP annotations are hints, never permission. Every red-team case ships with a legitimate task that must still succeed.

**Missing, ranked by risk reduction per effort:** (1) provenance/confidentiality/authority labels + sink policy at the effect boundary (U4, as corrected above); (2) kill switch per integration with canaries; (3) idempotency keys on mutating tools + webhook replay dedupe; (4) approval previews with exact args/diffs and provenance; (5) bridge/MCP hardening to the 2026-07-28 spec; (6) an injection red-team corpus run in CI with a planted decoy credential; (7) eval discipline: criteria written before the change, judge from a different model family, read transcripts weekly (Braintrust already holds the runs; OpenAI Evals is winding down — irrelevant here); (8) per-lane cost/latency budgets as deterministic stops; (9) egress allowlist; (10) short-lived scoped credentials per integration; (11) `cited_text`-style provenance carried into answers.

**Deterministic beats AI for:** scheduling and date math (compute in SQL, house rule), dedupe by hash/id, counts and reconciliation, permission checks before the model, argument validation (zod at every boundary), rate limits/budgets/stop conditions, signature and replay checks, trust labels as a property of the data path.

**Settled, do not re-propose:** model pin `minimax-m3`, tool-overload and prompt-bloat hypotheses, iterative retrieval, uncertainty ranking, persona A/B, autonomy slider, policy engines.

---

## 9. Public discovery, SEO, AI discovery

**Decision:** StateNour is private and must never be indexed or cited. Policy now in code: `Disallow: /` (well-behaved crawlers), `X-Robots-Tag: noindex, nofollow, noarchive, noimageindex` on every response, robots metadata on the sign-in page, auth as the only access control. Google documents that a robots-blocked URL can still be listed by URL when linked, and that noindex is only seen if the page is fetched — hence both layers. User-triggered fetchers (ChatGPT-User, Perplexity-User, Google-Agent, meta-externalfetcher, Amzn-User) document that they ignore robots.txt; Anthropic's `Claude-User` documents that it honours it. Training tokens worth naming in robots.txt if desired (`GPTBot`, `ClaudeBot`, `CCBot`, `Bytespider`, `Google-Extended`, `Applebot-Extended`, `meta-externalagent`, `Amazonbot`) protect only the sign-in page's text. No sitemap, no schema.org, no llms.txt, no Search Console beyond a removal if the login URL ever appears. If a public portfolio surface is ever wanted, it gets its own host or path with its own policy and never inherits personal content.

---

## 10. Measurement (outcomes, not vanity)

| Measure | Definition | Source |
|---|---|---|
| Merged→deployed lag | minutes from merge to `/api/version` ancestry; failed deploys detected < 20 min | GitHub + `/api/version` + Railway (D16) |
| Degraded-headline precision | share of "degraded" days that named a fault < 24 h old | Home headline log |
| Judgment queue age | p50/p95 age of pending approvals + commitments; count within TTL | approval queue |
| Capture integrity | zero lost raw captures in interruption fixtures; "Saved" only when persisted | save path tests + outbox |
| Corrected-memory success | current query uses the correction; dated query keeps history | eval:memory |
| Supported-answer rate | factual claims traceable to evidence used in that turn | Langfuse traces + judge |
| Read/private boundary violations | zero in the adversarial fixture set | tests/security + eval |
| Action outcome success | verified intended effect ÷ authorised attempts, unknowns separate | action receipts |
| Resume friction | seconds to understand and continue a parked mission (target ≈ 30 s) | timed test |
| Useful cost | cost per accepted/verified outcome; missing usage shown as unknown | Langfuse (U6) |
| Attention burden | dismissed suggestions resurfacing; repeated nudges | agenda + nudges tables |
| UI quality | INP/LCP/CLS p75 on the operator's devices; axe serious+ = 0; task success on phone | web-vitals → Sentry, e2e |
| Error hygiene | Sentry events/day from StateNour only; probe-noise = 0 | Sentry (after project split) |

Not goals: DAU, token volume, memory count, idea count, XP, dashboard visits.

---

## 11. Rollout and runtime verification

Four states, always separated: **Implemented · Tested · Deployed · Runtime-verified.**

**PR #2175 — Implemented · Tested · Deployed · Runtime-verified (2026-09-07 23:54Z).** Merged `71e7cf14` at 21:58:41Z (operator); `/api/version` on bdnick.info reports commit `71e7cf1460b276d924df6c9d3d24aaf70f429d9e`, process started 22:02:50Z, deployment `1f6a003b` — `git merge-base --is-ancestor` confirms the merge is live; the worker answers `/health` `ok` (scheduler running, started ~22:00Z); `curl -sI /` carries `x-robots-tag: noindex, nofollow, noarchive, noimageindex`; anonymous `GET /api/brain/pinned` → 401; `/sw.js` serves `CACHE_NAME = 'nour-os-v11'`; the sign-in page carries `<meta name="robots" content="noindex, nofollow, noarchive">`. Not exercised live on purpose: `/save` with real text (a production write to the operator's memory on agent initiative) — covered by the unit contract; and `document.fonts` (needs the operator's browser session). The follow-up PR is Implemented + Tested; its deploy and runtime states are recorded in RECONCILIATION once merged.

**Release discipline:** one slice per PR (1–4 files + tests); every gate ships with a canary; hold merges while a sibling's long CI check runs; Codex review threads have been right 4 of 7 times — read them.

---

## 12. Whole-product coverage matrix

| Surface | Disposition | Why / what |
|---|---|---|
| Home (HomeConsole) | KEEP / REPAIR | six-section architecture stays; headline truth (U1), queue decay (U2), desktop second column (P) |
| Chat (Nick) | KEEP / REPAIR | starters → personal-OS; remove tool-count badge; read-mode label (D15); trust labels (U4) |
| Missions (Execution Deck) | KEEP / REPAIR | FAB collision (D10); resume record (U5); "lands in decide" copy |
| Journal | KEEP / REPAIR | label leak fixed; violet + emoji + serif italic (§5); no test pins the UI (flagged 09-01) |
| Brain (9 tabs) | KEEP / REPAIR | supersede/merge action (U3); nav metadata 4→9 (low); Map default-tab proposal open |
| Stats / Goals / Scoreboard | VERIFY | XP + 14-day regressions read as pseudo-precision; separate progress from ungrounded scores; redirect stubs stay |
| People | KEEP / VERIFY | honest STALE badges; avoid unsolicited outreach proposals |
| Intelligence brief / ledger, Decisions | VERIFY | outcome ledger writers exist since 08-16; measure use |
| Learn, Pins, Links, Photo Improver | KEEP / VERIFY | utility access, not top-level; photo-improver output is personal media (D13) |
| Content | VERIFY / MOVE shop functions | classify by domain before moving (R7 precedent) |
| Market | MOVE (operator) | shop GSC + radar projections; same class as `/business` |
| Settings | KEEP / REPAIR | env-mirror honesty shipped in the held wave; cron panel duplicates /system/crons |
| System hub + 15 subpages | KEEP / CONSOLIDATE | one trustworthy summary + drill-down; deploy drift (D16); devices (D11) |
| Auth / sign-in | KEEP | clean; noindex added |
| Public endpoints | VERIFY each | images (D13), actions/openapi, nour-os catalogue, short links |
| PWA / SW | REPAIR (done) | v11 predicate |
| Legacy redirects | KEEP | 40+ entries in next.config, gate exists |
| Deploy pipeline | REPAIR (done) + REPAIR (D16) | Dockerfile gate; drift alert |
| Docs (SECURITY, CURRENT-TRUTH) | REPAIR (done) / KEEP | dated supersession, never a competing truth doc |

---

## 13. Roadmap

**Phase 1 — protect truth and delivery (this week).** PR `statenour/bdnick-quality-program-p1` (D1–D9) → runtime verification (§11). Next slices, each its own PR: deploy-drift alert (D16) · stale-device exclusion + scheduled retire (D11) · approval TTL + digest (D12, operator sets TTL) · signed image URLs (D13, after authorization) · inbound-crm query secret removal (D17) · read-mode label + test (D15) · FAB gutter (D10). Exit: merged = deployed within 20 minutes or an alert; the Home headline is quiet on a healthy day.

**Phase 2 — turn existing capability into daily power (2–4 weeks).** Correctable memory (U3) · trust labels + sink policy (U4) · resume record (U5) · cost truth (U6) · judgment queue UX (U2) · design pass (§5 items 1–10) with phone screenshots + axe · `middleware.ts → proxy.ts` (D18) · Sentry project split · Brain nav metadata · operator decisions on Market/Content/starters.

**Phase 3+ — bounded frontier work.** AI SDK v7 spike · AgentDojo workspace corpus in `tests/eval` · Hindsight-style memory typology (fact / experience / observation with evidence links) + weekly reflect cron · progressive tool disclosure (U7) · LongMemEval-style temporal/abstention evals · one learning-to-practice experiment · optional public portfolio surface with its own boundary.

---

## 14. Gate verdicts (plan-gate) and adoption register additions

**Report C ("Independent Verification and Next-Level Upgrade Program", pasted 2026-09-07 after #2175 merged) — verdicts on its corrections, checked against source:** PR #2175 already merged — TRUE (merged by the operator at 21:58:41Z while the `node` rerun was still running; it finished green at 22:02:05Z; deployed and runtime-verified at 22:02:50Z, see §11). Pinned guard masks a 503 as 401 — TRUE (`lib/auth-guard.ts` throws `ServiceError(…, 503)` when production auth is unconfigured); fixed in the follow-up PR. Supersession columns "have no readers" — my claim was WRONG; `contextual-recall.ts`, `cold-memory.ts` and the brain tools filter them with the null-or-future rule, which is the correct one; the follow-up PR makes resolution write those columns. Exact dedupe depended on embeddings — TRUE; fixed (identity first). Device retirement and approval TTL as proposed could hide unresolved problems — ACCEPTED; D11/D12 rewritten. Deploy watcher inside the worker shares its failure — ACCEPTED; D16 rewritten and the Docker context gate added. Neon recovery boundary (6 h PITR, unprotected production branch, no org MFA) — NEW, accepted into §6. "Index rebuild = purge" — OVERCLAIM on my side, corrected. OSS register wording (OpenMemory, Lakera, telegram-mcp, licenses) — precision corrections accepted into `docs/UPSTREAMS.md`. Its runtime gap (it could not read `/api/version`) is closed by this document's §11 receipts.

**Report B (pasted 2026-09-07):** SN-01 images route — CONFIRMED (D13, consumer inventory added); SN-02 read-mode fast paths — CONFIRMED in source, RECLASSIFIED as policy ambiguity (D15); SN-03 save dedupe — CONFIRMED, FIXED conservatively (D5); SN-04 SW predicate — CONFIRMED, FIXED (D6); SN-05 /market shop content — CONFIRMED, operator decision (§5.11); SN-06 Brain nav metadata — CONFIRMED, low (Phase 2). Report B's "deployed SHA not verified" is now settled: it was the largest defect in the estate. Its product upgrades A–F are ~60 % incumbent (park/resume, Discover verdicts, tool registry, routing) and are folded into U1–U7 as extensions, not new systems.

**UPSTREAMS.md additions (verdicts from the OSS harvest, primary-source dated):** Hindsight — ADOPT-PATTERN (memory typology + reflect); mem0 reconciliation — ADOPT-PATTERN (ADD/UPDATE/DELETE/NOOP at the commit gateway; OpenMemory MCP is DEAD); cognee overview index — ADOPT-PATTERN; letta, mempalace, khoj (AGPL), NeMo Guardrails, inspect_ai, ragas, react-aria — STUDY-ONLY; CaMeL / Dromedary — ADOPT-PATTERN as first-party code (no maintained reference impl); AgentDojo — ADOPT-AS-BENCHMARK; PromptGuard-2 / LlamaFirewall — WATCH (bake-off on the AgentDojo corpus; gated weights, attribution clause); Arcjet — REJECT (prompts leave the box); llm-guard, rebuff, Lakera OSS — DEAD; invariant — WATCH/REJECT (idle since Snyk acquisition); deepeval — dev-only trial; openlit, next-safe-action, kbar (dep), telegram-mcp (user session), supermemory, AFFiNE — REJECT; oxlint, `@axe-core/playwright` — ADOPT-DEP; TanStack Table v9 — WATCH until a named dense view; anthropics/skills — ADOPT-PATTERN; google_workspace_mcp, obsidian-local-rest-api, postgres-mcp restricted mode — dev-agent / local / pattern only; Monica, Memos, Trilium, Logseq — STUDY for IA.

---

## Already implemented correctly — do not spend engineering time here

The action-language contract + fabrication rewriter/sanitiser; the memory commit gateway with evidence ladder, quarantine inbox and gmail intake; fencing across all five prompt assemblers with per-tool gates; `route-policy.ts` + middleware-boundary tests; nonce CSP + security headers; webhook signature handling; SSRF guard; mutation lock fail-closed; approval queue state machine; `verify-crons.ts` bidirectional manifest check; `guardian-registry-drift` test; UI mount-graph gate; retired-routes gate; manifest single-source gate; theme colour-token gate; OKLCH severity tiers; Langfuse/Sentry sharing one OTel provider with a recording self-check; `/api/version` deploy identity; stale-data banners ("HEALTH DATA IS 76 DAYS OLD"); two-tap confirms and 48 px targets in the PWA primitives; the sign-in page.

---

## SEND THIS TO THE CODING AGENT NOW

Scope: **StateNour only** (`apps/statenour`, `apps/worker`). Do not rebuild anything; preserve HomeConsole, the Execution Deck, chat-v2, the Brain surfaces, the memory gateway, the fabrication defence, receipts/outbox, and every gate named in "Already implemented correctly". Report **Implemented / Tested / Deployed / Runtime-verified** as four separate states with receipts; never say "shipped" for merged-but-not-deployed.

1. **First: land and verify PR `statenour/bdnick-quality-program-p1`.** Wait for CI green, merge (squash), then confirm Railway `SUCCESS` for `statenour-web` AND `statenour-worker`, and `git merge-base --is-ancestor <merge-sha> $(curl -s https://bdnick.info/api/version | jq -r .data.build.commit)`. If either build fails, read `railway logs --service <svc> --build` before touching anything. Then run the §11 checklist and post the receipts. The migration applied on 09-07 needs the #2096 writer live before any tool-selection telemetry read means anything.
2. **Slice 2 — deploy-drift alert (D16):** a cron in `config/crons.ts` (passes `check:crons`) that compares `/api/version` ancestry with `origin/main` via the existing GitHub integration and Railway's latest deployment status, alerts through the existing Telegram/push channel after 20 minutes of drift or a FAILED status, and shows the verdict on `/system`. Ship with a planted positive test (fake stale SHA → alert) and a quiet-state test.
3. **Slice 3 — Home truth (D11 + D12):** exclude `staleness: lost` devices from the degraded count and schedule `retire-stale` weekly at 30 days; add a per-rule TTL to the approval queue with auto-decline receipts and a digest line (default 7 days unless the operator sets one). Tests: planted fresh-offline device still counts; an item past TTL is never pending.
4. **Slice 4 — small verified fixes:** `/api/webhooks/inbound-crm` rejects `?secret=` (test); the read-mode picker states "commands you type still execute" and an HTTP-level test pins that `/save` in read mode writes while model-selected mutating tools are stripped; FAB gutter so no fixed element intersects a button on /journal, /missions, /chat at 390/768/1090/1460 px (Playwright).
5. **Needs operator authorization before code:** signed URLs for `/api/images/[id]` (consumers: chat markdown, /content publish, `social-actions.ts`, photo-improver); `/market`, "Check Business Dashboard" and shop-flavoured chat starters (MOVE or RETIRE, R7 precedent); Sentry project split with nickstire; approval TTL value; HSTS preload.
6. **Backlog, do not absorb into these branches:** U3 correctable memory (supersede/merge + recall filter on `validUntil`), U4 trust labels + sink policy, U5 resume record, U6 cost truth, §5 design pass, `middleware.ts → proxy.ts`, Brain nav metadata, AI SDK v7 spike, AgentDojo corpus, Hindsight typology, progressive tool disclosure.

For every slice: 1–4 files plus a test that fails first; run `check:get-auth`, `check:soft-delete`, `check:crons`, the touched test files, and the full suite once before push; a green mock is not a verified user outcome; disclose anything skipped and why.
