# Reel pack — "That pinging sound when you accelerate isn't nothing"

Produced by a **scheduled task** firing (2026-08-27), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-27 (session clock).
- Capability check this session: `ADMIN_API_KEY`, `DATABASE_URL`, `REEL_GENERATION_ENABLED`,
  `REEL_VIDEO_PROVIDER`, `OPENAI_API_KEY` — all **unset**. `hf` (Higgsfield CLI) and `ffmpeg` —
  both **missing** from `PATH`. Result: **BLOCKED: NO MOTION ROUTE** this session → full pack
  produced per the skill's explicit fallback, not a downgraded stills-only asset.
  `getHiggsfieldAccountHealth()` was **not called** (no running server, no credentials, no network
  path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Treat this as inherited
  doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended run per `prod-db-guard`).
  Substituted the best available offline check instead:
  - `ls apps/nickstire/docs/reel-packs/` on this checkout (which had just fast-forwarded onto
    latest `origin/main`) — **136 merged pack directories** (`2026-08-14` through `2026-08-27`),
    spanning tires, brakes, cooling, electrical, drivetrain, HVAC, and emissions.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack" in:title)`
    — **1 open PR**: #1927, "steering wheel vibration at highway speed" (draft, filed 13:35Z
    today). Not a backlog — the prior 22-PR jam flagged across six status reports (#1842 through
    #1922) was cleared in a batch closure at 12:56–12:57Z today, confirmed by this checkout already
    containing those packs' merged directories. No batch-review backlog to report this run.
  - A second targeted search — `knock OR ping OR pinging OR knocking in:title` — returned **zero
    results**, live-confirming novelty for this specific topic beyond the directory scan.
  - Checked this pack's topic (engine knock/ping under acceleration — carbon buildup, low-octane
    fuel, or a failing knock sensor) against all 136 merged topics and the 1 open PR — **no
    overlap found.** Nearest neighbors are `misfire-shudder-coil-vs-plug` (a **shudder/miss**
    during a misfire, not a pinging/knocking sound, and points to ignition components, not
    fuel/carbon/knock-sensor causes), `timing-chain-rattle-cold-start` (a **rattle at cold start**
    from chain slack, not a knock under load once warm), and `hesitation-acceleration-maf-sensor`
    (a **hesitation/stumble**, not an audible knock). The script below names the pinging/knocking
    sound and the three specific causes explicitly to keep it distinguishable from all three.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this series. Scored against the skill's
rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament access this
session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "That pinging sound when you accelerate isn't nothing" — direct, curiosity-driven, matches this series' proven hook shape |
| Distinct symptom cluster | 5/5 | Pinging/knocking specifically under acceleration/load — mechanically specific, not a generic "engine noise" topic |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 136 topics + 1 open PR | 5/5 | No overlap found (see §1); live PR-title search also came back empty |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll/underbody-and-engine-bay shots; no dealership-specific footage required |

Selected: **"That pinging sound when you accelerate isn't nothing."** No runner-up concept was
generated — single-topic run, consistent with sibling packs in this series.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (a
  pinging/knocking sound under acceleration is commonly caused by carbon deposits raising
  cylinder compression, fuel with too low an octane rating for the engine's compression ratio, or
  a failing knock sensor that lets ignition timing run too advanced — left unaddressed, sustained
  knock can damage pistons or bearings over time), not a shop-specific sourced fact. `entailment`
  status: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the knock/carbon/octane/knock-sensor claim;
  whether Nick's Tire & Auto specifically offers knock-sensor diagnostics or carbon-cleaning
  service (near-certain for a general repair shop with OBD-II diagnostic capability, but not
  confirmed against a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:03 | HOOK | "That pinging sound when you accelerate isn't nothing." |
| 0:03–0:08 | SYMPTOM | "A knock or ping under load can point to three different things." |
| 0:08–0:13 | EXPLANATION | "Carbon buildup in the cylinders. Low-octane fuel. Or a failing knock sensor." |
| 0:13–0:18 | DIAGNOSTIC CLUE | "One clue: does it only happen climbing hills or towing? That's worth checking first." |
| 0:18–0:23 | CONSEQUENCE | "Ignoring it can let engine damage build quietly. Don't guess which one it is." |
| 0:23–0:27 | BRANDED CTA | "Stop by and we'll take a look before it gets expensive. Nick's Tire & Auto." |
| 0:27–0:30 | SAVE FREEZE | (no narration — end-card hold for save/share) |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*can point to · one clue · worth checking · don't guess · stop by and we'll take a look.* No
prices, no guarantees, no invented timelines. "Before it gets expensive" alludes to a real
consequence (unaddressed knock can progress to piston or bearing damage) without naming a specific
dollar figure or timeline as fact.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:03** — Close-up of an engine bay at idle, camera slowly pushes in, morning light
   through a garage door, shallow depth of field.
2. **0:03–0:08** — Driver's-POV dash shot: tachometer needle climbing as the accelerator is
   applied, road ahead through the windshield, static-mounted camera (no hand on the wheel visible).
3. **0:08–0:13** — Macro/cutaway sequence: a fuel nozzle at a pump (implies octane), cut to a
   cylinder-head cutaway model showing dark carbon deposits, cut to a knock sensor mounted on an
   engine block, slow push-in on each.
4. **0:13–0:18** — Close-up of an OBD-II scan tool clipped under the dash, screen glowing with
   diagnostic codes, engine bay softly reflected in a nearby window, static mount (no hand in frame).
5. **0:18–0:23** — Dashboard shot: the check-engine light glowing amber against a dim instrument
   cluster, subtle flicker, static hold.
6. **0:23–0:27** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   slow static push-in. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).
7. **0:27–0:30** — Same end-card plate, continued slow push-in (not a hard freeze — the
   render-integrity gate's motion-floor check samples frames across the full clip, so even the
   closing hold needs a small continuous camera move, not a truly static frame).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Beat 3 as
scripted is already a 3-shot cutaway sequence within 5s; beats 1, 2, 5, and 6/7 are single shots of
5s, 5s, 5s, and 3+3s respectively — recommend the assembler split beats 1 and 2 into two sub-shots
each (quick punch-in or angle change) to reach ~10–11 sub-clips at ~2.5–3s apiece before this pack
is fed to real generation. Flagging this explicitly rather than presenting the 7-beat table as
render-ready.

### Assembly instructions (ffmpeg/CapCut)

1. Order clips exactly as beats 1→7 above (after the sub-shot split noted above).
2. Trim each sub-clip to its allotted window; hard-cut or short (≤0.2s) crossfade between beats —
   no `zoompan`/Ken-Burns stills filters (documented cause of the frozen-frame regression in
   `REEL-PIPELINE.md` §"Render-integrity gate").
3. Burn in captions from `captions.srt` (below), bottom-third safe zone, high-contrast style
   matching the account's existing caption preset.
4. Composite the Nick's Tire & Auto logo and CTA text on beats 6–7 only, in post (not generated).
5. Mix voiceover (TTS, not produced this session — no TTS credential available) as the primary
   audio layer; the scripted 3s silent hold (0:27–0:30) doubles as the storyboard's "SAVE" card per
   the render-integrity gate's contract (container duration = beats + 3s freeze ≈ 30s already
   includes it here, since the hold is scripted in rather than appended after).
6. Export 9:16, 1080×1920, H.264, target ≥30fps throughout (render-integrity gate requires ≥80% of
   expected 30fps frame count).

### Posting specs

- Platform: Instagram Reels (primary), cross-post to Facebook Reels via the same asset.
- Dimensions: 1080×1920 (9:16), MP4, ≤30s target already met.
- Hashtags: `#CarMaintenance #EngineKnock #CheckEngineLight #CarNoises #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🔧 Hear a ping or knock when you accelerate? One clue: it can point to carbon
  buildup, low-octane fuel, or a failing knock sensor. Don't guess which one — stop by and we'll
  take a look. 🚗"

Two ad-ready hook/caption/CTA variants:

1. **Curiosity-first** — Hook: "Why does your engine ping when you climb a hill?" Caption: "Three
   causes, one sound. We'll help you find out which one before it costs more." CTA: "Book a
   diagnostic — link in bio."
2. **Consequence-first** — Hook: "That knock under acceleration won't fix itself." Caption: "Carbon
   buildup, bad gas, or a failing sensor — ignoring it lets the damage build quietly." CTA: "Stop
   by and we'll take a look."

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` → **estimated generation cost if run today: $0.00** for
  ~10–11 sub-clips on the free ffmpeg lane. This is a doc-inherited estimate, not a live balance
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
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated ~51/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
| Server re-score at enqueue | **BLOCKED** | No `/api/admin/reel-canary {action:"start"}` call made — no credentials/route |
| Render-integrity gate (#800/#801) | **N/A — not rendered** | No MP4 exists this session |
| Rendered QA / vision critic (`renderedQa.ts`) | **N/A — not rendered** | Same |
| Repair routing / 7-way decision | **N/A** | No job exists to route |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED (by absence of a job)** | Cannot evaluate a gate against a nonexistent render — this is the gate's own `unavailable` state, not a silent pass |
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Directory scan (136 topics) + live PR-title search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 7 | Engine-bay hook is relatable but slightly less visceral than a dashboard-warning-light hook |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → diagnostic clue → consequence → CTA → save-freeze, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 5 | "ping," "knock," "carbon buildup," "octane," "knock sensor" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **51/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"That pinging sound when you accelerate isn't
nothing"}` to re-score, render, and move toward publish.

**Operator note:** As of this run, the reel-pack PR queue holds exactly **1 open PR** (#1927,
steering wheel vibration, filed 13:35Z today) — the prior 22-PR jam flagged across six status
reports was cleared in a batch closure at 12:56–12:57Z today. This pack's topic does not overlap
that open PR. No batch-review backlog to flag this run.
