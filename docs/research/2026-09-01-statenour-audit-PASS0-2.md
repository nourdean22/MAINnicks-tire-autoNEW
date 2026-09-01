# StateNour Deep Audit - PASS 0-2

**Source-of-truth snapshot, route/surface inventory, and control-wiring audit.**

Read-only audit. No code, config, schema, branch, or database was modified.
This is the first of several increments; PASS 3-10 follow separately.

---

## 0. HOW TO READ THIS

Evidence classes are marked on every material claim:

| Class | Meaning |
|---|---|
| **A** | Verified current code (named file + line on a pinned SHA) |
| **C** | Verified runtime behavior (live HTTP probe against production) |
| **H** | Inference / hypothesis - explicitly not verified |
| **I** | Unknown / not verified |

Anything not investigated says so. There are no filler sections.

---

## 1. PASS 0 - SOURCE OF TRUTH

### 1.1 The snapshot everything below is pinned to

| Fact | Value | Class |
|---|---|---|
| Audited ref | `origin/main` @ **`0e6d2301cd19aaef34e22dc6f24a529eb1333bf3`** | A |
| Ref commit time | 2026-09-01 14:07:06 -0400 | A |
| Remote verified live | `git ls-remote origin refs/heads/main` = same SHA at 15:59 EDT | A |
| Audit window | 2026-09-01 15:59 - 16:40 EDT | - |
| Repository | `nourdean22/MAINnicks-tire-autoNEW` | A |
| Deploy target | Railway, `bdnick.info` | A |

### 1.2 Production is running exactly the audited commit

`GET https://bdnick.info/api/version` (public by design) returned:

```
commit: 0e6d2301cd19aaef34e22dc6f24a529eb1333bf3
branch: main   environment: production
deploymentId: f5542af3-5234-439c-ae2d-f00bb53b6641
startedAt: 2026-09-01T18:11:10Z (= 14:11 EDT)   uptime: 6574s
configured: database=true ai=true telegram=true cron=true
            langfuse=FALSE  sentry=FALSE
```
Class **C**.

**This is the single most useful fact in PASS 0.** Production HEAD == audited
tree. Every code-level finding below is a finding about the running product,
not about a branch. It also means the deploy that went live at 14:11 EDT is
`#2053`, four minutes after that PR merged.

Two configured-flags are worth flagging on their own: **`langfuse: false` and
`sentry: false` in production.** Whatever AI tracing and error reporting exist,
those two are not receiving data in prod. (Class C for the flag values; what
that disables is Class I - not investigated in this pass.)

### 1.3 THE WORKING CHECKOUT IS STALE - read this before trusting any local file

| Ref | SHA | Time |
|---|---|---|
| Local `HEAD` (`statenour/hard-delete-guard-wiring`) | `6e1114e2b` | 11:13 EDT |
| Local `main` | `81d1cafb0` | 11:29 EDT |
| **`origin/main` (= production)** | **`0e6d2301c`** | **14:07 EDT** |

Local HEAD is **3 commits behind** production:

- `81d1cafb0` - hard-delete guard (#2050)
- `8f445fbb6` - **Missions becomes the Execution Deck (#2052)**
- `0e6d2301c` - deck self-audit follow-up (#2053)

Consequence: **the Missions rewrite has already merged and deployed.** 44 files
differ between the local tree and production under `apps/statenour`, including
7 mission components deleted (`level-up-modal`, `missions-health-strip`,
`missions-rescue-strip`, `nicks-morning-brief`, `top-mission-today`,
`xp-particle`) and 6 deck components added.

I audited `origin/main` throughout, read directly from the git object store, so
this document describes production rather than the stale checkout.

### 1.4 Concurrency state at audit time

Four other sessions were live in this repo. Three were disclosed to me (Home UI
rewrite; Missions + Settings; master-prompt rewrite); a fourth began disk
cleanup mid-audit.

`git worktree list` shows **15 worktrees**. Nine hold unmerged commits:

| Worktree branch | Commits ahead of origin/main |
|---|---|
| `nickstire/reel-pipeline-contract-2026-08-31` | 5 |
| `statenour/chat-completion` | 4 |
| `statenour/close-the-loops` | 3 |
| `statenour/chat-ui-sweep` | 2 |
| `statenour/e2e-warm-wedge`, `statenour/soft-delete-and-gate-order`, `statenour/journal-settings-surfaces`, `nickstire/knip-orphan-gate`, `nickstire/reel-0113-prod-receipt`, `nickstire/disclosure-defaults-on`, `docs/finish-pass-observer` | 1 each |
| `claude/uncommitted-unfinished-work-9e60f2`, `integration-audit` | 0 (merged) |

### 1.5 OPERATIONAL INCIDENT observed during the audit

**C: drive reached 0 bytes free** at 16:05 EDT (`Get-PSDrive C` -> `Free: 0`).
Measured consumers:

```
10,551 MB  NOURCITY/.worktrees          (12 worktrees)
 1,944 MB  NOURCITY/.claude/worktrees   (3 worktrees)
 1,534 MB  NOURCITY/graphify-out
 1,015 MB  NOURCITY/.git
   844 MB  AppData/Local/Temp
   441 MB  apps/statenour/.next
```

This matters beyond housekeeping: the agent-memory entry
`statenour-home-command-surface-2026-09-01` already records that *"C: hit 0
bytes free - exit-134s were the full disk."* The same condition recurred today.
A full disk on this machine presents as V8 aborts (exit 134 / 0xC0000409) in
vitest, not as a disk error, so **any red test result reported by a sibling
session during this window should be re-run before being believed.**

By 16:40 EDT the cleanup session had recovered it to 117 MB free.

**Do not blanket-delete `.worktrees`** - 9 of them hold unmerged commits, and
worktree `node_modules` are NTFS junctions pointing *out* of the tree. Teardown
must go through `scripts/worktree-teardown.ps1`.

---

## 2. PASS 1 - SURFACE INVENTORY

All counts derived from `git ls-tree -r origin/main`. Class **A**.

| Surface class | Count |
|---|---|
| Page routes (`app/**/page.tsx`) | **37** |
| API routes (`app/**/route.ts`) | **380** |
| Route groups | 1 (`(mastery)`) + `auth` |
| Layouts | 2 (`app/layout.tsx`, `app/(mastery)/layout.tsx`) |
| Middleware | 1 (global, auth + CSP) |
| tRPC routers | 32 files under `lib/trpc/routers/` |
| UI components (`.tsx` in `components/` + `features/`) | **274** |

### 2.1 Page routes (37)

**Top-level operator surfaces (18)** - all under `(mastery)`:
`/` (Home), `/chat`, `/missions`, `/journal`, `/brain`, `/goals`, `/settings`,
`/people`, `/decisions/[id]`, `/learn`, `/links`, `/market`, `/business`,
`/content`, `/pins`, `/scoreboard`, `/stats`, `/photo-improver`

**Intelligence sub-surfaces (2):** `/intelligence/brief`, `/intelligence/ledger`

**System / admin sub-surfaces (16):** `/system` plus `actions`, `ai-cost`,
`alerts`, `calibration`, `camera`, `chat-states`, `cockpit-observability`,
`crons`, `fleet`, `health`, `inbox`, `logs`, `proactive-preview`,
`schema-history`, `tools`

**Auth (1):** `/auth/sign-in`

**Observation (Class A, judgment):** 16 of 37 page routes - 43% of the entire
page surface - are `/system/*` admin/observability pages. That is the single
largest concentration in the product, and it is not the operator's daily
surface. PASS 7 will test whether that ratio is defensible; it is flagged here
as a fact, not yet a verdict.

### 2.2 API routes (380) by area

```
/api/system      ~90    /api/cron        ~55    /api/brain      ~40
/api/ai          ~22    /api/ultron       13    /api/sync        ~9
/api/devices       8    /api/internal      6    /api/research     5
/api/journal       6    /api/intelligence  6    /api/webhooks     4
```
(remainder spread thin across ~40 single-route areas)

### 2.3 IN-FLIGHT surfaces - snapshot only, do not treat as settled

Per your framing, these are under active reconstruction by sibling sessions.
Findings on them are a **16:00 EDT snapshot of a moving target**, and I have
separated "broken" from "mid-rewrite" wherever it applies:

- **Home** (`app/(mastery)/page.tsx` + `components/home/*`) - IN FLIGHT
- **Missions** (`app/(mastery)/missions/page.tsx` + `components/missions/*`) -
  **merged and deployed today** (#2052/#2053) but a sibling session is still
  working the area. Treat as IN FLIGHT.
- **Settings** (`app/(mastery)/settings/page.tsx`) - IN FLIGHT

I deliberately weighted effort *away* from these three and toward the
boundaries that survive a UI rewrite: middleware/auth, route policy, the
wiring graph, and the test-coverage shape.

---

## 3. PASS 2 - CONTROL-WIRING AUDIT

This is Section 9 of the program and, per your standing priority, the section
that matters most. Method is stated first so the numbers can be checked.

### 3.1 Method, and a bug I found in my own instrument

I built an import graph over `origin/main` and computed **transitive
reachability from Next.js entrypoints** (every `page/layout/route/template/
error/loading/not-found/default` file, plus `middleware.ts`, `auth.ts`,
`instrumentation.ts`). "Has at least one importer" is *not* sufficient
evidence - an island cluster that imports itself has importers and is still
dead. Reachability from an entrypoint is the real test.

**First run reported 76 of 274 components (27.7%) unreachable. That number was
wrong and I discarded it.** Spot-checking six of the claimed orphans against
raw grep showed all six were imported normally via *relative* paths.
Root cause: `os.path.normpath` returns backslash-separated paths on Windows, so
every relative-import edge silently failed to resolve. Switching to
`posixpath.normpath` took unresolved specifiers from thousands to **2** and the
graph from 1,213 to 1,553 reachable modules.

Final graph: **5,833 resolved edges, 2 unresolved specifiers, 423 entrypoints.**

This is recorded rather than quietly fixed because it is the exact defect class
this audit exists to find: a measuring instrument that produces a confident,
plausible, wrong number. The 27.7% figure would have survived review.

### 3.2 Result

**18 of 274 UI components (6.6%) are unreachable from any entrypoint.**

I then checked each of the 18 individually for dynamic imports, string-keyed
registries, and barrel re-exports. Three resolved differently:

- `components/layout/page-header.tsx` - **FALSE POSITIVE.** It is imported by
  `app/not-found.tsx`, which my entrypoint regex missed (it requires an
  intermediate directory, and `not-found.tsx` sits at `app/` root). It is wired.
- `components/3d/canvas-inner.tsx` is imported by `scene-canvas.tsx` via
  `next/dynamic` - correctly resolved, and dead only because its *parent* is.

Corrected: **17 genuinely unreachable components**, in four clusters.

### 3.3 FINDING W-1 (HIGH) - the retired bell was replaced by a ticker that is mounted nowhere

This is the cleanest instance of your recurring failure mode I found, and it
has three compounding layers.

**Layer 1 - the component is dead.** `components/hud/global-top-ticker.tsx` has
**zero import statements anywhere in the repo.** Grep for the symbol
`GlobalTopTicker` across `app/`, `components/`, `features/` returns exactly two
hits: its own `export function` declaration, and one comment. (Class A)

**Layer 2 - the documentation asserts it is live.**
`app/(mastery)/layout.tsx:73-77` states:

> `v7.4 - Apr 29 - NotificationCenter (bell) RETIRED. Per Nour: "the whole`
> `free-floating bell thing is annoying - let's just have two persistent`
> `tickers feed me everything." Priority alerts now flow through the`
> `GlobalTopTicker; ambient brain signals flow through the BottomPulseTicker.`

The bell was removed. Its stated replacement channel for **priority alerts** is
`GlobalTopTicker`. Reading the layout's JSX body, the mounted children are
`SessionExpiryBanner`, `AmbientAura`, `ErrorBoundary`, `BottomTabBar`,
`MoreSheet`, `DeepModeNudge`, `MegaConfirmHost`, `BrainDumpModal`, `AppBadge`.
`GlobalTopTicker` is **not among them**. `BottomPulseTicker` *is* live (mounted
inside `BottomTabBar`). So the ambient half of that sentence is true and the
priority half is not. (Class A)

**Layer 3 - a green test guards it, and structurally cannot detect this.**
`tests/components/mobile-a11y.test.tsx` covers "A3 - ticker min-height >= 32px
on mobile" and "A6 - top + bottom tickers have `role="region"`". Its own header
comment says: *"GlobalTopTicker hides on `/` so we read its source."* The
assertion is `readFileSync` + `toContain` on the component's **source text**. A
file's text is unchanged by nothing rendering it, so the test passes forever
regardless of whether the component is mounted. (Class A)

**Net:** priority alerts appear to have no surface. Also dead by consequence,
since their only importer is this dead parent: `components/ultron/top-strip/
ticker.tsx` and `components/ultron/top-strip/hq-status-chips.tsx`.

**Not verified (Class I):** whether priority alerts reach the operator by some
*other* channel entirely - push notification, Telegram, the `AppBadge` count.
`AppBadge` is live and does surface a pending-approval count. Confirming
whether anything replaced the priority-alert path needs a runtime session,
which read-only mode did not permit. **Do not read this finding as "you are
receiving no alerts" - read it as "the documented alert surface is not
mounted."**

### 3.4 FINDING W-2 (MEDIUM) - three dead component islands

Each is a self-consistent cluster with zero entrypoint reachability. All Class A.

| Cluster | Files | Entry component | Import statements pointing at the entry |
|---|---|---|---|
| 3D scene | `3d/scene-canvas`, `3d/canvas-inner`, `3d/scene-skeleton` | `scene-canvas` | **0** |
| Actions/loops | `actions/loop-stream`, `actions/loop-row-item`, `actions/break-promise-modal`, `actions/event-timeline`, `actions/todays-compound` | `loop-stream` | **0** |
| Ultron HUD | `ultron/contradictions-card`, `ultron/signal/situation-card`, `ultron/today/active-task-companion`, `ultron/today/next-action-whisperer`, `ultron/ask/omni-capture`, `ultron/top-strip/ticker`, `ultron/top-strip/hq-status-chips` | (several) | **0** each |

Notes that change how these should be handled:

- The 3D cluster is still referenced by `next.config.ts:90` (a webpack/transpile
  note naming `scene-canvas.tsx`). Build config is carrying a dead feature.
- `ultron/ask/omni-capture.tsx` is **a duplicate implementation.** The live
  surface is a different file: `app/(mastery)/missions/page.tsx:31` imports
  `@/components/actions/omni-capture-modal`. Two omni-capture implementations
  exist; one is wired, one is not.
- `components/operator/compound-chain.tsx` is unreachable **while its backend is
  fully alive** - `lib/services/compound-chain.ts` plus
  `app/api/operator/compound/route.ts`. Service and endpoint shipped; the UI
  that would consume them never got mounted.

### 3.5 FINDING W-3 (HIGH) - the ultron cluster's only "coverage" is source-text assertions

Six of the seven dead Ultron components are referenced *only* by
`tests/components/mobile-a11y.test.tsx` and `tests/meta/stale-docs-gate.test.ts`,
and in both cases via `readSource(...)` / `readFileSync(...)` string matching -
never by rendering, and never by a route. Examples (Class A):

```
mobile-a11y.test.tsx:341  expect(readSource("components/ultron/contradictions-card.tsx")).toContain(collapseToMin)
mobile-a11y.test.tsx:345  expect(readSource("components/ultron/signal/situation-card.tsx")).toContain(overlayOnWH)
mobile-a11y.test.tsx:346  expect(readSource("components/ultron/today/next-action-whisperer.tsx")).toContain(overlayOnWH)
mobile-a11y.test.tsx:347  expect(readSource("components/ultron/today/active-task-companion.tsx")).toContain(overlayOnWH)
```

The test file is honest about the tradeoff in its own header (the vitest env is
Node, no jsdom, so it asserts class strings instead of rendering). The problem
is not dishonesty - it is that **a source-text assertion cannot distinguish a
correctly-styled live component from a correctly-styled dead one.** The
accessibility suite currently reports green on components no route mounts.

This is the repo's own documented `DEFECT-SHAPE-ORPHANED-SUBJECT` /
"silent instrument" pattern, occurring inside the test suite meant to catch it.

### 3.6 FINDING W-4 (P0, SECURITY) - live unauthenticated bypass of the session gate

**Verified against production, not inferred.**

`middleware.ts:55`:

```ts
if (pathname.includes(".") && !pathname.startsWith("/api/")) return allow();
```

Intent: let static files through. Actual effect: **any non-API path containing a
dot bypasses the NextAuth session gate entirely.** `allow()` is a pass-through -
it does not check `req.auth`.

Live probes against `bdnick.info` @ `0e6d230`, unauthenticated (Class **C**):

| Path | Result |
|---|---|
| `/decisions/1` | 307 -> `/auth/sign-in` (correct) |
| **`/decisions/1.2`** | **200 OK** |
| `/decisions/0.1` | **200 OK** |
| `/decisions/abc.def` | **200 OK** |
| `/missions` | 307 -> `/auth/sign-in` (correct) |
| `/missions.x` | 404 (no such route) |
| `/brain/a.b` | 404 (no such route) |

`/decisions/[id]` is the only dynamic **page** route, so it is the only
currently reachable instance.

**Blast radius today is limited, and the reason is an accident.** The page is a
client component whose data fetch is
`trpc.operator.decisionDetail.useQuery({id}, { enabled: idValid })` with
`idValid = Number.isInteger(numericId) && numericId > 0`. An id containing a dot
is never an integer, so the query is disabled and never fires. Independently,
`/api/trpc` is not on the public allowlist and would 401 anyway. I confirmed the
anonymous response body contains the app shell and RSC/client-chunk payload -
nav labels "Home / Chat / Missions / Journal / More", the Command Palette
string - and **no decision data**. (Class C)

So: **information disclosure of the authenticated shell and client bundle to
anonymous users, not a data breach.** Every page in this product is meant to be
behind auth, so the bundle was never intended to be anonymously readable.

**The reason to treat this as P0 is not today's blast radius - it is that the
containment is coincidental.** The dot-requirement and the integer-requirement
happen to be mutually exclusive *for this one route*. The guard is one route
away from leaking real data: any future page route whose dynamic segment
legitimately accepts a dotted value - a slug, filename, email, semver, domain,
or version string - becomes an unauthenticated data path the moment it ships,
with no test failing.

### 3.7 FINDING W-5 (HIGH) - the security canary cannot see the bug in the boundary it guards

`lib/security/route-policy.ts` extracted the public-route classifier out of
middleware, with an explicit rationale in its header: *"so the security boundary
is unit-testable WITHOUT importing the NextAuth runtime."* `tests/security/
route-policy.test.ts` is a genuinely good test of that classifier - it pins `/`
and `/api/health` closed, guards against prefix bleed, and cites the specific
audit findings it exists to prevent regressing.

Its complete import list is (Class A):

```ts
import { describe, it, expect } from "vitest";
import { isPublic, PUBLIC_EXACT } from "@/lib/security/route-policy";
```

It never imports `middleware.ts`. It asserts `isPublic("/missions") === false` -
and that assertion is *true*. The middleware then separately allows the request
via line 55 if the path contains a dot. **The test's subject is the helper's
verdict, not the boundary's actual allow/deny decision.**

The extraction moved *part* of the security boundary into a testable unit, and
the untested remainder is the part that is broken. Per the repo's own
`gate-subject-coverage` rule - "a gate is only as wide as its file list: assert
the SUBJECT, not just the verdict" - this is a subject-coverage failure, and the
canary-pair convention does not catch it, because the canary tests the wrong
subject rather than testing it wrongly.

### 3.8 API route reachability - what the numbers do and do not support

I ran the inverse analysis and am reporting it with its limits, because the
headline number is misleading in both directions.

| Corpus searched for a matching `/api/...` string | Routes with no reference |
|---|---|
| `apps/statenour` only, code + docs | 127 / 380 (33%) |
| **Whole monorepo, code + docs** | **13 / 380 (3.4%)** |
| Whole monorepo, **code only** (excl. `.md`) | 194 / 380 (51%) |

**None of these three numbers is "the number of dead routes,"** and I am not
going to present one as if it were:

- The 33% figure is wrong because many routes are called from *outside*
  `apps/statenour` - `apps/worker`, `apps/nickstire`, `local-agent/`, scripts.
- The 3.4% figure over-credits, because a route mentioned only in a markdown
  doc counts as "referenced."
- The 51% figure over-counts, because a large set of routes is **external-caller
  by design** and correctly has no in-repo caller: `/api/webhooks/*`,
  `/api/telegram/webhook`, `/api/internal/runner/*` (device runner),
  `/api/devices/*`, `/api/sync/*` (bridge), `/api/actions/*` (GPT Actions),
  `/api/mcp`, and all `/api/cron/*` (external scheduler).

The defensible statement: **13 routes have no reference anywhere in the
monorepo, in code or docs** (Class A):

```
/api/ai/home-brief              /api/ai/scoreboard-brief
/api/brain/identity-projection  /api/cron/agent-followups
/api/health/governor/today      /api/journal/metacognition
/api/research/notebooklm        /api/research/perplexica
/api/research/status            /api/system/anticipated
/api/system/error-lookup        /api/system/seed-domain-missions
/api/webhooks/inbound-crm
```

Caveats on that list, stated rather than buried:
- `/api/webhooks/inbound-crm` is external-caller by design; expect no reference.
- `/api/ai/home-brief` sits on the **IN FLIGHT** Home surface and may be
  mid-rewrite rather than dead.
- `/api/cron/agent-followups` independently matches a **known open item** already
  recorded in agent memory as a pre-existing prod policy gap - consistent, not new.
- The `/api/research/*` trio is notable because `perplexica` is documented as a
  live dependency. Whether these are dead or called from an unscanned surface is
  **Class I - not verified in this pass.**

### 3.9 What is genuinely strong here (stated because an audit that only finds faults is miscalibrated)

- **`scripts/verify-crons.ts` is a real bidirectional gate.** It asserts every
  manifest entry has a route file *and* every `app/api/cron/*` directory has a
  manifest entry - explicitly "no dark code." This is exactly the discipline
  missing elsewhere, already implemented, in the highest-fan-out area (55 cron
  routes). It should be the template for the UI-mount gate proposed below.
- **`middleware.ts` is fail-closed on missing auth config in production**, with a
  documented pre-v10.1 incident where it failed *open*. The CSP is nonce-based
  with `strict-dynamic`, single-sourced in middleware with a comment explaining
  why a second CSP source in `next.config.ts` was removed.
- **The matcher regex is end-anchored** with a comment recording the exact bug
  that motivated it (unanchored extension matching let `/api/x/y.png/laws` skip
  auth). The team has already fixed this bug class *once*, one line above the
  place where it still survives in a different form.
- **`route-policy.ts` carries a stated invariant per entry** - every public path
  must either serve public data or run its own auth - and the file documents two
  prior prefix-bleed incidents that produced the trailing slashes on
  `/api/short/` and `/api/actions/`.

### 3.10 Dual data-access pattern (observation, not yet a verdict)

`/system/*` pages call **both** tRPC and raw `fetch` in the same file (Class A):

| Page | tRPC calls | raw fetch / authedFetch |
|---|---|---|
| `/system` | 7 | 9 |
| `/system/actions` | 6 | 7 |
| `/system/crons` | 7 | 2 |
| `/system/health` | 2 | 1 |
| `/system/alerts` | 2 | 2 |
| `/system/logs` | 1 | 2 |
| `/system/tools` | 1 | 1 |

This is a **partially completed migration with both paths live**, which is the
honest reading - not "62 dead REST routes." Each legacy REST endpoint remains
mounted and auth-gated, so each is maintained surface and attack surface.
Quantifying the true overlap requires mapping each tRPC procedure to its REST
twin; that is **PASS 8 work and is not done here.**

---

## 4. WHAT I DID NOT INVESTIGATE

Stated explicitly, per your instruction that a fixed report template must not
manufacture filler.

| Area | Status | What it would take |
|---|---|---|
| **Runtime behavior of any authenticated control** | **NOT VERIFIED** | Read-only mode forbids clicking mutating controls. Every finding above is code + unauthenticated HTTP. Verifying handler -> API -> DB -> UI end to end needs an authenticated session and write permission. |
| Database schema, migrations, indexes, N+1 | NOT INVESTIGATED | PASS 8; needs Prisma schema review + query-plan access |
| Auth/session lifecycle beyond middleware | PARTIAL | Only the middleware gate was audited. NextAuth config, session duration, device management untouched. |
| Background jobs / Inngest / retries / idempotency | NOT INVESTIGATED | 55 cron routes + Inngest fan-out; deferred to a later pass |
| PWA, service worker, offline behavior | NOT INVESTIGATED | - |
| Performance, bundles, Core Web Vitals | NOT INVESTIGATED | Needs a build + profiling run; blocked by the disk incident |
| Accessibility beyond the a11y test's own shape | NOT INVESTIGATED | Manual keyboard/SR testing needs a live session |
| Brain / memory / RAG quality | NOT INVESTIGATED | PASS 18; needs corpus access |
| Nick agent permissions and side effects | NOT INVESTIGATED | PASS 15; the highest-consequence remaining area |
| Product-boundary violations (nickstire leakage) | NOT INVESTIGATED | PASS 6. `/api/nickstire/query`, `/api/webhooks/nickstire`, `/api/customer-360/*`, `/api/system/tire-stock-requests`, `/business`, `/market` are the surfaces to examine. Named here so the next pass has a start list, **not** assessed. |
| Domain model / ontology | NOT INVESTIGATED | PASS 4 |
| Competitive / OSS / frontier research | NOT STARTED | PASS 5 - deliberately deferred; the program forbids starting there |

**Sections cut from the 56-item template for this increment**, because
investigating them was not possible read-only and writing them anyway would be
exactly the failure mode you warned about: 19-22 (wireframes, interaction
flows, state matrices), 30 (gamification verdict), 35 (attention budget),
41-46 (benchmarks, OSS landscape, dependency budget, standards matrix).

---

## 5. CONFIDENCE AND WHAT WOULD CHANGE MY MIND

| Finding | Confidence | Falsified by |
|---|---|---|
| W-4 auth bypass exists | **HIGH** - live probe | Nothing; reproducible via `curl -o /dev/null -w '%{http_code}' https://bdnick.info/decisions/1.2` |
| W-4 leaks no decision data | **MEDIUM-HIGH** | A page route accepting dotted ids that *does* fetch; or a server component in the shell fetching user data |
| W-5 canary blind spot | **HIGH** - complete import list read | Nothing |
| W-1 GlobalTopTicker dead | **HIGH** - 2 total symbol occurrences | A string-keyed dynamic registry I did not find |
| W-1 "priority alerts have no surface" | **MEDIUM** | An alternate live alert channel (push / Telegram / AppBadge). Explicitly not verified. |
| W-2/W-3 dead islands | **HIGH** for the graph; **MEDIUM** for "should be deleted" | Any is a deliberate parked feature awaiting re-mount |
| 17 unreachable components | **HIGH** | Would need a resolution mode beyond the 2 unresolved specifiers |
| API-route dead counts | **LOW as a single number** - reported as a range with reasons | Mapping external callers in `local-agent/`, `camera-bridge/`, `apps/worker` |

---

## 6. IMMEDIATE ACTIONS SUGGESTED BY THIS PASS ONLY

Ordered by evidence strength times consequence. No implementation was done.

1. **Fix `middleware.ts:55`.** Replace the `includes(".")` test with the same
   end-anchored asset-extension pattern already used in the `config.matcher`
   regex directly below it. The correct pattern is already in the file.
2. **Extend the canary to the real subject.** Add a test that exercises the
   middleware's allow/deny decision - not `isPublic` alone - and asserts
   `/decisions/1.2` is denied. Per the repo's own doctrine, break it first and
   prove it fails.
3. **Decide W-1: mount `GlobalTopTicker`, or delete it and correct the layout
   comment.** The current state is the worst of the three, because the comment
   documents a channel that does not exist.
4. **Add a UI-mount gate modeled on `verify-crons.ts`** - assert every component
   under `components/` is transitively reachable from an entrypoint, with an
   explicit allowlist for deliberately parked files. `verify-crons.ts` already
   proves the team can build this; it just has not been pointed at the UI tree.
5. **Triage the 17 unreachable components** into delete / re-mount / parked, and
   remove the dead `scene-canvas` reference from `next.config.ts:90`.
6. **Investigate `langfuse: false` / `sentry: false` in production** - if AI
   tracing and error reporting are intended to be on, they are not receiving data.

---

*PASS 0-2 complete. PASS 3+ to follow. Every claim above is pinned to
`origin/main @ 0e6d2301c`, which was production at the time of audit.*
