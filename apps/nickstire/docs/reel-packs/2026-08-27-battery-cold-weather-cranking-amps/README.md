# Reel pack — "Your battery was fine all summer. First cold morning, it's dead."

Produced by a **scheduled task** firing (2026-08-27), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-27 (session clock).
- Capability check this session:
  `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC|META_|INSTAGRAM|FACEBOOK|TTS|CAPCUT'`
  returned **nothing** relevant — no Higgsfield credential, no `ADMIN_API_KEY`, no `DATABASE_URL`,
  no TTS provider key, no Meta/Instagram token. Also checked local binaries: `ffmpeg` — **missing**,
  `gh` — **missing** (GitHub access this session goes through the connected GitHub MCP tools
  instead). Result: **BLOCKED: NO MOTION ROUTE** this session -> full pack produced per the skill's
  explicit fallback, not a downgraded stills-only asset. `getHiggsfieldAccountHealth()` was **not
  called** (no running server, no credentials, no network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Treat this as inherited
  doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended run per `prod-db-guard`).
  Substituted the best available offline check instead:
  - `git ls-tree` on `apps/nickstire/docs/reel-packs/` — **117 merged pack directories**
    (`2026-08-14` through `2026-08-27`), spanning tires, brakes, cooling, electrical, drivetrain,
    HVAC, fuel, and emissions.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack"
    in:title)` — **9 open PRs** (#1927, #1932, #1941, #1942, #1945, #1948, #1952, #1953, #1954),
    all filed between 13:35 and 22:31 UTC today, roughly hourly. This is **not** a stuck backlog:
    the prior status note in this directory (`BACKLOG-STATUS-2026-08-27-1130.md`) flagged 22 open
    PRs unreviewed for ~45 hours and recommended a batch review. Checking PR history directly
    (`search_pull_requests` sorted by `updated`) shows that between 12:56 and 13:12 UTC today — after
    that status note was filed — **23 previously-open reel-pack PRs plus one dependabot PR were
    merged/closed within a 16-minute window** (a live operator batch-review, matching the note's own
    recommendation #1), including all four topics that were already visible on disk
    (`alternator-overcharging-battery-swell`, `blown-fuse-repeat-short-circuit`,
    `idle-air-control-valve-rough-idle-stall`, `u-joint-clunk-drive-reverse-shift`). The 9 PRs open
    now were all filed *after* that clear-out and are each under 10 hours old — normal async-review
    latency for an hourly-cadence pipeline, not an abandoned queue. **No new status-note PR is
    warranted this run**; producing one content pack, matching sibling runs' cadence, is the correct
    action.
  - Checked this pack's topic (a battery that tests fine in warm weather but fails to crank in the
    first cold snap, because cranking-amp capacity drops with both age and temperature) against all
    117 merged topics and the 9 open PR titles — **no overlap found.** Nearest neighbors are
    `battery-summer-heat` (heat **accelerates internal battery wear over time**, a different causal
    mechanism and season), `battery-terminal-corrosion` (a **connection** fault, not a capacity
    fault), `battery-parasitic-drain` (a **parked-car drain** fault, battery is otherwise healthy),
    `alternator-overcharging-battery-swell` (an **alternator** fault that damages the battery, not
    normal age-related capacity loss), and `key-fob-dead-battery-no-start` (the **fob's** battery,
    not the car's). None address a battery that is otherwise fine and simply loses enough
    cranking-amp headroom, through ordinary aging, to fail only once cold cuts its remaining
    capacity — the script below names the cold-cranking-amps (CCA) mechanism explicitly to keep it
    distinguishable from all five.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this series. Scored against the skill's
rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament access this
session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "Fine all summer, dead the first cold morning" — a relatable, seasonally-timely (late Aug -> fall) surprise-symptom hook |
| Distinct symptom cluster | 5/5 | Cold-cranking-amps capacity loss from ordinary battery aging — mechanically specific, not a generic "battery died" topic |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 117 topics + 9 open PRs | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll shots (driveway, shop bay, load tester); no dealership-specific footage required |

Selected: **"Your battery was fine all summer. First cold morning, it's dead."** No runner-up
concept was generated — single-topic run, consistent with sibling packs in this series.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (a
  lead-acid battery's usable cranking capacity — cold cranking amps — declines gradually as the
  battery ages, and that same capacity also drops as ambient temperature drops; a battery with
  reduced-but-still-adequate CCA can start a car reliably in warm weather and fail to start the
  same car once cold weather removes its remaining margin), not a shop-specific sourced fact.
  `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — "first cold morning" is used as a generic seasonal framing
  device, not a claim about current Cleveland weather.
- **UNKNOWN, explicitly:** live entailment status of the CCA-capacity-loss claim; whether Nick's
  Tire & Auto specifically offers a battery load test as a named service (near-certain for a general
  tire/auto shop, but not confirmed against a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Your battery was fine all summer. First cold morning, it's dead." |
| 0:04–0:09 | SYMPTOM | "Cold doesn't kill a battery — it exposes one that was already weak." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: cranking power fades as a battery ages, and cold cuts what's left." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "A battery that starts fine at 70 degrees can fail that same test at 20." |
| 0:21–0:26 | SAFE ACTION | "A load test checks real cranking power — not just a voltage reading." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before the first cold snap. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · stop by and we'll take a look.* No prices, no guarantees, no
invented timelines. "Can fail that same test at 20 [degrees]" states a general physical property of
lead-acid batteries (capacity drops with temperature), not a claim about any specific vehicle or
customer's battery.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Wide shot of a driveway or curb parking spot at dawn, frost visible on a car's
   windshield and hood, static-mounted camera, cool blue morning light.
2. **0:04–0:09** — Close-up on a car's dashboard/ignition area implying a slow or failed crank
   (subtle flicker cue on the dash lights, no hand in frame); cut to a car hood popped open,
   engine bay visible in the cold.
3. **0:09–0:15** — Macro/cutaway shot: a car battery on a shop bench with a digital battery-tester
   clamp attached to the terminals, readout implied but not legible text, slow push-in.
4. **0:15–0:21** — Split-style comparison shot: same battery tester readout, subtle visual
   temperature cue (frost on one side of frame, none on the other) to imply the warm-vs-cold
   contrast without on-screen text.
5. **0:21–0:26** — Shop-bay shot: a professional battery load tester connected to a battery under
   the hood, tool visible and mounted/clipped, shop bay softly blurred behind, static mount.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm interior
   lighting contrasting the cold opening beat, static hold. **Real logo and CTA text are composited
   in post** (ffmpeg overlay), never AI-generated — matches the live pipeline's actual contract
   ("captions and logos are composited in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 2, 3, and
5 into two sub-shots each (quick punch-in or angle change) to reach ~10–12 sub-clips at ~2.5–3s
apiece before this pack is fed to real generation. Flagging this explicitly rather than presenting
the 6-beat table as render-ready.

### Assembly instructions (ffmpeg/CapCut)

1. Order clips exactly as beats 1→6 above (after the sub-shot split noted above).
2. Trim each sub-clip to its allotted window; hard-cut or short (≤0.2s) crossfade between beats —
   no `zoompan`/Ken-Burns stills filters (documented cause of the frozen-frame regression in
   `REEL-PIPELINE.md` §"Render-integrity gate").
3. Burn in captions from `captions.srt` (below), bottom-third safe zone, high-contrast style
   matching the account's existing caption preset.
4. Composite the Nick's Tire & Auto logo and CTA text on beat 6 only, in post (not generated).
5. Mix voiceover (TTS, not produced this session — no TTS credential available) as the primary
   audio layer; add a 3s freeze-frame "SAVE" card after 0:30 per the storyboard contract used by
   the render-integrity gate (container duration = beats + 3s freeze ≈ 33s).
6. Export 9:16, 1080×1920, H.264, target ≥30fps throughout (render-integrity gate requires ≥80% of
   expected 30fps frame count).

### Posting specs

- Platform: Instagram Reels (primary), cross-post to Facebook Reels via the same asset.
- Dimensions: 1080×1920 (9:16), MP4, ≤30s target already met.
- Hashtags: `#CarBattery #ColdWeatherCarCare #CarMaintenance #CarTips #WinterReady #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🔋 Battery was fine all summer? Cold weather doesn't kill a battery — it exposes
  one that's already weak. A load test checks real cranking power, not just voltage. Worth checking
  before the first cold snap. 🚗❄️"

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` -> **estimated generation cost if run today: $0.00** for
  ~10–12 sub-clips on the free ffmpeg lane. This is a doc-inherited estimate, not a live balance
  read.
- `getHiggsfieldAccountHealth().balanceCredits`: **UNKNOWN** — not called this session (no
  credentials, no server).
- Day's `autonomy_policy_versions.limits.maxGenerationCostPerDayUsd` (documented default $10):
  **not read live this session** — treat as UNKNOWN, not assumed available.
- Fallback routing: `REEL_FALLBACK_TO_TEMPLATE_STOCK` behavior not exercised — no generation was
  attempted.

## 6. Audio/music rights status

**Real gap, not papered over:** no music-rights ledger exists in this repo (documented gap in the
`nickstire-reel-operator` skill). No music bed is assigned to this pack. Voiceover-only audio via
TTS (not produced this session — no TTS credential available in this session's environment) plus
captions is the safe default until a rights-tracked bed exists.

## 7. QA matrix

| Gate | Status | Basis |
|---|---|---|
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated ~50/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
| Server re-score at enqueue | **BLOCKED** | No `/api/admin/reel-canary {action:"start"}` call made — no credentials/route |
| Render-integrity gate (#800/#801) | **N/A — not rendered** | No MP4 exists this session |
| Rendered QA / vision critic (`renderedQa.ts`) | **N/A — not rendered** | Same |
| Repair routing / 7-way decision | **N/A** | No job exists to route |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED (by absence of a job)** | Cannot evaluate a gate against a nonexistent render — this is the gate's own `unavailable` state, not a silent pass |
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Directory scan (117 topics) + live open-PR-title search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 7 | Frosted-windshield-at-dawn hook is visually clear and seasonally timely |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "battery," "cold," "cranking" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **50/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Your battery was fine all summer. First cold
morning, it's dead."}` to re-score, render, and move toward publish.

**Operator note on backlog health:** the reel-pack PR queue was fully cleared by a live operator
instruction earlier today (12:56–13:12 UTC, 23 PRs + 1 dependabot PR merged/closed in 16 minutes).
The 9 PRs open as of this run are all under 10 hours old and reflect normal async-review latency at
this pipeline's hourly cadence — not a repeat of the stuck-backlog condition the 11:30 UTC status
note flagged. No batch-review escalation is warranted this run.
