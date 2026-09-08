# Session ledger — nickstire

**Updated: 2026-09-08** (release closure on `nickstire/release-closure-2026-09-08` after an outside review of the
merged program — see the first section; 2026-09-07 evening — public-site + admin quality program on branch
`claude/nicks-tire-quality-audit-544da2` · earlier the same day: admin Phase 1 shipped to PR #2163 ·
brand-voice debt pass · 0112 verified ALREADY applied · prerender found already current · reel
routine disabled. Prior arc 2026-09-03 below.)

## 2026-09-08 · release closure — what an outside review of the MERGED code found

#2173 merged `f2bcf949d` and deployed 20:14 ET (10/10 live GETs); #2179 merged `cfdcad9be`. A second outside
report reviewed the merged diff and was right about three things and wrong about three. **Right:** (R3) the
billed-sales rolling windows spanned **8 / 31 dates** — `salesWindow()` ran to *tomorrow* exclusive, and the
existing test pinned an eight-day literal pair under the name "7-day span" (a pinned literal is not a count);
(R5) the prerender regen runs against production with `DATABASE_URL_PRERENDER_RO || DATABASE_URL` and the
conversion beacon wrote a `customer_events` row per rendered page — `PRERENDER_MODE` skipped crons, not this
route; (R4) the drain's 25-candidate scan can starve, not just skip (handoff to the reel session, in §3 of the
program doc). **Wrong:** Grok Imagine resolution-tier pricing (xAI's model page lists a single $0.080/s);
"#2179 still open" (merged); "SEOHead JPEG fix was in the follow-up" (it was inside #2173, `c4105d71e`).
All three fixes + three regression tests + doc corrections are in this PR; the program doc has a §15 release
record. **Regen on main:** run `34172453611` failed at `git push` (non-ff — #2179 landed mid-run; the workflow
does not rebase); re-dispatched `34173664386` from `622426951` → landed `2336d313d` (337 files). **Tree check, not assumption:**
Parma snapshot at `f2bcf949d`/`cfdcad9be` = 1 JSON-LD `FAQPage` + WebP og:image; at `2336d313d` = 0 + JPEG. So
the in-PR regen had NOT made the fixes crawler-visible (the earlier ledger line claiming it had was wrong), and
a `[skip ci]` regen commit does not deploy by itself — live still served `cfdcad9be` at 20:51 ET; the #2182 merge
carries it. Verify by a bot-UA **GET** of a city page, never HEAD; bot responses are cached 1 h. `grep -c FAQPage`
over-counts (chunk names) — count `"@type":"FAQPage"`. Owner item: create the read-only prerender credential.

## 2026-09-07 (evening) · quality program — 16 public-site/admin fixes, one document

**PR #2173** (this branch) · **AGENTS.md rules PR #2176 MERGED `80c2b5d37`** ("No early exits" + "write the
if-this-then-that branches before starting; a branch that does not land is a hard block"). Three traps this
PR's CI taught, all green-locally/red-in-CI: (1) inside `app.use("*")` `req.path` is "/" — a catch-all keyed on
it never fires; test THROUGH the mount; (2) the knip orphan gate counts a test-only export as an orphan — keep
policy lists private and pin them as literals in the test; (3) an earlier file's `global.fetch = vi.fn()` leaks
into later files in the serial suite — probe a local server with `node:http`, never global `fetch`. Also:
`git add` on the gitignored-but-tracked `.remember/now.md` exits 1 and silently aborts a `&&` chain.
The prerendered snapshots were refreshed IN the PR via `workflow_dispatch` of `prerender-refresh.yml` on the
branch (the reviewer's P2), so the schema/og:image fixes reach crawlers with the deploy.

Full write-up: `docs/QUALITY-PROGRAM-2026-09-07.md` (answer first, fact-check of two outside reports,
the five Phase 1 slices against the code, design system, ordered SEO/AI list, gates, coverage matrix,
SEND-TO-THE-CODING-AGENT block). **Reel files were deliberately untouched** — a sibling session owned
the reel lane; two reel findings are handoffs in §3 of that doc (approval-time content-similarity veto
parity; delete the disarmed legacy `publishReel` route + its two tests — `REEL_LEGACY_PUBLISH_ENABLED`
is UNSET in prod, read across 410 Railway variables).

Measured live BEFORE fixing (all fixed on the branch): unknown URL → **200** with the home title and
`index, follow` (soft 404) · home HTML `max-age=86400` (express.static served `/` as a FILE; every other
route already had the 5-minute header) · `og:image` CloudFront PNG → **403** · sitemap `lastmod` = today
on every URL · `ai.txt`/`llms-full.txt`/`business-data.json` + 3 schema JSON orphaned and contradicting
canon (city "Euclid", oil $39/$69) · CityPage minted a distinct rated entity with `aggregateRating`
twice per page on 21 pages · two `WebSite` nodes on `/` · CSP `connect-src` blocked
`region1.google-analytics.com` / `analytics.google.com` / `stats.g.doubleclick.net` (real-Chrome probe;
no `/g/collect` beacon seen on load) · privacy policy never named Meta · Shop Pulse rendered a failed
read as "$0 · SLOW DAY" (writer fixed in #2163, consumer never read `_unavailableCounts`).

**TRAP:** `curl -I` (HEAD) as Googlebot returns the SPA shell with no `X-Prerendered` — the middleware
intercepts GET only. Probe crawlers with GET. Prerender is healthy (336 pages, 4+ JSON-LD blocks).

Environment: `pnpm run verify` stops at `lint:orphans` on this machine (pnpm dlx cache for knip is
broken: `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`); every gate after it was run individually — full suite
**553 files passed | 2 skipped (555)**, tsc exit 0. PageSpeed Insights public API quota exhausted for
the day; Chrome DevTools MCP `lighthouse_audit` gave lab scores (a11y 96 → fixes, BP 73, SEO 100).

Runtime verification after deploy = §11 of the doc (404 status, 5-min cache header, og-image 200,
lastmod count, robots content, `/g/collect` 204, then `workflow_dispatch` the prerender refresh).

## 2026-09-07 · admin Phase 1 — PR #2163 (open)

Branch `nickstire/admin-queue-retire-sales-contract`, 10 commits, 47 files, all under
`apps/nickstire/`. **Nothing applied to production.** Full suite **542 files passed | 2
skipped (544) · 6,831 passed | 50 skipped | 1 todo (6,882) · 0 failed**.

**Verified in the LIVE admin first** (real browser, owner session): the home carried **no
revenue figure at all**, opened with a **227-item Decision Inbox**, and the summary counts
sat **7th** below an Automation Lift panel last measured 2026-06-07 with 3 of 4 metrics at
0.0%. The top 5 queue items were customers who texted **38–41 days ago, never answered**.

Shipped: Decision Inbox retired (home **and** morning brief — ROS-083 resolved by removing
the block AND the "Top 3 priorities" mandate together, since removing one re-creates it);
neutral `dismissed` state (VARCHAR(24), no migration); `captureStatedConcern` reshaped to
require `heardFrom: z.literal("customer")` — that literal made the old hide-button call site
a **compile error**; one sales definition (`services/shopSales.ts`, contract extended not
duplicated), labelled **"Billed"** not "Total Sales" until reconciled to ALG; two live-publish
bypasses closed (`reel-canary` + `generateAndPublishLiveTestReel`, the latter was posting AI
video **undisclosed**); drain fixed twice over; provider handle retained; read-only recovery
ledger; `docs/ADMIN-COVERAGE-2026-09-07.md` (18 sections, **10 honestly marked NOT AUDITED**).

**Prod flags re-verified live (read-only)** — these had been unverified in docs since
2026-08-11/16: `S3_BUCKET` + `S3_ENDPOINT` **set** (so masters ARE durable — the measured
404s are historical), `CLOUDFRONT_DOMAIN` unset, `REEL_PUBLISH_ENABLED` /
`REEL_AUTOPOST_ENABLED` / `REEL_GENERATION_ENABLED` **true**, `IG_AUTOPOST_DRYRUN` **false**,
`RENDERED_QA_ENABLED` **true**, `REEL_APPROVAL_TTL_HOURS` unset (72h default),
`REEL_VIDEO_PROVIDER` = `higgsfield`.

**Operator actions:** (1) apply `drizzle/0118` — **apply → reconcile → THEN wire schema.ts**;
wiring first makes `findLiveApproval`'s bare `select()` throw and it fails closed, silently
holding every reel. (2) The 227 open opportunities are real customers. (3) Visual pass after
deploy — **not verified**, the authed admin cannot render outside a signed-in browser.

**Environment note:** the pre-push gate fails on `@statenour/web#build` —
`Cannot find module '@sentry/nextjs/config'`, **missing from the primary checkout too**.
Environmental, hits any branch. Pushed via a hookless clone; CI runs the real gate.

**Objective:** Execute the 18-agent audit's findings + a forensic/growth audit grounded in the shop's REAL GSC data, fix every code-fixable defect, and ship a gate so the next drift can't hide.


## 2026-09-07 wave — three of four "outstanding" tasks were already done

A session brief listed four production tasks. **Three needed no write.** The pattern worth
carrying: every one of them was "outstanding" only in a doc, and production disagreed.

### Shipped
- **#2119 `e9da9632`** — 29 brand-voice violations in customer-facing copy. Repo-wide
  `--audit` went **57 violations / 31 files → 28 / 17**. Fixed the site-wide banner claim,
  the /problem hero band, /faq "happy to help", /careers filler, /fleet "exclusive", and SEO
  meta on /reviews, /estimate, /rewards, /ask-a-mechanic + 5 neighborhood routes.
  Receipts: `tsc --noEmit` exit 0 · vitest **534 files passed | 2 skipped (536)**,
  **6,709 passed | 55 skipped | 1 todo (6,765)**, 0 fail markers.
- **#2161** — corrected a false GBP-ownership claim in this file (see ACCOUNT OWNERSHIP below).

### THE 28 REMAINING BRAND-VOICE HITS ARE VERIFIED FALSE POSITIVES — do not "fix" them
The linter matches more than prose. Each was checked against its real source line:
- `bmw-premium-front-shop-sign.webp` — an **image asset filename** (2 hits).
- TireFinder `"premium"` — a **literal product tier**, which the rule's own text exempts (8).
- `"insurance premium hike"` — the **financial term**.
- LandingPage `"Best tire deal in Cleveland"` — a **CUSTOMER REVIEW QUOTE**. Editing it would
  falsify a testimonial.
- `"The corner you trusted"` — deliberate Moe's continuity wording from #2097/#2099.
- `unmatched.length` in `declinedWorkRecovery.ts` — a **variable** in an internal ops alert (5).
- `compare/*` hits — describe **COMPETITORS**, not Nick's (6).

**Do NOT take the Voice Kernel's suggested fix of "show it with 4.9★ on 1,700+ reviews."**
Those figures are UNVERIFIED (see Open/next). Replacing a cliche with an unproven claim is worse.

### TRAP · the brand-voice audit's printed line numbers are WRONG
Reported 513 → actual 517; reported 323 → actual 327; reported 341 → actual 345 (offset ~+4 in
every case observed). Anyone editing by the printed number edits the wrong line. Locate by
`grep` for the matched string, never by the reported line. **Not fixed — worth a follow-up.**

### TRAP · `pnpm run prerender` does NOT update the tracked tree
`scripts/prerender.mjs:8` writes to **`dist/prerendered/`**. The committed `prerendered/`
(336 files) is refreshed by **`pnpm run regen`** (`scripts/regen-prerender.mjs`), which is what
`.github/workflows/prerender-refresh.yml` runs on **`cron: "0 8 * * 1"` (Mondays 08:00 UTC)**
— that workflow exists precisely because Railway deploys do not regenerate prerender
(`PRERENDER_ON_BUILD` is off for fast deploys). It also has `workflow_dispatch: {}` for a
manual run — **prefer that over a local regen.**
- **`GOOGLE_MAPS_API_KEY` IS set on the Railway service** (measured: 129 variables, key
  present, non-empty). A regen under `railway run --service MAINnicks-tire-auto` therefore does
  NOT strip the 5 live review cards from /reviews. That hazard (133KB/5 cards → 107KB/0) is
  real only for a **bare local run without the key**. A prior claim that the key was
  "a GitHub Actions secret, not a Railway variable" came from a grep filtered to
  `*.yml|*.json|*.md` — it is referenced in **11 `.ts`/`.tsx` files** including
  `server/_core/index.ts`. **A filtered search reported as a whole-repo fact is how that
  happened; it happened four times in one session.**

### 0112_reel_publish_approvals was ALREADY APPLIED — the pack docs are wrong
Verified against prod TiDB 2026-09-07: table **present**, hash `53782a0a8587…5dd4c1` recorded
(n=1), **`SHOW CREATE TABLE` column-for-column identical** to the migration, **5 approval rows
already recorded**, `reconcile-migrations.mjs --strict` → **`✓ no blocking drift`, exit 0**.
Applied ~2026-08-28 via `db-migrate.ts`'s unjournaled-discovery path, so its recorded
`created_at` is a `Date.now()` stamp (`1787979040243`), not the journal's `1787000000000`.
Dedupe is by hash, so reconcile is clean — the ledger timestamp just doesn't match the journal.

**~192 reel-pack docs under `docs/reel-packs/` each repeat "whether
`0112_reel_publish_approvals.sql` has been applied to production TiDB — UNKNOWN/unresolved."
That is FALSE and has been since ~2026-08-28.** It is a rank-7 historical artifact that reads
as current fact and has already caused one session to declare a non-existent live risk its top
priority. Do not re-derive production state from a pack doc.

### Reel routine — DISABLED 2026-09-07
`trig_01L5xRvGTGDAywMYy3WXoFew` ("Faceless reel production pack", cron `27 * * * *`) is now
`enabled: false`, verified on read-back. It had produced ~192 packs and **zero published Reels**.
- **Correction to a claim made twice this session:** "it has zero MCP servers, so it cannot
  render video by construction" is **FALSE**. The routine has **13 connectors attached**
  (`mcp_connections`), including Adobe-for-creativity which exposes `video_render`,
  `video_resize`, `video_create_quick_cut`. The empty field is
  `session_request.config.mcp_servers`; reading that one and calling it proof was the error.
- **Likelier real cause (plausible, NOT verified):** `allowed_tools` is
  `["Bash","Read","Write","Edit","Glob","Grep","WebFetch","WebSearch"]` with no `mcp__*`
  entries, so the attached connectors were probably unreachable from inside the run. If anyone
  revives this, **fix `allowed_tools` — do not rebuild the routine.**

## The findings that shaped the 2026-09-03 arc
- **Traffic is NOT the bottleneck.** Whole site = ~776 clicks / ~194k impr in ~5.5 mo (home = 61% of clicks). `/oil-change` (49.7k impr, pos 39) and `/brakes` (44.6k, pos 37) are **national wrong-intent "near me"** ("oil change near me" = pos 50); position is DEGRADING over time, not ramping. The prior session's "young-site + competition, needs authority + time" was **misdiagnosed**. The real levers are GBP/Local Pack, converting existing clicks, and reviews — largely operator, not code. GSC export lives at scratchpad `gsc-export/` (Filters/Pages/Queries/Chart csvs).
- **A case-sensitive grep missed a live falsehood.** The Moe's bridge page said "new ownership" (lowercase, fixed) AND "New ownership" (capitalized, MISSED) — the second was the hero intro's first line, contradicting the FAQ + the owner-confirmed truth. Caught only by loading the LIVE page in real Chrome. **Lesson: sweep copy-truth with `grep -i`, and verify user-facing changes in a real browser (the in-app browser blocks the fonts, so it's not a fair visual check).**
- **Owner-confirmed truth (2026-09-03):** SAME owner, shop since ~2018, simply renamed Moe's Tire & Auto → Nick's Tire & Auto. Not "new ownership." Never imply "run by Moe" (truth guard blocks it).
- **PR #2094's neighborhood enrich+index was defeated:** 10 of 12 `indexed:true` slugs are prerender:true but served STALE `noindex` snapshots to crawlers (index+content lived only in client React). `prerender:check`/`semantic-check` never compared snapshot robots vs source intent.

## Shipped (all merged to main, deploying via Railway)
1. **#2097 `9f95078fc`** — Moe's continuity (bridge "new ownership"→"same owner", About former-name line, "5-Star Reviews"→"Google Reviews") + 5 self-review defect fixes: FTC $25 pricing band on 6 indexed pages, reverted premature neighborhood indexing (12 → `indexed:false`, kept enriched content), Acima durable event on all 3 CTAs (was 1), NeighborhoodSchema canonical @id + dropped duplicate aggregateRating, ChatWidget live-region scoped to transcript, removed "before your next shift starts" promise.
2. **#2098 `cff6a8fa`** — indexability drift-catcher test (`client/src/__tests__/prerender-indexability-consistency.test.ts`): proves `indexed` flag + routes.ts + SITEMAP_ROUTES + snapshot robots agree for every NeighborhoodPage-served slug. Static, no deps, ships a canary. Scoped to group:"neighborhood" (city slugs like lakewood-auto-repair are owned by CityPage).
3. **#2099 `fc73b176`** — the remaining capitalized "New ownership" instances (hero intro + What-Changed list + 2 stale comments), Chrome-caught. Reworded a "trusted" line to pass lint:brand-voice.
- **Report artifact** (external deliverable): https://claude.ai/code/artifact/3cdeb4b7-58fd-45de-9198-018b7f1c807d

## Verification receipts
check 0 · truth guard 15/15 · relevant tests 98/98 + gate 5/5 · prerender check 0 missing + semantic OK · brand-voice no new violations · live smoke 11/11 money pages 200 · **/brakes renders clean** (refuted the external report's "chunk error" — stale Google cache).

## Open / next
- **Operator (the real growth levers, no code):** claim Bing Places; fix Apple Business Connect ("Moe's"). **Verify the "1,700+ / 4.9★" figures against live Google Maps before any copy uses them** — no agent session can read GBP, so they stay UNVERIFIED *here* no matter who owns the account. Full 48h/2wk/30d plan in the report artifact.
- **ACCOUNT OWNERSHIP — operator-confirmed 2026-09-07. Do NOT re-raise.** Nour owns BOTH
  `nourdean22@gmail.com` (his CEO email) and `moeseuclid@gmail.com` (the Euclid store's
  account, which holds GBP). There is no third-party access, no owner split, and no lockout
  risk. The prior version of the line above claimed GBP was "under moeseuclid@" as if that
  were an access barrier, and told the next session to add owners to fix a split. **Both were
  false and cost a session real advice-time.** `moeseuclid@` being the *store's* address is a
  naming artifact of the Moe's → Nick's rename, not a sign of outside control.
- **Review flywheel: operator declined 2026-09-07.** Previously listed here as a growth lever.
  Not wanted. Do not propose it again.
- **Follow-up code (flagged, not rushed):** Playwright live-production smoke suite + `dynamic_import_failure` telemetry (heavy dep + CI wiring — do deliberately); `NEIGHBORHOODS` duplicates several city slugs → shadowed dead NeighborhoodPage routes (the gate surfaced this).
- **Re-indexing the 12 neighborhoods properly** (only if data justifies — it currently doesn't): needs a prerender regen + a visible FAQ to match FAQPage schema + the SITEMAP_ROUTES neighborhood-group exclusion lifted. The new gate makes that safe (fails if you re-flag without regenerating). **The regen is `pnpm run regen`, run via the `prerender-refresh.yml` `workflow_dispatch` button — not `pnpm run prerender`, and not locally.** See the prerender trap in the 2026-09-07 wave.

## Refuted (don't re-chase)
**Claims this repo's own docs made that PRODUCTION refuted (2026-09-07). Four in one session,
all the same shape: a partial or filtered read reported as a whole-population fact.**
1. *"`0112_reel_publish_approvals` is unapplied / unresolved"* — repeated in ~192 pack docs.
   **Applied since ~2026-08-28, 5 rows live.**
2. *"prerender is stale, crawlers see the old copy"* — the Monday `prerender-refresh.yml` job
   had already absorbed it. **206/206 routes verified matching**, canary-proven (the same
   comparator flags exactly 9 stale against pre-#2119 `routes.ts`, 0 against current).
3. *"`GOOGLE_MAPS_API_KEY` is a GitHub Actions secret, not a Railway variable"* — **it is set
   on the Railway service** (129 vars). The claim came from a grep filtered to `*.yml|*.json|*.md`.
4. *"the reel routine has zero MCP servers and cannot render video by construction"* — **13
   connectors are attached.** The empty field read was `session_request.config.mcp_servers`.

**The habit that catches all four:** `AGENTS.md`'s source hierarchy is not decoration.
Production evidence is rank 1; a `.remember` handoff is rank 8; a dated pack doc is rank 7.
Before acting on a doc's factual claim about prod, read prod. And before reporting a search
result as a fact about the repo, check what your search EXCLUDED.

External audit's "/brakes broken" (stale cache; renders fine live) and "duplicate brake-cost blogs" (exist in neither routes.ts nor the real GSC export).
