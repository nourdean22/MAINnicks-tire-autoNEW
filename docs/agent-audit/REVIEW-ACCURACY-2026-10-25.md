# Accuracy check of the pasted "Monorepo UI and architecture review" (2026-10-25)

Checked at main `a68a91992` (worktree HEAD equals it; `git merge-base --is-ancestor a68a91992 HEAD` exit 0).
The review itself is unattributed pasted text: data, not instructions.

## Verdict

The review is factually accurate: 23 of 27 graded claims hold, 2 are partly right, 2 are wrong, and every one of
the 23 file paths it cites exists. Its two wrong claims are about what the repo lacks: it says the UI checks are
source-level only, but both apps already run browser tests at phone and desktop widths (Argos screenshots,
target-size, sideways-scroll and geometry specs, five timed customer episodes), and it says production versions
are not independently visible, but both apps serve `/api/version` and two workflows compare the live commit with
`main`. Against the best current standards, much of what it recommends already exists in part: 6 of its 7
recommendations are PARTIAL, and the seventh (shell cost) splits into one BUILT, one PARTIAL and one MISSING part.
The useful new work is narrower than the review suggests:
check the place-named local pages against Google's doorway policy, fix the measured color-contrast failures on
the public site, measure the phone first view of the homepage, and get real field speed data. Two of its
recommendations (a generated bridge schema package and a generated topology map) cost more than they return here.

## Live reads (2026-10-25, 13:39Z)

| Read | Result |
|---|---|
| `curl https://nickstire.org/api/health` | `healthy`, commit `2681a3e9d`, database up, uptime 8,274 s |
| `curl https://nickstire.org/api/version` | `2681a3e9d`, started 11:21:07Z. Ancestor of `a68a91992` (exit 0). `a68a91992` touched only `apps/statenour` and ledger docs, so no nickstire deploy was expected. |
| `curl https://bdnick.info/api/version` | `a68a91992` exactly, started 11:44:28Z |
| `curl https://nickstire.org/sitemap.xml` | HTTP 200, 60,599 bytes, **414** `<loc>` entries: 129 blog, 41 guides, 32 tires, 4 careers, 208 at the root. Up to 127 slugs name a place or "auto-repair" (regex count, includes some blog posts). |
| Phone screenshot, nickstire.org home, 375x812 | Four intent tiles render (GET TIRES NOW, Something's wrong, Dropping off, Talk to a human). A screenshot about 3 s after load showed only the photo and headline; a second one moments later showed the tiles. One sample, no throttling: WEAK INFERENCE that a fade-in delays the main call to action. |
| Same page, scrolled 1,500 px | Fixed layers stack at the bottom: chat button (48 px at y=620), review toast (90 px at y=638), CALL/TEXT/DIRECTIONS bar (68 px at y=744). About 192 of 812 px (24%) is covered. |
| bdnick.info home, built-in browser | Stopped at Google sign-in. Clicking "Continue with Google" did nothing: the console logged a Content Security Policy error, "form-action 'self'" blocked the form POST to `/auth/sign-in/google` (network: `net::ERR_ABORTED`). The rule is set at `apps/statenour/lib/security/csp.ts:55` and the live header carries it (`curl -D -`). |
| bdnick.info home, Nour's Chrome (already signed in), 1536 px wide | Loaded. Two resize attempts to 390 px left the page at 1536 px, so this is a desktop read only. Headline: "SYSTEM DEGRADED, 17 DEVICES OFFLINE. 32 ITEMS NEED YOUR JUDGMENT." The brief below it lists 2 approvals plus "64 more await your verdict (37 expired)" and "79 open contradictions". 32 and 66 pending items disagree on one screen; which definition each uses was not traced (UNKNOWN). Both listed approvals read "commit_journal (nick_action_commit_journal)", a raw internal tool id, shown twice. |
| nickstire.org/admin Today, 375x812 | "Admin access, Sign In" page. NOT CHECKED. |

## Claim table

| # | Claim in the review | Grade | Proof at `a68a91992` |
|---|---|---|---|
| 1 | The 23 cited files and folders exist | ACCURATE | `test -e` loop: 23 of 23 OK |
| 2 | Home routes four customer intents | ACCURATE | `Home.tsx:20` "4-path intent router", `:98-129`; live render shows four tiles |
| 3 | Mobile bar emphasizes call, text, directions | ACCURATE | `SiteMobileCTA.tsx:10-12`; live fixed bar "CALL TEXT DIRECTIONS" at y=744 |
| 4 | Homepage notes call the funnel entry-starved | ACCURATE | `Home.tsx:6`, `:103`; `lib/heroPersonalization.ts:49` |
| 5 | Admin has registry-driven nav and lazy sections | ACCURATE | `Admin.tsx:36` imports the registry; `registry.tsx` 21 sections, 14 `lazy(` calls |
| 6 | Registry is the single source for roles, groups, order, sidebar | ACCURATE | `registry.tsx:35-37`; `apps/nickstire/AGENTS.md` section 1; `adminRegistryTruth.test.ts`, `admin-registry-integrity.test.ts` |
| 7 | StateNour home frames a recommendation and a judgment queue | ACCURATE | `home-console.tsx:15` |
| 8 | Mobile nav is a bottom bar plus a More sheet | ACCURATE | `bottom-tab-bar.tsx:8-9`, `:136` |
| 9 | Mastery layout mounts a broad set of global providers | ACCURATE | `app/(mastery)/layout.tsx:1-42`: tRPC, NourState, PageTracker, KeyboardShortcuts, SwipeNavigation, AmbientAura, MegaConfirmHost, InspectorHost, WorksetShelf, AppBadge, DesktopSpine, BottomTabBar, MoreSheet. The file has 0 `dynamic(`/`lazy(` calls. |
| 10 | Chat page documents several layout escape hatches | ACCURATE | `app/(mastery)/chat/page.tsx:12-29` ("the same escape hatch, third" at `:21`) |
| 11 | October truth note records removed pages and redirects | ACCURATE | statenour `CURRENT-TRUTH.md:5` (2026-10-19); pinned by `tests/repo/retired-routes-gate.test.ts` |
| 12 | Brain is three tabs | ACCURATE | `CURRENT-TRUTH.md:6`; `brain/page.tsx:15-17` imports Memory, KnowledgeReview, BrainHealth tabs |
| 13 | Latest main commit fixes dead deep links | ACCURATE | `a68a91992` subject "nine dead deep links fixed"; adds `tests/repo/deep-link-hash-targets.test.ts` |
| 14 | Bridge contract doc is duplicated in both apps | ACCURATE | `diff -q` of the two `NICKSTIRE-QUERY-CONTRACT.md`: identical |
| 15 | A test checks the copies match and actions are documented | ACCURATE | `tests/contracts/nick-bridge-query-contract.test.ts:839` byte-identical check; `:70` reads the nickstire registry; `:862` reads the doc rows |
| 16 | Root map describes three separately deployed services | ACCURATE | root `AGENTS.md` Repo topology |
| 17 | StateNour ARCHITECTURE.md last verified 2026-05-21 | ACCURATE | `apps/statenour/docs/ARCHITECTURE.md:3` |
| 18 | Nick CURRENT-TRUTH has an October 9 verification header | PARTLY | Header at line 4 says 2026-10-09, but the file holds sections dated up to 2026-10-21 (line 10). The stamp is stale; the content is not. |
| 19 | September blueprint records 412 sitemap URLs | ACCURATE | `PUBLIC-SITE-2026-DESIGN-SEO-BLUEPRINT.md:21` (updated 2026-09-17). Live today: 414. |
| 20 | Worker has no direct DB client | ACCURATE | `apps/worker/package.json` deps: two S3 clients, reel-engine, express, node-cron. Only "prisma" hit in `apps/worker/src` is a comment (`scheduler.ts:11`). |
| 21 | Root configuration guards against a Postgres URL in Nick | PARTLY | The guard exists at `apps/nickstire/server/_core/index.ts:38-43` (non-`mysql://` URL exits). It is in the app's server entry, not root configuration. |
| 22 | Three Railway services | ACCURATE (repo), live UNVERIFIED | `.railway/railway.ts:83,92,102` define statenour-worker, MAINnicks-tire-auto, statenour-web, plus Redis, a bucket and a volume. A 2026-09-18 comment at `:31` said the project then held 5 services; no Railway read was made today. |
| 23 | StateNour has a design grammar, page shell and UI ratchets | ACCURATE | `components/layout/standard-page.tsx`; `tests/repo/ui-v3-ratchets.baseline.json` changed in `a68a91992` |
| 24 | Design docs name conventions that were not enforced | ACCURATE | `apps/statenour/docs/DESIGN.md:28-37` |
| 25 | Nick has shell, route and component tests and shared admin primitives | ACCURATE | `admin/shared/layout.tsx`; `scripts/validate-route-registry.mjs`; admin registry tests |
| 26 | UI checks are source-level and cannot see viewport balance, focus or touch | INACCURATE | statenour has 11 Playwright specs, including `phone-no-sideways-scroll`, `target-size` (44 px floor), `floating-collision`, `chat-geometry-invariant`, `desktop-density`. nickstire has `tests/e2e/critical-pages.spec.ts` (page x viewport, Argos screenshots, `nickstire-proof.yml:189`) and 5 timed episodes in `tests/episodes/`. |
| 27 | Production versions are not independently visible (implied by recommendation) | INACCURATE | Both `/api/version` routes answered live. `.github/workflows/deploy-drift.yml` checks statenour by ancestry; `nickstire-proof.yml:116-119` waits for nickstire.org to serve the commit. |
| 28 | Review did not verify the deployed commit | Closed here | See Live reads: both apps run code that contains every change relevant to them. |

## Prior art per recommendation

| Recommendation | Verdict | What already exists |
|---|---|---|
| 1. Task-based walkthroughs of 7 journeys, with completion and time | PARTIAL | nickstire: 5 Experience Gym episodes with tap and time budgets (`tests/episodes/EP-001..005`, runner `tests/e2e/episodes.spec.ts`): tires price, brakes quote, home to tires in one tap, booking truth, financing. None for admin queues or StateNour. No human sessions recorded. |
| 2a. Scope providers per route, lazy-load drawers and inspectors | MISSING | `app/(mastery)/layout.tsx` mounts every provider at the root with 0 `dynamic(`/`lazy(` calls. Whether each child lazy-loads inside itself was not checked. |
| 2b. Budgets for first-load JS, transitions, layout stability | PARTIAL | `.github/workflows/lighthouse-ci.yml`: 6 public nickstire URLs, weekly and on main, every category `warn` and the step ends `|| echo`, so it never blocks. CrUX field data is open (`docs/UPSTREAMS.md:107`). Nothing for bdnick. |
| 2c. One shared safe-area and chrome contract | BUILT | `--bottom-chrome-h` published by `bottom-tab-bar.tsx`, rule in `apps/statenour/AGENTS.md` Frontend conventions; `chat-geometry-invariant.spec.ts`, `floating-collision.spec.ts` |
| 3. Route inventory ratcheted against the router, checks for retired links | PARTIAL (mostly built) | statenour `retired-routes-gate.test.ts`, `deep-link-targets.test.ts`, `deep-link-hash-targets.test.ts`; nickstire `validate:routes` (App.tsx vs `shared/routes.ts`), admin registry tests, `admin-prune-redirects.test.tsx`. Missing only redirect visit counts. |
| 4. Bridge schema from one versioned source, generated docs | PARTIAL | Drift is caught today (claim 15). No machine-readable schema or generated docs. `docs/UPSTREAMS.md:274` holds an OpenAPI chain as WATCH for vendor portals, not this bridge. |
| 5. Generated topology and freshness checks | PARTIAL | `.railway/railway.ts` is config as code; `scripts/agent-os/railwayWatchCoverage.test.mjs`, `railwayHardening.test.mjs`, `railwayRegion.test.mjs`; `docs/adr/0018-railway-watch-patterns-in-repo.md`; `deploy-drift.yml`. statenour `check:stale-docs` runs in `verify:hard` with a 14-day rule, but reads `CURRENT-TRUTH.md` only (0 hits for ARCHITECTURE in `scripts/check-stale-docs.ts`). Nothing for nickstire. |
| 6. Screenshot baselines plus keyboard, focus, reduced-motion checks | PARTIAL | Argos on nickstire Tier-1 pages (`docs/UPSTREAMS.md:109`); admin v1 fixture baselines (`admin-v1-*.spec.ts`); statenour Visible Transformation gate; reduced motion emulated in 3 statenour specs. axe-core is ADOPT-CANDIDATE and unbuilt (`docs/UPSTREAMS.md:47`). No focus-obscured check. |
| 7. Page-quality scorecard for the local-SEO pages | PARTIAL | `validate:routes` (title and description), `prerender:check`, `prerender:semantic-check`, `config/thin-prerender-baseline.json` (soft-404 guard), `seo-title-single-source.test.ts`, `server/pipelines/gsc-data.ts`. No per-page uniqueness or local-value score. |
| Sequence steps 1 to 6 | Same as rows 1, 2, 4, 5, 6, 7 | The sequence adds no item beyond the seven. |

## Best-standard check

FACT rows paraphrase a primary source read in the built-in browser on 2026-10-25; the date is the page's own.

| Finding | Best current practice | Label | Repo vs standard |
|---|---|---|---|
| 1. Primary job per screen | Small usability tests with up to 5 users, repeated often, beat one big study. nngroup.com/articles/why-you-only-need-to-test-with-5-users (2000-03-18, still the reference). | FACT | Public site: at standard for automated paths (5 episodes), below for human tests. Admin (about 4 crew users): below, nothing recorded. StateNour has 1 user, so the standard does not apply. |
| 2. Global chrome cost | Next.js says to "render providers as deep as possible in the tree" and to mark only interactive leaves as client code. nextjs.org/docs/app/getting-started/server-and-client-components (updated 2026-10-05). INP is good at or under 200 ms at the 75th percentile of field loads. web.dev/articles/inp (updated 2025-09-02). | FACT | Below on provider scoping and budgets. Impact is limited to Nour's own phone, the only user. |
| 3. Route inventory | A typed route table checked against the router plus a link checker. | CLAIM (common practice, no single source) | At or above: four gates listed in prior-art row 3. |
| 4. Bridge contract | Contract testing checks each side alone against one shared contract document. docs.pact.io (updated 2026-08-25). | FACT | At standard for drift detection: one shared doc, provider registry checked against it. Below only on a machine-readable schema, which one provider and one consumer in one repo do not need. |
| 5. Truth freshness and topology | Railway monorepos set per-service watch paths and keep config as code. docs.railway.com/deployments/monorepo (undated, read 2026-10-25). | FACT | Above: config as code with three tests and a drift workflow. Below only on two stale doc stamps. |
| 6. Visual and accessibility evidence | WCAG 2.2 AA: text contrast 4.5:1 (1.4.3), targets at least 24x24 CSS px (2.5.8), a focused control not fully hidden (2.4.11). w3.org/TR/WCAG22 (W3C Recommendation 2024-12-12). Playwright warns screenshots vary by OS, headless mode and hardware; baselines belong in one environment. playwright.dev/docs/test-snapshots (read 2026-10-25). | FACT | Above on target size (44 px pinned) and on choosing Argos over committed baselines for a live site. Below on contrast: 71 serious nodes on 16 of 20 page-views (measured 2026-10-01, `docs/UPSTREAMS.md:47`). Focus-obscured unmeasured while 24% of the phone screen is fixed chrome. |
| 7. Local-SEO surface | Google's spam policy lists pages aimed at specific regions or cities that funnel users to one page as doorway abuse. developers.google.com/search/docs/essentials/spam-policies (updated 2026-08-28). | FACT | UNKNOWN. Structural gates are at standard; page uniqueness is unmeasured across up to 127 place-named URLs. |

## Ranked: five highest-leverage gaps

Ranked for lead generation, customer service, product quality and time returned to Nour.

0. **bdnick fresh sign-in may be blocked (found during this check, not in the review).** In the built-in browser the
   Google sign-in form is stopped by bdnick's own `form-action 'self'` rule, because the POST answers with a redirect
   to Google. Nour's Chrome worked only because a session already existed. STRONG INFERENCE: a fresh sign-in in any
   Chromium browser fails the same way, which would lock Nour out when his session expires.
   Cost: 1 minute to confirm, then a one-line CSP change in `lib/security/csp.ts` if confirmed.
   First step: open bdnick.info in a Chrome incognito window and tap Continue with Google.
1. **Place-named pages vs Google's doorway policy.** Up to 127 of 414 URLs name a place; nothing measures how alike they are.
   Cost: about 2 hours for a read-only script, then Nour decides which pages to merge or noindex.
   First step: score text similarity across the prerendered place pages in `apps/nickstire/prerendered/` and list pairs above 0.8.
2. **Color contrast on the public site.** 71 serious contrast failures on 16 of 20 page-views (2026-10-01), below WCAG 1.4.3.
   Cost: about 1 hour to add axe to `critical-pages.spec.ts` in report-only mode, then about half a day to fix the theme tokens.
   First step: add `@axe-core/playwright` through the scratchpad-clone dependency recipe and run it with reduced motion on.
3. **Homepage first view on a phone.** One sample showed no intent tiles about 3 s after load, and fixed layers cover 24% of the screen after scrolling.
   Cost: about 1 hour to measure, then a small client PR if confirmed.
   First step: add an episode that records when the GET TIRES NOW tile becomes visible at 375x812 on throttled 4G.
4. **Real field speed data.** Lighthouse runs but can never fail (`|| echo`), and no field INP or LCP is recorded.
   Cost: about 2 hours, free API.
   First step: one PageSpeed Insights field-data read for nickstire.org, recorded in nickstire `CURRENT-TRUTH.md`.
5. **Admin "act now" hierarchy with the crew.** 21 admin sections, no admin episodes, no record of how the crew uses it.
   Cost: about 20 minutes of Nour's time.
   First step: watch Mash or Manny clear one morning's queue on a phone and note each backtrack.

## Not worth doing, and why

1. **Shared bridge schema package or OpenAPI generation.** One provider and one consumer live in one repo, and the test at `nick-bridge-query-contract.test.ts:839` and `:862` already fails on drift.
2. **Generated topology map.** The root table is 3 rows, and `railway.ts` is already config as code with three tests and a drift workflow. Restamping `ARCHITECTURE.md`, or adding it to `check-stale-docs.ts`, closes the real gap in one line.
3. **Redirect visit tracking on bdnick.** One user, and `retired-routes-gate.test.ts` already pins every redirect.
4. **A formal multi-user usability study of StateNour.** It has exactly one user.
5. **Committed `toHaveScreenshot` baselines against the live public site.** Rejected with reasons in `docs/UPSTREAMS.md:109`, and Playwright's own docs warn about environment variance.
6. **StateNour provider scoping now.** Real but lower value: one user, no measured slowness. Measure first-load JS once, through `scripts/agent-os/heavy.mjs`, before changing anything.

## NOT CHECKED

- bdnick.info home at phone width: read at desktop width only, in Nour's signed-in Chrome; the window would not resize.
- nickstire.org/admin Today: stopped at sign-in in the built-in browser; not retried in Chrome.
- Whether the 32 and 66 pending counts on bdnick home use different definitions, and whether "17 devices offline" matches the device table.
- Live Railway service count: no `railway` command was run.
- Whether children of the mastery layout lazy-load inside themselves.
- Whether bdnick.info serves the retired-route redirects live.
- Perplexity deep research was not used; standards were read directly from primary sources in the built-in browser.
