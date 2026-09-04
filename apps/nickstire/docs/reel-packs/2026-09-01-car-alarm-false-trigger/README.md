# Reel pack — "Your car alarm keeps going off for no reason — again"

Produced by a **scheduled task** firing (2026-09-01), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-09-01 11:38 UTC (session clock).
- Capability check this session: `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL'`
  returned nothing. `which ffmpeg` — not found. No TTS, Higgsfield, or Meta-posting MCP tool is
  attached to this session (checked the full attached-tool list; only a GitHub MCP server and
  unrelated design/analytics connectors are present). Result: **BLOCKED: NO MOTION ROUTE** this
  session → full pack produced per the skill's explicit fallback, not a downgraded stills-only
  asset. `getHiggsfieldAccountHealth()` was **not called** (no running server, no credentials, no
  network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — inherited doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the offline check the skill requires instead:
  - `ls -d apps/nickstire/docs/reel-packs/2026-*/` — **136 merged pack directories**
    (`2026-08-14` through `2026-08-28`).
  - `mcp__github__search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open
    "reel pack" in:title)` → **2 open reel-pack PRs**: #2037 (clutch pedal sinking to the floor /
    hydraulic leak, opened 08:32 UTC today) and #2038 (a backlog-status note opened 10:30 UTC
    today, itself a "no new pack" run triggered while only #2037 was open). Queue is healthy —
    2 open, well below the 127–132 range that previously warranted a dedicated status-only escalation.
  - Checked this pack's topic (a car alarm triggering with no forced entry — hood-latch switch or
    weak key-fob battery, not a break-in) against all 136 merged topics and both open PRs —
    **no overlap found.** No merged or open topic mentions an alarm, hood-latch switch, or key-fob
    false-trigger; nearest neighbors (`key-fob-dead-battery-no-start`, `door-lock-actuator-stripped-gear`)
    are about a fob or lock actuator **failing to work**, not a working alarm **falsely triggering**
    — a distinct symptom cluster (electrical/security nuisance vs. mechanical failure).

## 2. Candidate scores and selected concept

Single-concept run (topic backlog is not the binding constraint — see §1, queue is healthy).
Scored against the skill's rubric out of 5 per dimension, self-estimated (no live critic panel —
no DB/tournament access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 5/5 | A car alarm going off at night for no clear reason is a near-universal, mildly embarrassing annoyance — high relatability |
| Distinct symptom cluster | 5/5 | Electrical/security false-trigger, not covered by any of the 136 merged mechanical/fluid topics |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 136 topics + 2 open PRs | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 5/5 | All beats are static exterior/macro cutaway shots; no dealership-specific footage or hands/faces required |

Selected: **"Your car alarm keeps going off for no reason — again."** No runner-up concept was
generated — single-topic run, consistent with sibling packs in this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (a hood-latch
  pin switch that isn't fully seated, or is loose/misaligned, can send a false "hood open" signal to
  the alarm/BCM; a weak key-fob battery can cause intermittent arm/disarm miscommunication that some
  factory alarm systems read as a fault condition), not a shop-specific sourced fact. `entailment`
  status: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made.
- **UNKNOWN, explicitly:** live entailment status of the hood-latch/fob-battery explanation;
  whether Nick's Tire & Auto specifically diagnoses alarm/BCM electrical faults in-house (near-certain
  for a general repair shop, but not confirmed against a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Your car alarm goes off at two in the morning — again — and nothing's wrong." |
| 0:04–0:09 | SYMPTOM | "No broken glass, no forced entry. Just the alarm, blaring, for no clear reason." |
| 0:09–0:15 | EXPLANATION A | "Most random alarms trace back to one of two things — the hood latch switch, or the key fob battery." |
| 0:15–0:21 | EXPLANATION B / CUTAWAY | "A loose hood pin switch can send a false 'break-in' signal. A weak fob battery can do the same thing." |
| 0:21–0:26 | SAFE ACTION | "Checking those two spots first can rule out the most common causes before anything else." |
| 0:26–0:30 | BRANDED CTA | "One clue, easy to check. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*can · worth checking → "easy to check" · stop by and we'll take a look · one clue.* No prices, no
guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Wide static shot of a car parked on a dark residential street at night, headlights
   flashing in sync with an alarm chirp, porch light glow in the background; quick cut to a close-up
   of a dashboard alarm indicator LED blinking red through the windshield.
2. **0:04–0:09** — Close-up on an intact, undisturbed door handle and lock cylinder, no damage
   visible, night lighting; cut to a wide shot of the same car's windshield and side glass, fully
   intact, confirming no break-in.
3. **0:09–0:15** — Macro shot of a hood latch mechanism under an open hood, pin and switch visible,
   daylight garage setting, static camera; cut to a close-up of a key fob resting on a workbench,
   battery-compartment cover removed, no hands in frame.
4. **0:15–0:21** — Macro cutaway of a hood-latch pin switch shown slightly misaligned/loose on a
   workbench rig, slow push-in; cut to a close-up of a coin-cell battery beside an open fob
   compartment, static overhead shot.
5. **0:21–0:26** — Close-up of a hood-latch switch and a small diagnostic multimeter display showing
   a continuity reading, both resting on a workbench, static overhead shot, warm garage lighting.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 1, 2, 3,
and 4 into two sub-shots each (quick punch-in or angle change) to reach ~10 sub-clips at ~3s
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
- Hashtags: `#CarMaintenance #CarAlarm #AutoElectrical #CarTips #AutoRepair #ClevelandAuto #CarProblems #NicksTireAndAuto`
- Caption (feed): "🚨 Alarm going off with no break-in? Check the hood latch switch and the key fob
  battery first — those two cause most false alarms. Easy to check, easy to fix. Stop by and we'll
  take a look. 🔧"

Two ad-ready hook/caption/CTA variants (per the skill's required-response §8):

- **Variant A (2-AM-annoyance-first):** Hook: "2 AM. Your car alarm again. Nothing's wrong." Caption:
  "No broken glass, no forced entry — just noise. A loose hood latch switch or a weak fob battery
  can trigger a false alarm, and both are quick to check." CTA: "Stop by and we'll take a look —
  Nick's Tire & Auto."
- **Variant B (two-suspects-first):** Hook: "Random car alarm? It's usually one of two parts."
  Caption: "The hood latch switch and the key fob battery cause most false alarms — not a wiring
  nightmare, not a break-in. One clue, easy to check." CTA: "Easy to check. Stop by — Nick's Tire &
  Auto."

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` → **estimated generation cost if run today: $0.00** for
  ~10 sub-clips on the free ffmpeg lane. This is a doc-inherited estimate, not a live balance read.
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
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Substituted directory + open-PR search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 8 | Flashing headlights + blinking dash LED at night, relatable-annoyance framing |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation A → explanation B → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 3 | "car alarm," "hood latch," "key fob" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **50/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Your car alarm keeps going off for no reason —
again"}` to re-score, render, and move toward publish.

**Operator note — reel-pack review queue is healthy right now, not the concern.** Only 2 PRs are
currently open: #2037 (clutch pedal sinking, opened this morning, still unreviewed) and #2038 (a
status-only note from an hour before this run). That is far below the 127–137 range that previously
warranted a dedicated escalation, and 136 packs have merged since 2026-08-14. The more relevant
signal this run: `search_pull_requests` for `"reel pack" in:title` (all states) returns **181 total
matches** against a backlog of 136 real merged packs — roughly 45 non-merged attempts (duplicate
runs, closed-without-merge status notes, superseded drafts) have accumulated and closed without
landing. That waste is upstream of this run (a scheduling-cadence question, not a content-quality
one) — noting it here rather than re-litigating it with a 137th status-only PR, since the live
queue itself is currently caught up.
