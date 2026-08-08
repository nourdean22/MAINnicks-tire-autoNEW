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

The older file under `docs/_archive/root_reports/truth_os.md` is historical evidence only. Do not treat archived audit claims as current without re-verification.