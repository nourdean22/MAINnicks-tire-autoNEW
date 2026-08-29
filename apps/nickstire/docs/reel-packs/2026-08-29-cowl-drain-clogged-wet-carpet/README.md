# Reel pack — "Wet carpet after it rains? It might not be a leak at all."

Produced by a **scheduled task** firing (2026-08-29), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-29 (session clock).
- Capability check this session: `which ffmpeg hf capcut` returned nothing (none installed);
  `env | grep -iE 'DATABASE_URL|ADMIN_API_KEY|HIGGSFIELD|REEL_|OPENAI|ELEVENLABS|TTS'` returned
  nothing — no Higgsfield credential, no `ADMIN_API_KEY`, no `DATABASE_URL`, no TTS provider key.
  This session's GitHub access goes through the connected GitHub MCP server, not a `gh` CLI. No
  Meta/Instagram token, no shell render path. Result: **BLOCKED: NO MOTION ROUTE** this session →
  full pack produced per the skill's explicit fallback, not a downgraded stills-only asset.
  `getHiggsfieldAccountHealth()` was **not called** (no running server, no credentials, no network
  path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Treat this as inherited
  doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended run per `prod-db-guard`).
  Substituted the best available offline check, per the skill's duplicate-check step (checking
  BOTH the merged directory AND open PRs, since a pack opens as a draft PR before it merges):
  - `ls apps/nickstire/docs/reel-packs/` — **~150 merged pack directories** (`2026-08-14` through
    `2026-08-28`), spanning tires, brakes, cooling, electrical, drivetrain, HVAC, exhaust, and
    body/interior symptoms. No pack yet existed for `2026-08-29`.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack" in:title)`
    — **3 open PRs**, none a competing new-topic pack: #1999 and #1975 are backlog-status-only
    notes ("no new pack this run" / "still no new pack this run"), and #2003 is a fix adding a
    missing `captions.srt` to the already-merged `2026-08-14-tire-expiration` pack. The prior
    15-PR open-pack backlog (#1927–#1962) described in the 2026-08-28 turn-signal pack's own note
    has since cleared — no unmerged, unseen pack topics to collide with.
  - Checked this pack's topic (a clogged windshield-cowl/plenum drain causing water to back up
    into the cabin and soak the carpet, misread as a mystery leak) against all ~150 merged topics
    — **no overlap found.** Nearest neighbors are `sunroof-drain-clog-water-leak` (a **different**
    drain path — sunroof channel water exiting through the A/B-pillars, not the wiper-cowl plenum
    that feeds the HVAC intake) and `musty-ac-smell-evaporator-vs-filter` (an AC evaporator-drain
    odor issue, not a cowl-drain water-intrusion issue, and no wet-carpet symptom). Both are
    distinct drain systems and distinct symptom clusters from a soaked footwell carpet.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this series. Scored against the skill's
rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament access this
session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 5/5 | "Wet carpet after it rains? It might not be a leak" reframes a common, confusing symptom — high curiosity pull |
| Distinct symptom cluster | 5/5 | A clogged cowl/plenum drain is a specific, commonly misdiagnosed cause (owners assume a window seal or sunroof), mechanically distinct from the two nearest existing topics (see §1) |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing ~150 topics + 3 open PRs | 5/5 | No overlap found (see §1); live PR-title search also came back clear of any competing new-topic pack |
| Producibility (faceless, no live footage needed) | 5/5 | Every beat is a plausible stock/AI-gen interior, cowl-panel, or macro shot; no dealership-specific footage, no driver-in-frame shot required |

Selected: **"Wet carpet after it rains? It might not be a leak all."** No runner-up concept was
generated — single-topic run, consistent with sibling packs in this series.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive knowledge** (the cowl/plenum
  panel beneath the wiper arms channels rainwater to a drain that feeds the HVAC intake area;
  leaves and debris collecting there block the drain, so water backs up over the plenum's rear lip
  and drips onto the cabin floor near the firewall — a well-documented mechanism, not a
  shop-specific sourced fact). `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not
  `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — "after it rains" is a generic trigger condition, not a
  claim about current Cleveland weather.
- **UNKNOWN, explicitly:** live entailment status of the cowl-drain/wet-carpet mechanism claim;
  whether Nick's Tire & Auto specifically stocks cowl-drain clearing tools or replacement cowl
  seals on-site (near-certain for a general repair shop, but not confirmed against a live
  `business_facts` row this session). The script avoids asserting same-day service as fact.

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Wet carpet after it rains? It might not be a leak at all." |
| 0:04–0:09 | SYMPTOM | "Water pooling under the mats, a musty smell, no visible drip anywhere." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: leaves and debris clog the drain under your wipers, and water backs up straight into the cabin." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "Left alone, that trapped water can rust the floor pan and short out wiring under the carpet." |
| 0:21–0:26 | SAFE ACTION | "Don't guess where it's coming from. A quick check under the cowl can spot it fast." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before it gets worse. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines. "Before it gets worse" states a real, generic consequence
(trapped water causing corrosion and electrical damage over time) without naming a specific cost
or timeline as fact.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Interior shot of a car footwell, wet carpet with visible pooled water, macro
   angle, no driver visible, soft overcast light through the window suggesting after rain.
2. **0:04–0:09** — Close-up macro on soaked interior carpet with standing water droplets; cut to
   an exterior close-up of the wiper-cowl panel with visible leaf and grit debris (no hand in
   frame).
3. **0:09–0:15** — Macro/cutaway shot: cowl panel lifted, showing a drain channel packed with
   leaves and grit, water pooling instead of draining through it, slow push-in.
4. **0:15–0:21** — Close-up of a rust-stained floor-pan section and an exposed wiring harness with
   light corrosion near the firewall, dim garage lighting, subtle dramatic emphasis.
5. **0:21–0:26** — Inspection shot: a mounted/clipped inspection light beam illuminating the cowl
   drain channel (no hand in frame), shop bay softly blurred behind.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 2, 3,
and 5 into two sub-shots each (quick punch-in or angle change) to reach ~10–12 sub-clips at
~2.5–3s apiece before this pack is fed to real generation. Flagging this explicitly rather than
presenting the 6-beat table as render-ready.

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
- Hashtags: `#CarMaintenance #CarTips #AutoRepair #CarInterior #ClevelandAuto #NicksTireAndAuto #CarLeak #RainyDayCarCare`
- Caption (feed): "🌧️ Wet carpet after it rains? One clue: a clogged cowl drain backs water up
  right into the cabin — not a window seal. Don't guess where it's coming from — stop by and we'll
  take a look. 🚗"

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` → **estimated generation cost if run today: $0.00** for
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
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated ~52/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
| Server re-score at enqueue | **BLOCKED** | No `/api/admin/reel-canary {action:"start"}` call made — no credentials/route |
| Render-integrity gate (#800/#801) | **N/A — not rendered** | No MP4 exists this session |
| Rendered QA / vision critic (`renderedQa.ts`) | **N/A — not rendered** | Same |
| Repair routing / 7-way decision | **N/A** | No job exists to route |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED (by absence of a job)** | Cannot evaluate a gate against a nonexistent render — this is the gate's own `unavailable` state, not a silent pass |
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Directory scan (~150 topics) + live PR-title search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 8 | Wet interior carpet is an immediately legible, relatable "uh oh" hook |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "leak," "carpet," "drain," "cowl" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **51/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Wet carpet after it rains? It might not be a
leak at all."}` to re-score, render, and move toward publish.

**Operator note on the PR queue:** only 3 reel-pack-related PRs are currently open, none a
competing new-topic pack (two backlog-status notes, one captions fix on an already-merged pack —
see §1). The prior 15-PR open-pack backlog has cleared. No queue escalation needed this run.
