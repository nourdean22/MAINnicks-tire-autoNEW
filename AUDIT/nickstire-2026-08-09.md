# nickstire evidence pass — 2026-08-09

Stage-2 evidence for the nickstire execution mandate (the 9th pasted mega-plan). **Investigation
first, deletions only where the evidence is conclusive and the surface is admin-only.** Every number
here is computed from this checkout, not quoted from a document — the previous wave's eleventh
falsified claim was a doc-sourced count that contradicted the filesystem.

Method note: the reachability instrument was rebuilt mid-pass after it lied. See §1.

## 1 · Page reachability — the instrument failure that mattered

The first pass string-matched guessed import specifiers and reported **148 of 198 page files as
unreachable**, including `WorkOrdersSection.tsx` (56KB), `CustomersList.tsx` and
`DeclinedEstimatesSection.tsx` — the entire money cockpit — plus **zero** route declarations in
`App.tsx`. Both were detector bugs:

- imports are written `./pages/About` (relative to `App.tsx`), not `@/pages/About` or `./About`;
- admin sections are imported by **sibling admin files**, not by `App.tsx`.

Acting on that output would have deleted the live admin console. Rebuilt as a **resolved import
graph**: every specifier is parsed and resolved to a file on disk, then reachability is walked from
the true entrypoints (`App.tsx` + `main.tsx`), with tests excluded — a test import does not make a
page live.

| Measure | Value |
|---|---|
| unresolved relative specifiers (trust signal) | **2** |
| page `.tsx` files | 198 |
| reachable from `App.tsx`/`main.tsx` | **190** |
| not reachable | **8** |
| `path=` declarations in `App.tsx` | 145 |
| paths in `shared/routes.ts` | 194 |
| prerendered directories | 339 |

**Lesson, generalised:** a reachability claim needs the import graph *resolved*, not matched. The
symptom of a broken detector is a result too large to be true — 148 dead files in a live app.

## 2 · The 8 unreachable files — 6 deleted, 2 KEPT as deliberate pins

Cross-checked with a second instrument (repo-wide name grep across `client/`, `server/`, `shared/`)
because a name mention is not an import.

| File | Verdict | Evidence |
|---|---|---|
| `admin/money/TireSalesPanel.tsx` | **DELETED** | appears in no file but its own |
| `admin/money/KPICard.tsx` | **DELETED** | appears in no file but its own |
| `admin/money/MiniKPI.tsx` | **DELETED** | appears in no file but its own |
| `admin/money/FormField.tsx` | **DELETED** | only other hit is `components/ui/form.tsx`, which exports its own unrelated `FormField` — a name collision |
| `admin/money/MoneyBrief.tsx` | **DELETED** | 3 other hits are all COMMENTS about a since-extracted constant (`moneyMath.ts`, `CustomersList.tsx:84`, `DeclinedEstimatesSection.tsx:14`) |
| `admin/today/MorningBrief.tsx` | **RESTORED — do not delete** | deleted, then the suite went red: `server/adminTruth.test.ts` consumes it by **reading its source text from disk** (`fs` by path), which is neither an import nor a symbol reference. See §2b |
| `HomeLegacy.tsx` (73KB) | **KEEP — pinned** | `Home.tsx:10` — "vs HomeLegacy (kept as rollback)" |
| `TireFinderLegacy.tsx` (116KB) | **KEEP — pinned** | `TireFinder.tsx` is a 12-line re-export shim whose comment states the legacy page is "kept as a byte-for-byte rollback + the home of the shared OrderModal"; `TireOrderModal.tsx` was extracted from it |

### 2b · The instrument's THIRD failure mode — consumption by file path

`MorningBrief.tsx` was deleted on the strength of two agreeing instruments, and the **test suite
caught it**: `server/adminTruth.test.ts` opens the component's source file by path and asserts on its
text ("F25e live requires `online === true`; undefined is its own state"). The failure was
`ENOENT: no such file or directory` — the guard could no longer find what it guards.

The name-grep *had* listed `server/adminTruth.test.ts` under MorningBrief. I misattributed that hit
to the sibling server cron `cron/jobs/morningBrief.ts` and moved on. The evidence was present and
misread.

**Generalised: a file can be consumed three ways — imported, referenced by symbol, or READ BY PATH.**
Import-graph and symbol-grep both miss the third. Source-text assertion tests (this repo has a family
of them from the ROS-083 "failure must never render as good news" wave) are exactly that pattern. Any
future deletion sweep must also grep for the **filename as a string** before concluding a file is
dead. The other five deletions were re-checked that way and have no path-string references.

Standing question for a later session: `MorningBrief.tsx` is unmounted in the app yet pinned by a
truth-guard test. Wire it or retire it *with* its guard — but not silently.

Intent was checked rather than guessed. The four never-touched files were added 2026-06-01 and never
edited again; `MoneyBrief`/`MorningBrief` were last touched only by **repo-wide sweep commits**
(#1336, #1045, the U2 container pass) — maintenance paid on dead code, not evidence of intent to
wire. The sibling Customers/Leads/Outreach briefs **are** wired, so this is a partially-orphaned
family, not a dormant feature.

**Mandate items answered:** stage 3.2 asks to "resolve `HomeLegacy`, `TireFinderLegacy`/`TireFinder`
(12-line — check if it's a re-export shim)". Answer: it **is** a re-export shim, and both legacy
files are **deliberate, documented rollback pins**. Already resolved; do not delete.

## 3 · The "Moe's Tire" NAP item is the mandate's most dangerous instruction

Mandate stage 5.1 calls killing every "Moe's Tire" reference **"the highest-leverage, lowest-effort
item in the campaign."** Executing that literally would destroy a deliberate, GSC-evidenced asset.

`MoesTireBridgePage.tsx` is a legacy-brand capture page. Its own header records the rationale, and
`shared/routes.ts` shows the wiring:

- the shop at 17625 Euclid Ave was previously **Moe's Tire** in Google's knowledge graph;
- the page's comment cites **242 clicks at position 4.5 over 90 days** on "moe's tires euclid", plus
  ~200 impressions/yr across Moe's brand queries;
- `/moes-tire`, `/moes-tires`, `/moes-auto` **301 to** `/moes-tire-euclid` (`_core/redirects.ts:74-76`)
  and are `sitemap: false` — i.e. already correctly consolidated;
- the canonical page's H1 is "MOE'S TIRE EUCLID IS NOW NICK'S TIRE & AUTO", which is exactly the
  rebrand-disambiguation pattern search engines want.

**Verdict: site-side "Moe's" references are correct and must stay.** They are not a NAP conflict —
they are the *fix* for one. A genuine NAP conflict would live in **GBP and third-party directories**
(business name, address, phone), which is operator console work, not a repo change. This also
satisfies the mandate's own rule: *never delete a public URL with live organic traffic.*

## 4 · AI-crawler and schema posture — already satisfied

| Mandate item | Finding | Action |
|---|---|---|
| 2.5 robots.txt must allow GPTBot / OAI-SearchBot / PerplexityBot / ClaudeBot / Google-Extended | `robots.txt` is served from Express (`_core/index.ts:550`) as `User-agent: *` + `Allow: /`, with only admin/auth/API/tracking paths disallowed. **No AI crawler is blocked.** A dedicated `server/answerEngineCrawlers.test.ts` already exists | none |
| 5.3 add `AutoRepair` + Service/Offer/Review/FAQ/OpeningHours/Geo schema | A sample money page already emits **AutoRepair, Service, Offer, AggregateRating, OpeningHoursSpecification, GeoCoordinates, PostalAddress, BreadcrumbList, OfferCatalog, WebSite/SearchAction and FAQPage** | none — recorded NATIVE in `docs/UPSTREAMS.md` |
| FAQ schema as a 2026 tactic | Google deprecated FAQ **rich results** 2026-05-07; the **markup remains valid and harmless**, and AI retrieval may still parse it. All 341 prerendered pages carry it | **leave it** — recorded in `docs/UPSTREAMS.md` |

## 4b · tRPC procedure census — INCONCLUSIVE, and deliberately not a delete list

Mandate stage 2.9 asks for dead procedures. The census runs, but it is **not trustworthy enough to
delete from**, and saying so is the finding.

| Measure | Value |
|---|---|
| router files carrying procedures | 79 |
| procedures registered | **689** |
| called from the client | 360 |
| called server-side only (crons, services, webhook dispatchers) | 158 |
| no caller found — **upper-bound candidates** | **171** |
| router keys resolved from their export symbol | 90/92 |
| router files whose key could NOT be resolved | 5 |

**Calibration: the first candidate checked was a false positive.** v1 keyed procedures by *filename*
and reported `sectionInsight` as an entirely dead router. It is registered as `adminDashboard` and is
called live: `client/src/pages/admin/shared/insight.tsx:29` runs
`trpc.adminDashboard.sectionInsight.useQuery(...)`, rendered by at least four admin sections. Keying
was rebuilt to resolve `export const <symbol> = router(` → registration key, which moved client-called
from 312 to 360 and candidates from 203 to 171 — but **5 files still do not resolve**, and every
procedure under them is a guaranteed false positive.

**Therefore: 171 is an upper bound containing known-bad entries. Do not delete from this table.** Each
candidate needs individual verification, and the repo cannot see external consumers at all (VAPI
dashboard tools, the ChatGPT Custom GPT, statenour bridge callers) — the failure mode that produced
`docs/UPSTREAMS.md` failure-mode #8. Useful next step is to resolve the last 5 router keys first, then
verify candidates one at a time, highest-count routers first (`contentAdmin` 22, `nickActions` 20,
`sms` 20, `dispatch` 14).

## 4c · The session's real lesson: four instrument failures, one root cause

Every wrong answer in this pass came from **inferring a mapping instead of resolving it**:

1. import specifiers *guessed* (`@/pages/X`) instead of resolved → 148 false "unreachable" pages,
   including the whole money cockpit;
2. consumption assumed to be import-or-symbol → missed **read-by-path**, caught only when the suite
   went `ENOENT`;
3. a grep hit *attributed* to a plausible sibling (`cron/jobs/morningBrief.ts`) instead of opened;
4. router keys *guessed* from filenames → an entirely-live router reported dead.

The counter-discipline is cheap: resolve the mapping, then make a second instrument disagree with you
before acting. Three of the four were caught by a second instrument or the test suite; the one that
reached a commit was reverted by the gate before merge.

## 4d · PROD TRAFFIC — operator-authorized read-only pull, and it corrects §3

Run via `apps/nickstire/scripts/page-traffic-readonly.mts` (SELECT-only; prints its host before
querying, per `prod-db-guard`). Target proven, not assumed: `gateway01.us-east-1.prod.aws.tidbcloud.com`,
db `nickstire`. Window **2026-04-05 → 2026-08-07**, 36,446 rows, **75 distinct URLs**.

### ★ CORRECTION to §3 — I cited a code comment as traffic evidence

§3 defended the Moe's bridge page by quoting its own source comment: "242 clicks @ position 4.5 over
90d". **Production disagrees.** Last 90 days:

```
0 clicks   525 impressions   position 6.9   /moes-tire-euclid
```

The comment is stale (written in the wave-181.x era). **I used tier-6 evidence (documentation) where
tier-2 (a production receipt) was available** — precisely the ladder the mandate's own §3 defines.
The claim as published in #1466 was wrong and is retracted here.

What survives, and what changes:

- **Survives:** the *reasoning* that these are a deliberate legacy-brand bridge, not a NAP conflict —
  the 301s, `sitemap:false` aliases and rebrand H1 are all still real and correct. Killing them "to
  fix NAP" remains wrong.
- **Changes:** the page is **not** a live-clicks asset. It holds 525 impressions at a strong position
  6.9 and converts none of them. Keep-or-kill is now a judgment call on merit, not an obvious keep.

### The finding that reframes the whole SEO stage

| URL | impressions | clicks | avg position |
|---|---|---|---|
| `/` | 15,394 | **120** | 11.0 |
| `/oil-change` | 13,729 | 5 | 33.6 |
| `/brakes` | 12,806 | 2 | 36.4 |
| `/diagnostics` | 4,625 | **0** | — |
| `/services` | 1,623 | 9 | 4.7 |
| `/tires` | 1,554 | 13 | 23.0 |
| `/euclid-auto-repair` | 882 | 0 | 13.2 |
| `/reviews` | 721 | 0 | 7.9 |

- **The entire site earns roughly 168 organic clicks per 90 days — about 1.9 per day — and the
  homepage is 120 of them (71%).**
- **Only 75 distinct URLs have ANY search presence** across four months, against 194 registered
  routes and 339 prerendered directories. So on the order of 260 pages drew zero impressions.
- The high-impression pages sit at **positions 33-36**, which is page 3-4: seen by the index, never
  clicked by a human.
- **Comparison pages earn essentially nothing:** `/best-tire-shops-cleveland` 1 click,
  `/nicks-tire-vs-mavis-cleveland` 0 clicks / 17 impressions, `/conrads-tire-alternative-cleveland`
  0 clicks / 13 impressions. (Note: the `LIKE '%compare%'` filter returned no rows because these live
  at flat slugs, not under `/compare/` — a reminder to check the URL shape before reading a zero.)

**Consequence for mandate 9 stage 5.** Its premise is that schema, crawlability and raw-HTML coverage
are the levers. §4 already showed all three are in good shape — and this table shows why that didn't
help: **the constraint is ranking position, not technical eligibility.** Adding more programmatic
pages to a farm that already ranks at position 33 cannot work; neither can markup that Google says it
doesn't need. That is a content-authority and local-prominence problem, and it is the operator's
strategic call rather than an agent's refactor.

**Deliberately not concluded:** none of this justifies mass deletion. Google's own guidance is that
404s are not a negative quality signal, but removing pages also recovers nothing except maintenance,
and impressions are real query presence. The honest read is that the farm is **inert**, not harmful.

## 5 · What this pass did NOT do, and why

- **No public page was deleted or redirected.** Per-URL traffic evidence is not available in this
  session (Ahrefs/Supermetrics connectors unauthenticated; per-page history lives in the in-house
  `search_performance` table, which is prod and operator-gated). Every deletion above is admin-only
  and therefore has no URL and no traffic by construction.
- **No DB index or table was touched.** The mandate's own hard stop #4 requires an INVISIBLE canary
  period, and index-usage evidence needs prod introspection.
- **The `DRY_RUN` default-ON kill switch (stage 1.3) was NOT built.** Defaulting it ON would silence
  live customer SMS **including appointment reminders and confirmations**, causing no-shows at a
  live shop. The safe shape is the same switch defaulting **off in prod, on in dev/test** — operator
  decision, logged in `NICKSTIRE-ACTION-REQUIRED.md`.
- **No service consolidation.** The 230-service merge clusters need the consumer map first; that is
  the next evidence slice, not a same-session refactor.
