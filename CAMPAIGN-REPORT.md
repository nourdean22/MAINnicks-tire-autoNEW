# Campaign report — consolidation mandate, 2026-08-09

The mandate's §7 artifact. Companions: [`AUDIT/2026-08-truth.md`](AUDIT/2026-08-truth.md) (the gate),
[`EXECUTION-LOG.md`](EXECUTION-LOG.md) (chronology), [`BLOCKED.md`](BLOCKED.md),
[`NOUR-ACTION-REQUIRED.md`](NOUR-ACTION-REQUIRED.md) (operator queue).

**Seven PRs merged. The gate was the highest-value part of the campaign:** fifteen load-bearing
claims in the mandate and its successor documents were false, and the two largest deletions were
each safe only because something outside the source code — a provider API, then production itself —
contradicted what the source code implied.

The gate's value is easiest to see in what did **not** happen: the mandate's delete lists, executed
literally, would have severed live VAPI webhooks, cut the working nickstire↔statenour bridge, and
removed three functioning operator pages. Every one of those was stopped by checking rather than
trusting, and the checks cost less than any one of the repairs would have.

## What shipped

| PR | What | Receipt |
|---|---|---|
| #1458 | Auth-tier coverage contract for nickstire's 90 tRPC routers; PAT stripped from `.git/config`; the gate's truth doc | `tsc` 0 errors; **430 test files / 5,240 tests passed, exit 0**; +341 / -4 |
| #1459 | VAPI ground truth recorded | docs |
| #1460 | The dead statenour vapi lane deleted — 4 routes, 2 helpers, 1 whitelist entry | `typecheck` 0, `lint` 0 errors; **459 files / 4,996 tests passed, exit 0**; +20 / **-1,020** |
| #1461 | Consent ledger wired at the `sendSms` chokepoint, shipped in shadow | 10/10 new tests; sibling SMS suites 5 files / 102 passed; `typecheck:raw` exit 0; +361 / -13 |
| #1462 | Stage-1.7 closed; the eleventh falsified claim recorded | docs |
| #1463 | Campaign wave closed — 4 unrecorded verdicts, failure mode 8, ROS-095/096 | docs |
| #1465 | The dead `nourOsQuote` lane + the dead `lib/eval` harness deleted; PII blind spot closed; Stages 5.1/5.5 gated | `tsc` exit 0 both apps; router-tree tests 31/31; statenour 36/36; `build:affected` 8/8; lint-pii `clean (780 files)`; **-2,296** |

Outside the repo: all **5 orphan VAPI tools deleted** at the provider (`tools remaining: 0`).

## What was deleted

| Item | Count |
|---|---|
| statenour API route files (the vapi tool lane) | 4 (762 lines) |
| statenour library helpers, route-only by import grep | 2 (249 lines) |
| Security whitelist entry + its test fixture | 2 |
| Total lines removed in #1460, against 20 added | **1,020 across 10 files** |
| VAPI account tools, all orphaned | 5 (external, not code) |
| Plaintext credentials in `.git/config` | 1 |
| nickstire tRPC router (`nourOsQuote`, 5 public procedures) | 1 (156 lines) |
| statenour eval regression harness + its test + its private dataset | 3 (2,140 lines) |
| Dead `it.skip` test, tracked 0-byte `scratch/font.ttf` | 2 |
| Total lines removed in #1465, against 60 added | **2,296 across 19 files** |

statenour API routes went **378 → 374**. nickstire tRPC routers went **90 → 89**, and its pinned
public-procedure allowlist **82 → 77**. Estate counted from the filesystem at report time, not from
any document: statenour 374 API routes / 38 pages; nickstire 89 tRPC routers / 198 client page files.

**Total deleted across the campaign: ~3,470 lines**, every one of them with a citation.

## Where I was wrong

**The costliest error was mine, not the mandate's.** I read the four statenour vapi routes end to end
and reported them as live customer-facing lanes, warning that deleting them would break calls from
stranded drivers. The code fully supported that reading — secret verification, a Telegram alert to
the shop, comments describing a warm transfer on the hot path. The VAPI account API then showed every
tool was an orphan attached to no assistant, three pointing at `autonicks.com` (a dead Vercel
deployment), and the live number running entirely through nickstire. Those routes had never received
a call. Recorded as failure mode #8 in [`docs/UPSTREAMS.md`](docs/UPSTREAMS.md): **code that describes
live behaviour is not evidence that it runs, and an absent caller in the repo is not evidence that
nothing calls it.**

Claims falsified in the mandate and its successor documents (full table in the truth doc §1):

| Claim | What the repository shows |
|---|---|
| `apps/voice` exists, never audited | Deleted 2026-08-03, five days before the mandate |
| Drizzle schema location unknown; `pgTable` grep returned zero | `drizzle/schema.ts`, **145 `mysqlTable`** — nickstire is TiDB/MySQL, so every Postgres-specific instruction was void |
| A 0-line page file is breaking the build | 635 implemented lines; builds |
| statenour has no Ollama provider | Ollama Cloud is its primary lane (UPSTREAMS row 75) |
| Auth tests, cron auth, webhook hardening, TCPA rails all missing | All four existed; the one real gap was nickstire's tRPC layer, which #1458 closed |
| The estate counts are stale (follow-up critique) | The "correction" came from May/June audit docs; the originals matched the filesystem |
| Ahrefs + Supermetrics are "decisive for the dead-page work" | Both authenticate and **neither can return a row** — Ahrefs is a trial with 0 API units, Supermetrics' trial expired 2026-05-17. The evidence was never external: nickstire ingests its own GSC into `search_performance` and already aggregates it by page |
| `lib/eval` and `lib/evals` are a duplicate pair to merge | Zero shared symbols. One was dead, the other has four live consumers; "keep the one with live imports" was incoherent because both had importers |
| Calibration requires a labeling habit the operator lacks (Stage 5.5) | Grading is **automated nightly** by `outcome-tracker.scorePendingPredictions`. Nothing to freeze |
| `/system/cockpit-observability` is an "18-line stub", delete it along with `/system/chat-states` and `/system/logs` (Stage 5.3) | The 18 lines are the **App Router page convention**. It wraps a **394-line** view. All three are live, linked from the system page, the settings ops hub, and keyboard shortcuts; `/system/logs` is 445 lines with its own API route. Deleting them would have removed working operator UI |

A second built-but-unwired case surfaced in the consent work: `logSmsOptIn()` had been writing
consent rows from three live doors while its reader `hasSmsOptIn()` had zero callers. Written, never
read, deciding nothing. The mandate also named the wrong file for the gate.

**Failure mode #8 then repeated in the opposite direction, and the same instrument settled it.**
Reviewing the auth-tier allowlist I treated `nourOsQuote.getQuote` as a possible IDOR — a bare
public string id returning a quote carrying customer name, phone and email. The reading was
defensible from the source. Production answered a different question: all five procedures return
HTTP 500, because they proxy to `/api/tires`, `/api/labor` and `/api/quotes` on bdnick.info and
**none of those routes exist**. It could not leak anything because it could not return anything.
Twice now the repo argued one way and the running system another; both times the running system
was right. That is the campaign's most reusable lesson, and it cuts in both directions — the repo
can make a dead thing look alive, and it can make a harmless thing look dangerous.

**The last finding came from refusing to merge over a red check.** CI's `e2e · statenour` was
failing, and the failing tests were a sibling session's, in files this PR never touched — the easy
read was "not mine". It had been red on `main` for five consecutive runs, starting at the exact
commit that introduced the tests. Cause: the probe was handed to `page.evaluate` as a **string**,
which Playwright evaluates as an expression; a string containing `() => {...}` yields a function
object, which is not serializable, so `evaluate` returned `undefined` and every assertion threw on
`.found`. Measured, not inferred: `page.evaluate("() => ({found:true})")` → `undefined`;
`page.evaluate(() => ({found:true}))` → `{found:true}`.

Those two tests are the regression net for #1369 and #1371 — two bugs that put the chat composer
under the tab bar in one week — and `docs/UPSTREAMS.md` row 78 cited them as live coverage. **The
net had never executed once.** This is the estate's false-green failure mode in a new variant: not
built-tested-unwired, but built-merged-and-red, with the redness normalized because CI is advisory
and the branch has no protection. Fixed in this PR; row 78 corrected to say which half was real.

## Could not verify

- Whether the duplicate VAPI Receptionist assistant `afcad79e` is referenced from env vars or DB
  rows. Assistant IDs live outside the repo, so it was left in place.
- What share of the customer base carries a consent record — not knowable from inside the repo,
  which is exactly why the gate ships in shadow rather than armed.
- Per-route production usage for statenour. Prod DB access is operator-gated by standing rule, and
  the mandate's `pg_stat_user_tables` query applies only to Neon, not to nickstire's TiDB.
- ~~90-day traffic/ranking evidence for the legacy nickstire pages (Ahrefs connector
  unauthenticated).~~ **Re-tested and re-framed.** Both connectors now authenticate and both are
  unusable — Ahrefs has 0 API units and its verified Nickstire project returns empty GSC and empty
  web-analytics; Supermetrics' trial expired 2026-05-17. But the data is in-house: nickstire ingests
  Search Console into `search_performance` and `pipelines/gsc-data.ts:421` aggregates it by page,
  surfaced in `/admin` SEO tools. What remains unverified is only the *pull itself*, which is an
  operator-run query against prod, not a subscription.
- Whether widening the `lint-pii` console rule surfaces further real leaks. The blind spot is proven
  (one leak caught, a worse one on the adjacent line missed); the size of what it hides is not known
  without changing the rule, which is deliberately its own PR.
- Whether the 12 auth-gated statenour health routes have external monitors. Production shows they
  return 401 while `/api/system/heartbeat` returns 200 unauthenticated, which is why the Stage-5.1
  collapse was gated rather than executed — an uptime probe is invisible from inside the repo.
- **Whether the /chat geometry invariant actually holds.** The fix above makes the two tests *run*;
  it does not make them pass. They have never produced a real measurement, so the invariant is
  unmeasured rather than verified. If they fail now, that failure is the first genuine signal this
  guard has ever emitted and should be read as information, not as a regression from this PR.
- A full git-history secret scan — gitleaks is not installed and installs are policy-blocked here.
  Registered as ADOPT-CANDIDATE in `docs/UPSTREAMS.md`; it is what would finally size `ROS-011`/`ROS-012`.
- The LiveKit billing tier (console-only).
- That the generated campaign `.docx` opens in Word. Verified structurally (0 schema-order problems
  across `pPr`/`rPr`/`tcPr`/`tblPr`/`sectPr`, 9 well-formed parts, text round-trip) but never
  rendered — LibreOffice is not installed on this machine.

## Still blocked

Detail in [`BLOCKED.md`](BLOCKED.md). The remainder of stage 3 needs `packages/bridge-client` built,
rewired and proven before anything further is deleted — the mandate's own ordering. Stages 4-6 each
contain items the upstream register already answered, two of them answered the same day the mandate
was written, so every surviving line needs gating before any build.

Stage 5 is now gated rather than open: **5.1** (health-route collapse) is deferred with production
evidence — 12 of the 13 routes are 401-gated dashboards and one is the public liveness probe, so a
blind merge risked the infra healthcheck; **5.5** (freeze the calibration surfaces) is refuted
outright, because the labeling habit it assumes is already automated. Neither needs re-planning.
What is left of the mandate is mostly stage 3, and stage 3 is blocked on the operator, not on work.

## Handoff

[`NOUR-ACTION-REQUIRED.md`](NOUR-ACTION-REQUIRED.md) is the live list. Open items: revoke the GitHub
PAT (stripping it did not revoke it); decide the Deepgram key (prepaid, ~$199.998 parked, not
billing monthly); rotate LiveKit and check its billing tier; with counsel, decide whether to arm
`SMS_CONSENT_GATE=enforce` using `consentGateShadowMisses` as the input; review the duplicate VAPI
assistant; Custom GPT wiring, deferred by request. Added in session 3: two paid connectors that may
still be billing while returning nothing (Ahrefs trial at 0 units, Supermetrics trial expired
2026-05-17), and the `lint-pii` rule widening, which is one deliberate PR whenever you want it.
