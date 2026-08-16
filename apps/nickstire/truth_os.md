# Nick's Tire & Auto Current Truth

This compatibility entrypoint exists because repository instructions historically referenced `truth_os.md`.

The active operating contract is:

- [`docs/CURRENT-TRUTH.md`](docs/CURRENT-TRUTH.md)
- [`docs/METRICS-CONTRACT.md`](docs/METRICS-CONTRACT.md)
- [`docs/ISSUE-REGISTRY.md`](docs/ISSUE-REGISTRY.md)
- [`docs/REVENUE-OPS-ROADMAP.md`](docs/REVENUE-OPS-ROADMAP.md)
- [`docs/operations/SMS-REVENUE-AGENT-OS.md`](docs/operations/SMS-REVENUE-AGENT-OS.md) — operator runbook for the SMS Revenue Agent OS (2026-07-29 arc: levers, gates, daily loop, symptom table)

## What is ARMED in production — read this, do not quote it

**Nine of the ten flags that produce an external side effect are ON.** Read at
2026-08-16T11:53Z from the live `MAINnicks-tire-auto` service, not from a doc and
not from `.env`:

| flag | live | side effect when ARMED |
|---|---|---|
| `FEATURE_DECLINED_RECOVERY` | `1` | SMS · "you declined this work" follow-ups (ROS-093) |
| `FEATURE_VOICE_RECOVERY` | `1` | VOICE · outbound recovery calls |
| `FEATURE_CONFIRMATION_CALLS` | `1` | VOICE · outbound confirmation calls |
| `FEATURE_FOLLOWUP_CADENCE` | `1` | SMS · multi-touch follow-up cadence |
| `ENABLE_CUSTOMER_CONFIRMATIONS` | `true` | SMS · booking confirmations |
| `REEL_PUBLISH_ENABLED` | `true` | PUBLISH · reels to Instagram |
| `REEL_AUTOPOST_ENABLED` | `true` | PUBLISH · unattended posting |
| `REEL_COMMENT_RESPONDER_ENABLED` | `true` | PUBLISH · public replies to IG comments |
| `SOCIAL_INVENTORY_PUBLISH_ENABLED` | `true` | PUBLISH · inventory posts |
| `FEATURE_UNPAID_INVOICE_RECOVERY` | *(unset)* | SMS · unpaid-invoice chase — read the guard, `=== "1"` and `!== "false"` disagree about unset |

Four of these — the voice and cadence flags — had **never appeared in any
canonical doc** before 2026-08-16. They were not stale; they were absent. Nobody
reading this file would have known Nick was placing outbound calls.

**Regenerate, never retype:** `node scripts/probe-live-send-flags.mjs`. A flag
value written into a doc is a cache with no invalidation — on 2026-08-15 this
file asserted `FEATURE_DECLINED_RECOVERY=0` on the authority of
`docs/ISSUE-REGISTRY.md` while the service had it at `1` and the cron was sending.
`scripts/audit-feature-flag-state.ts` could not have caught it: it reads the
`feature_flags` DB table, and every flag above is an environment variable.

Two 2026-08-07 contracts worth knowing before you debug a quiet automation, both
detailed in `docs/CURRENT-TRUTH.md`:

- **Live IG publishing is gated by an independent judge, fail-CLOSED.** If the
  judge lane is unreachable, autoposting pauses loudly rather than publishing
  blind. Escape hatch: `IG_SHADOW_JUDGE=false`.
- **The AI receptionist prompt has a measurement loop behind it** (Call Ossuary →
  ghost replay → weekly optimizer). It only ever emits PROPOSALS — **Push Config
  is still the one serving gate**, and four prompt fixes reached the live line
  that way on 2026-08-07.
- **A weekly revenue digest now exists** (2026-08-07): Monday Telegram push of
  paid-invoice mirror revenue, WoW delta, repeat-revenue share and
  arrivals→invoice receipts — `server/cron/jobs/weeklyRevenueDigest.ts`,
  contract in `docs/CURRENT-TRUTH.md`. The weekly intelligence report
  previously never read `invoices` at all.
- **The ScanFinish wave landed (2026-08-13, #1552/#1553):** the reel lane's
  independent judge runs **shadow/log-only** (image-lane gate unchanged,
  fail-closed); reel brief feedback is REELS-first with a disclosed fallback;
  campaign-keyword comments get a no-DM public hand-off inside every existing
  responder gate; a read-only **SMS autonomy census** (declared ceiling vs live
  mode, registry-derived) sits under the Rollout Control Center; Today gained
  the **Arrival load** strip (walk-in planning signal — there is deliberately
  no calendar/slot model); and customer-touching "today" math moved off bare
  `CURDATE()` onto shop-time `getBusinessDateKey()`. Contracts + scope notes in
  `docs/CURRENT-TRUTH.md`; per-finding receipts in
  `docs/NICKSTIRE-SCAN-LEDGER.md`.
- **ScanFinish Run 2 landed same day (2026-08-13, #1558/#1561):** the reel
  lane now has a real **anti-repetition memory** (the autonomous daily brief
  regenerates on a topic that repeats the last 21 days of `reel_jobs`; the
  draft lane gets the same history as a soft `avoidTopics` steer); a
  **job-level free-lane fallback** closes Veo's zero-resilience gap (a
  terminal paid-provider verdict re-queues ONE forced `template_stock`
  attempt when `REEL_FALLBACK_TO_TEMPLATE_STOCK=true`, instead of publishing
  nothing); an **originality/QC checklist** runs shadow/log-only beside the
  judge (now incl. voiceover claim-safety and muted-first, one KV verdict per
  job); the **attention-microstructure swipe file** and a **multilingual dub
  worklist** render on the Learn admin page; and a curated **Local Discovery
  topic library** (Cleveland/Euclid, E-Check web-verified) feeds the topic
  miner — E-Check topics route through the government-evidence gate, never
  around it. `reel_jobs.payload` readers must use
  `shared/reelJobPayload.ts`'s `parseReelJobPayload()` (post-merge audit:
  ad-hoc inline payload types produced a structurally-dead field twice).
  Kling/LTX-2/TikTok Symphony: WATCH, deliberately not built. Contracts in
  `docs/CURRENT-TRUTH.md`; receipts + the audit-round-2 postmortem in
  `docs/NICKSTIRE-SCAN-LEDGER.md`.
- **An AEO proprietary-data price page exists** (2026-08-11):
  `/tire-prices-cleveland` publishes canon floors plus live per-size retail
  floors from the Gateway feed via public `gatewayTire.publicPriceRanges`
  (rounding parity with `publicSearch`, pinned). The daily
  `refreshGatewayPrices` cron now also persists the aggregated floors to
  `shop_settings.tirePriceFloors` so cold pods and prerender can serve them —
  retail only, wholesale never leaves the server. Live sections self-suppress
  when the feed is cold (canon floors render, never an empty table).

## 2026-08-16 - the reel lane's independent judge is readable, and its own gate doc was stale

**The reel lane has had an independent judge since 2026-08-13 and could not consult it.** NT-001
wired `judgeSingleConcept` into `dailyReelPost.ts` - one LLM call per about-to-publish reel, deduped
by a KV marker - and wrote the verdict to `shop_settings` as `reel_shadow_judge_<jobId>`. Nothing
ever read it: two references in the whole repo, both in the writing file, and the only read is
`if (!alreadyJudged)`, a boolean. The judgment was bought and discarded.

**Why the image lane could flip its gate and this one could not.** `igAutopost` persists verdicts to
`ig_autopost_log`, a queryable log table, and ships a reader (`scripts/ig-dual-judge-readout.ts`).
That is how the measured 5/25 blind-spot readout existed to justify the 2026-08-07 flip. The reel
lane put the same measurement in the settings KV and shipped no reader - same signal, wrong
substrate. Now readable via `server/services/reelShadowReadout.ts` (pure) plus
`scripts/reel-shadow-judge-readout.ts` (read-only; the operator runs it, since the only
`DATABASE_URL` here is production). No migration: the KV key is `LIKE`-scannable.

**Three ways a naive reader would have been worse than none**, each pinned by a behavioural test:

1. `shadowJudgeGate` fails CLOSED - correct for an unattended publisher, wrong for a shadow readout,
   where the reel lane fails OPEN on purpose. Reusing it directly scores every Ollama timeout as a
   quality blind spot and inflates the statistic a gate flip would rest on. Unusable verdicts get a
   third bucket and are counted on neither side.
2. The corpus is CONDITIONED: the judge runs only after `evaluateReelPublishGate` already allowed
   the reel, so every row cleared rendered-QA. That is a blind-spot rate, never a quality base rate,
   and the readout states it above the numbers.
3. A judge that throws writes NOTHING, so its failures never appear as errored rows - the corpus
   just shrinks, and a small corpus with no blocks reads as an all-clear. `coverage` reports
   eligible posted reels carrying no verdict at all.

**And the fix for (3) needed its own fix.** A P1 review caught `coverage` counting EVERY
historically posted `reel_jobs` row, so pre-rollout reels and reels published by the operator route
or `contentManufacturing` were reported as judge failures - fabricating the gap coverage exists to
expose, which is the same lie in the opposite direction. Eligible now = `briefId` matching
`autopost-<YYYY-MM-DD>` (the only jobs `dailyReelPost` selects, and the judge sits inside that
function) with that date on/after the 2026-08-13 rollout, and the readout PRINTS what it excluded so
the filter is not silent either. `source` is not the signal: `contentManufacturing` also enqueues
`source: "cron"` while publishing elsewhere. The date is read from the briefId because it is
immutable - `updatedAt` is `onUpdateNow` and `createdAt` is enqueue time, not publish time.

The readout also reports judge-vs-QC agreement: if the free deterministic checklist already flags
what the LLM judge flags, the lane can gate at zero LLM cost.

**A doc asserting a value is a cache with no invalidation - this file's sibling proved it again.**
`docs/IG-ADMIN-PLAN-GATE-2026-08-05.md` called wiring `runConceptTournament` "the single
highest-leverage change", on the premise that the daily lane self-scores. True on 2026-08-05, stale
from 2026-08-13, and the 2026-08-16 addendum repeated it without re-reading the service. Corrected
in place: pre-generation concept selection (5 calls, still open, still an operator spend decision) is
a different stage from the post-render verdict (already paid for, now readable). Run the readout
before spending on the tournament - the image lane set the precedent that this call is made on a
number.

## 2026-08-16 — Create is grounded in records, and the admin stopped guessing

Full architecture: [docs/IG-EVIDENCE-ARCHITECTURE.md](docs/IG-EVIDENCE-ARCHITECTURE.md). Read that
before touching IG source selection, the quality gate, or any admin read state.

**The declined-work picker was reading a column nothing writes.** It filtered
`work_order_items.declined = true`; the only writers insert with the false default or set it FALSE on
recovery, and no migration updates it — so the query was `WHERE false` and the list was permanently
empty. The canonical lane is `alg_estimates` (unmatched), which is what `nour-os-query.ts` and
`customer_metrics` already used. The picker now agrees with the rest of the system.

**The decline on that lane is INFERRED, not recorded.** `alg_estimates` has no `declined` column —
it is derived from `matched_invoice_id IS NULL` through a ±10%/30-day matcher, so a failed match is
indistinguishable from a refusal. Facts now carry `basis: recorded | inferred | operator`, and
`inferred` can never reach "sufficient" alone. Do not reword the assertion text to say a customer
declined anything.

**The quality gate measured string length.** `source_grounding` was `detail?.trim() ? 8 : 6` — one
character earned 8/10 and silenced its own warning — and `buildEvalArgs` never passed the resolved
evidence, so the evaluator could not inspect what it scored. Now scored from structured facts, which
ride on the draft's `source` so they survive the round trip (a plain `z.object` strips unknown keys;
without that every re-score re-graded a grounded draft as ungrounded).

**Four surfaces claimed "empty" for reads that never happened** (Community feed and clusters,
Automation Lift, Database Hygiene — the last showing a green "Database is perfectly clean!" without
examining a row). react-query pauses when offline, leaving `isError` AND `isLoading` false with
`data` undefined. `client/src/lib/queryState.ts` encodes the guard.

**Storage health was inverted.** CloudFront being ABSENT is what enables permanent proxied URLs, so
`!!CLOUDFRONT_DOMAIN` reported "Ephemeral Only" exactly when they worked. Three states now, and the
`REEL_ALLOW_EPHEMERAL_STORAGE` branch is reported as a warning rather than a blocker.

**AI content no longer publishes itself.** Generated articles were written `status: "published"`,
overriding the column default, so every one went live on the blog and into the sitemap while the
admin showed an approve control that could never apply. Now draft; notifications start inactive; and
`getDynamicArticleBySlug` filters to published so the gate is not bypassable by URL.

**No navigation was renamed.** The Compose/Queue/Inbox proposal REVERSES commit 388c0a1ff and
`CURRENT-TRUTH.md`'s "Publish is the only queue"; Reel-as-a-format was rejected because the input
contracts are disjoint (reel has no objective control at all; static has no per-beat, VO, or paid
Visual World fields). What was actually wrong was three context-free doors on Today.

**Method note worth keeping.** Two adversarial audits of this same work refuted 17 of its claims and
found 3 criticals, including two pre-existing tests broken by a rename — missed because only
`server/*.test.ts` was being run while `client/src` (56 files, 1,019 tests) sat unrun. Run BOTH roots
before quoting a test count.

## 2026-08-12 — the approval queue is live, and it is the one door

`admin_proposals` (migration 0111) + the attributed activity ledger on `audit_log` (0110) shipped
in #1541; both migrations are applied to prod and read-back verified. **Every new AI- or one-tap-
originated write lands there as a DRAFT and executes only through a compare-and-set approval
chain** — a rejected row cannot reach execution structurally, and executors create internal records
only (callbacks, bookings at status `new`), never a customer send. Nick's call-end extraction feeds
it draft-only. That flag (`vapi_action_proposals`) shipped OFF and was **turned ON 2026-08-16** at
the operator's instruction, read-back verified against live Railway env — so drafts accumulate from
now on. Hand-review the first ~10 against their recordings before trusting the queue. Contract detail in `docs/CURRENT-TRUTH.md`.

## 2026-08-08 — five defects that every internal signal reported as healthy

A wave of publish-path corrections (#1430 #1432 #1438 #1439 #1440 #1442). They
share one shape worth knowing before you trust a green dashboard: **each status
was accurate and the conclusion it invited was wrong.** Registry: ROS-089…094.

- **Model pins were discarded in prod, so the publish gate judged its own
  family.** `AI_FORCE_OLLAMA=true` with `OLLAMA_MODEL` unset made
  `resolveEffectiveModel` return `deepseek-v4-pro` for EVERY lane — including
  the judge and the generator it grades. Native pins now survive the flag;
  `CONCEPT_JUDGE_MODEL` pins both judges off the generator's family.
  **Invisible locally**, where the flag is unset and pins work (ROS-089).
- **Every IG post was over the hashtag cap.** The limit has been 5 since
  Dec 2025; the autopost prompt asked for 6-10 and the parse layer clamped at
  12. Prod receipt: 60 of the last 60 posted rows over cap (ROS-090).
- **No reel ever reached the profile grid.** Instagram defaults
  `share_to_feed` to false on REELS containers, so reels landed in the Reels tab
  only. Not editable after creation — the 76 already published stay off-grid.
  They were never unseen (they out-comment feed posts); they were unseen ON THE
  PROFILE (ROS-091).
- **The free-lane fallback was armed and unreachable.**
  `REEL_FALLBACK_TO_TEMPLATE_STOCK=true` was already live and reels still went
  dark, because a revoked provider session HANGS rather than returning 401 and
  never reaches `PAUSE_PROVIDER`. The predicate now consults the keepalive's own
  verdict, and a degrade reaches Telegram the same day (ROS-092).
- **The content engine had never read what customers refuse.** 345 declined
  estimates with service descriptions are now a ranked topic feed
  (`declinedWorkTopics` + `creativeFingerprint`). Counts and dollars rank and
  explain; they never enter the brief (ROS-094).

**OPEN, and it IS still sending — corrected 2026-08-16 against live prod.** This paragraph has
now been wrong in both directions. It read "is live-sending SMS" until 2026-08-15, was rewritten to
"NOT still sending" on the strength of `docs/ISSUE-REGISTRY.md` (ROS-093, "operator set
`FEATURE_DECLINED_RECOVERY=0` on Railway, read-back verified"), and that rewrite was false. Reading
the live service env on 2026-08-16 returns `FEATURE_DECLINED_RECOVERY=1`; the guard at
`server/services/declinedWorkRecovery.ts:239` is `=== "1"`, so the send path is armed. `cron_log`
agrees — `Sent 0/3d + 4/7d` on 08-13, `1/14d` on 08-14, `1/14d` on 08-15, i.e. **6 customer texts in
three days**, and 31 follow-up stamps on `alg_estimates` in the last 30. Either the flag was flipped
back after 08-08 or the read-back was never done. **Do not restate this flag from a doc — read the
service env.**

The judgement is still open, but the exposure is live, not historical. The matcher was never
unscheduled, it was BROKEN: it compared phone strings across two tables storing different formats,
so it ran on every sync and matched nothing. After the repair the match rate went 5 → 20 of 439, and
**15 of the rows sitting in the "declined" list were customers who had already paid**. The 30-day
matcher window then left a second blind band, closed in #1592 (`DECLINED_RECOVERY_WINDOW_DAYS = 60`,
matching what sends actually target). As of 2026-08-16 the live eligible set is **49 unmatched
estimates inside 60 days, 27 of them (55%) in the 31-60 day band the matcher could not reach until
#1592 merged** — so the list this loop has been texting was demonstrably wrong until that PR, and
should re-verify itself as syncs run. The operator's call on 2026-08-16 was to leave it running
rather than pause: volume is low and the band is now closed in code. Full receipts in
`docs/ISSUE-REGISTRY.md` (ROS-093), which carries the superseded `=0` claim.

**Prod pin changed 2026-08-08:** `REEL_VIDEO_PROVIDER=template_stock`
(read-back verified). Higgsfield's session is revoked; nothing is blocked on it.
The free lane now carries six camera moves and accepts real footage — but it
COMPOSES video, it does not GENERATE it, and no footage source is wired yet
(`camera-bridge` is outdoor front-lot ALPR with no bay angle).

## 2026-08-10 — the capability ledger can now say "we do not currently know"

`docs/operations/capability-ledger.json` is the record of what is actually done, and
CI enforces it (`.github/workflows/completion-authority.yml`). It gained an expiry
axis it had always had code for and never used: `verificationExpiresAt` was
implemented, TESTED, and set by **0 of 48 capabilities** — the test built its own
synthetic record, so it stayed green while nothing real ever reached the path.
42 of 48 capabilities were last verified in July and the ledger had no way to say so
(ROS-099, #1493).

What changed, in one line: **stale is now a distinct state from invalid.** A claim you
cannot support is a lie and always fails. A claim you supported a month ago is a doubt
— it is reported, and it only FAILS the build where something other than your own
hands can act on it (`exposure` production or limited_autonomy). Two honest responses
to a stale claim, both fine: re-prove it and reset the date, or lower the claim with
`scripts/regress-capability.mjs`. Pretending is the only wrong answer.

Horizons are deliberately UNEVEN, set from what can kill a claim with no commit at
all — 21 days for anything resting on a third-party credential, session or quota;
90 days for our own schema; 180 for a deterministic render. `REALITY-LEDGER.md` shows
each date in a `Verify by` column; whether something is currently PAST it is printed
by `node apps/nickstire/scripts/check-capability-ledger.mjs`, never by the file
(CI diffs that file, so it must not change on a clock tick).

**CLOSED 2026-08-11, corrected here 2026-08-15 — `reel-pipeline-assembly` was
re-verified and now expires 2026-09-10.** This paragraph previously read "expires
2026-08-16" and warned that `completion-authority` CI would go red on that date;
that deadline had already been retired and the warning was left standing. It is
still the only `exposure: production` capability, so it is still the only one whose
staleness can fail a build — just not this week. `node
apps/nickstire/scripts/check-capability-ledger.mjs` prints the live answer and is
the thing to believe; this file is a cache of it.
Four other capabilities (`format-directors`, `evidence-resolution`,
`drive-creative-vault`, `higgsfield-keepalive`) are past their dates (2026-08-07)
and are reported without failing anything — that is the intended behaviour, not a
backlog. Re-verifying the reel capability still means a real prod IG render, which
is an operator-authorized publish and never an agent's call; to lower a claim
instead: `node apps/nickstire/scripts/regress-capability.mjs <id> P2 "<reason>"
"freshness gate"`.

**Coverage note (2026-08-15):** only 12 of 48 capabilities carry a
`verificationExpiresAt` at all. The freshness axis is real but it is not yet a
property of the ledger — 36 claims cannot go stale because nothing dates them.
That is a gap, not a guarantee.

The older file under `docs/_archive/root_reports/truth_os.md` is historical evidence only. Do not treat archived audit claims as current without re-verification.