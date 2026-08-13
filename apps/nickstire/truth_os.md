# Nick's Tire & Auto Current Truth

This compatibility entrypoint exists because repository instructions historically referenced `truth_os.md`.

The active operating contract is:

- [`docs/CURRENT-TRUTH.md`](docs/CURRENT-TRUTH.md)
- [`docs/METRICS-CONTRACT.md`](docs/METRICS-CONTRACT.md)
- [`docs/ISSUE-REGISTRY.md`](docs/ISSUE-REGISTRY.md)
- [`docs/REVENUE-OPS-ROADMAP.md`](docs/REVENUE-OPS-ROADMAP.md)
- [`docs/operations/SMS-REVENUE-AGENT-OS.md`](docs/operations/SMS-REVENUE-AGENT-OS.md) — operator runbook for the SMS Revenue Agent OS (2026-07-29 arc: levers, gates, daily loop, symptom table)

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

## 2026-08-12 — the approval queue is live, and it is the one door

`admin_proposals` (migration 0111) + the attributed activity ledger on `audit_log` (0110) shipped
in #1541; both migrations are applied to prod and read-back verified. **Every new AI- or one-tap-
originated write lands there as a DRAFT and executes only through a compare-and-set approval
chain** — a rejected row cannot reach execution structurally, and executors create internal records
only (callbacks, bookings at status `new`), never a customer send. Nick's call-end extraction feeds
it draft-only and ships **flag-gated OFF** (`vapi_action_proposals`) — flip it, then hand-review the
first ~10 drafts against their recordings. Contract detail in `docs/CURRENT-TRUTH.md`.

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

**OPEN, needs an operator decision (ROS-093):** `declinedWorkRecovery` is
live-sending SMS against `matched_invoice_id IS NULL`, and that field has been
written exactly 5 times ever — all on 2026-05-07. "Unmatched" currently means
"the matcher has not run", not "declined". 22 follow-ups went out in the last 30
days to a list where an unknown share already paid.

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

**OPEN, dated — `reel-pipeline-assembly` expires 2026-08-16.** It is the only
`exposure: production` capability, so on that date it becomes the first load-bearing
stale claim and **`completion-authority` CI goes red and stays red** until someone
acts. Re-verifying means a real prod IG render, which is an operator-authorized
publish and never an agent's call. To lower the claim instead:
`node apps/nickstire/scripts/regress-capability.mjs reel-pipeline-assembly P2 "<reason>" "freshness gate"`.
Four other capabilities (`format-directors`, `evidence-resolution`,
`drive-creative-vault`, `higgsfield-keepalive`) are already past their dates and are
reported without failing anything — that is the intended behaviour, not a backlog.

The older file under `docs/_archive/root_reports/truth_os.md` is historical evidence only. Do not treat archived audit claims as current without re-verification.