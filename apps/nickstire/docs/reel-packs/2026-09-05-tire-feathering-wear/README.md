# Reel pack — "Run your hand across your tread — feel that saw-tooth edge?"

Produced by a **scheduled task** firing (2026-09-05), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read. This
session made none of those calls. Deliverable is a full production-ready **pack**, not a claimed
render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE`/`PRODUCTION` per the skill's mode table —
  research/score/pack only, no render, no publish).
- Timestamp: 2026-09-05 (session clock).
- Capability check this session: `which ffmpeg` — **missing**; `env | grep -iE
  'openai|higgsfield|meta|facebook|instagram|elevenlabs|tts|graph_api'` — **no matches**; `which
  capcut` — **missing**. No ChatGPT, TTS, Higgsfield, Meta-posting, or CapCut tool exists in this
  session's toolset either (confirmed by tool search, not assumed). Result: **BLOCKED: NO MOTION
  ROUTE** this session -> full pack produced per the skill's explicit fallback, not a downgraded
  stills-only asset. `getHiggsfieldAccountHealth()` was **not called** (no running server, no
  credentials, no network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Treat this as inherited
  doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check instead:
  - `ls apps/nickstire/docs/reel-packs/2026-*/` — **136 merged pack directories**
    (`2026-08-14` through `2026-09-04`), spanning tires, brakes, cooling, electrical, drivetrain,
    HVAC, and emissions.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack"
    in:title)` — **11 open PRs** at time of this run: #2125 and #2124 and #2123 and #2122 (four
    consecutive "backlog status — no change, no new pack" notes, filed roughly hourly between
    18:32 and 00:30), #2121 (back-to-school carpool), #2120 (trunk release), #2118 (sunroof),
    #2117 (EPS warning light), #2116 (fuel filter), #2115 (CV axle boot), #2114 (blind spot
    monitor).
  - Checked this pack's topic (tire feathering / saw-tooth tread wear, and the toe-misalignment vs.
    worn-tie-rod distinction) against all 136 merged topics and all 11 open-PR titles — **no
    overlap found.** Nearest neighbors are `uneven-tire-wear-patterns` (2026-08-18, general
    cupping/edge/center wear categories) and `tie-rod-steering-wobble-test` (2026-08-20, steering
    wobble while driving, not a tread-wear symptom). This script is framed specifically around the
    tactile saw-tooth feathering pattern and the "alignment alone may not fix it" distinction,
    which neither existing pack covers.
  - Still unresolved from prior runs (no DB access this session either): whether migration
    `0112_reel_publish_approvals.sql` has been applied to production TiDB. Treating the publish
    door as still shut absent explicit operator confirmation.

## 2. Candidate scores and selected concept

Single-concept run (topic backlog is not the binding constraint this run — see §1 and the operator
note in §9). Scored against the skill's rubric out of 5 per dimension, self-estimated (no live
critic panel — no DB/tournament access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 3/5 | A tactile tread-texture hook (macro raking light on tread blocks) is visually distinct but quieter than a warning light or a failure event |
| Distinct symptom cluster | 5/5 | No existing pack covers feathering specifically, or the toe-vs-worn-part distinction (see §1) |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 136+11 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 5/5 | All beats are static macro/cutaway/shop-bay shots; no moving-hand or dealership-specific footage required |

Selected: **"Run your hand across your tread — feel that saw-tooth edge?"** No runner-up concept
was generated — single-topic run, consistent with sibling packs in this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). The feathering/toe-misalignment/worn-tie-rod claim below is **general automotive
  knowledge** (a saw-tooth or "feathered" tread edge — one side of each tread block sharp, the
  other rounded — is a textbook toe-misalignment wear pattern, but a worn tie rod end or bushing
  can reproduce the same wear because it lets toe drift out of spec again after an alignment),
  not a shop-specific sourced fact. `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not
  `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No weather/seasonal/local-event claim is made in this script (unlike some sibling packs) — kept
  out entirely rather than risk an unverified seasonal framing.
- **UNKNOWN, explicitly:** live entailment status of the feathering/toe/tie-rod fault-tree claim;
  whether Nick's Tire & Auto specifically performs toe/alignment diagnosis and tie-rod replacement
  (near-certain for a tire-and-alignment shop, but not confirmed against a live `business_facts`
  row this session); whether `0112_reel_publish_approvals.sql` has been applied to production
  (see §1).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Run your hand across your tire tread — feel sharp on one side, smooth on the other?" |
| 0:04–0:09 | SYMPTOM | "That saw-tooth feel is called feathering — it doesn't show up as a bulge or a crack, you have to feel for it." |
| 0:09–0:15 | EXPLANATION | "One clue: it usually points to toe misalignment — the tires pointed slightly in or out instead of straight." |
| 0:15–0:21 | CONSEQUENCE / DIFFERENTIATOR | "But an alignment alone doesn't always fix it — a worn tie rod end or bushing can cause the same wear and needs replacing first." |
| 0:21–0:26 | SAFE ACTION | "Don't guess which one it is. A quick check can point to the actual cause." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before it eats through a new set of tires. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Extreme macro shot of a tire tread block pattern under raking side light,
   texture strongly emphasized, static camera, no hand or tool in frame.
2. **0:04–0:09** — Extreme macro of a single tread block edge in profile: one side crisp and sharp
   in shadow, the opposite side visibly rounded/worn smooth, hard side lighting, slow push-in.
3. **0:09–0:15** — Undercarriage/wheel-well shot of a front tire and the visible steering
   knuckle/tie-rod area, static mounted camera, dim garage lighting.
4. **0:15–0:21** — Close-up cutaway macro of a tie rod end and its rubber boot showing visible
   looseness/play, static mounted camera, dim garage light, no hands or tools in frame.
5. **0:21–0:26** — Close-up on an alignment-rack wheel clamp and sensor target mounted on a wheel
   in a shop bay, static camera, ambient shop lighting, no person in frame.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 1, 3, and
4 into two sub-shots each (angle change or push-in) to reach ~10–12 sub-clips at ~2.5–3s apiece
before this pack is fed to real generation. Flagging this explicitly rather than presenting the
6-beat table as render-ready.

### Assembly instructions (ffmpeg/CapCut)

1. Order clips exactly as beats 1→6 above (after the sub-shot split noted above).
2. Trim each sub-clip to its allotted window; hard-cut or short (≤0.2s) crossfade between beats — no
   `zoompan`/Ken-Burns stills filters (documented cause of the frozen-frame regression in
   `REEL-PIPELINE.md` §"Render-integrity gate").
3. Burn in captions from `captions.srt` (below), bottom-third safe zone, high-contrast style
   matching the account's existing caption preset.
4. Composite the Nick's Tire & Auto logo and CTA text on beat 6 only, in post (not generated).
5. Mix voiceover (TTS, not produced this session — no TTS credential available) as the primary audio
   layer; add a 3s freeze-frame "SAVE" card after 0:30 per the storyboard contract used by the
   render-integrity gate (container duration = beats + 3s freeze ≈ 33s).
6. Export 9:16, 1080×1920, H.264, target ≥30fps throughout (render-integrity gate requires ≥80% of
   expected 30fps frame count).

### Posting specs

- Platform: Instagram Reels (primary), cross-post to Facebook Reels via the same asset.
- Dimensions: 1080×1920 (9:16), MP4, ≤30s target already met.
- Hashtags: `#TireWear #TireFeathering #WheelAlignment #TireCare #CarMaintenance #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🛞 Feel a saw-tooth edge across your tread? That's feathering — usually toe
  misalignment, but sometimes a worn tie rod that needs replacing before the alignment will hold.
  Stop by and we'll take a look."

### Two ad-ready hook/caption/CTA variants

**Variant A — curiosity/tactile angle**
- Hook: "Run your hand across your tread. Feel that?"
- Caption: "One side of each tread block sharp, the other rounded? That's feathering — one clue it
  usually points to toe misalignment. Worth checking before it spreads."
- CTA: "Stop by and we'll take a look."

**Variant B — cost-avoidance angle**
- Hook: "An alignment might not be enough to fix this wear pattern."
- Caption: "Feathered tread can come back after an alignment if a worn tie rod end is the real
  cause. One quick check tells you which — before it eats through a new set of tires."
- CTA: "Worth checking first. Stop by and we'll take a look."

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` -> **estimated generation cost if run today: $0.00** for
  ~10–12 sub-clips on the free ffmpeg lane. This is a doc-inherited estimate, not a live balance
  read.
- `getHiggsfieldAccountHealth().balanceCredits`: **UNKNOWN** — not called this session (no
  credentials, no server).
- Day's `autonomy_policy_versions.limits.maxGenerationCostPerDayUsd` (documented default $10): **not
  read live this session** — treat as UNKNOWN, not assumed available.
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
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated ~49/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
| Server re-score at enqueue | **BLOCKED** | No `/api/admin/reel-canary {action:"start"}` call made — no credentials/route |
| Render-integrity gate (#800/#801) | **N/A — not rendered** | No MP4 exists this session |
| Rendered QA / vision critic (`renderedQa.ts`) | **N/A — not rendered** | Same |
| Repair routing / 7-way decision | **N/A** | No job exists to route |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED (by absence of a job)** | Cannot evaluate a gate against a nonexistent render — this is the gate's own `unavailable` state, not a silent pass |
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Substituted directory + open-PR search per §1; no live DB read |
| Publish-approvals migration (`0112_reel_publish_approvals.sql`) | **UNKNOWN** | Flagged unresolved by prior runs; no DB access this session either to check |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 6 | Macro tread-texture hook is visually distinct but quieter than a warning light or failure event |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook -> symptom -> explanation -> consequence -> safe action -> CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "feathering," "toe," "tie rod," "alignment" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **49/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete and
internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close. No
render was attempted, no generation spend occurred, no DB was read, and no publish call was made. An
operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Run your hand across your tire tread — feel
that saw-tooth edge?"}` to re-score, render, and move toward publish — contingent on
`0112_reel_publish_approvals.sql` (§1, §7) actually being applied, which remains unconfirmed.

**Operator note — escalating, not just repeating, this time:** at the moment of this run, **11**
`reel pack`-titled PRs sit open and unreviewed, and **four of the eleven** (#2122, #2123, #2124,
#2125) are not even content — they are "backlog status, no change, no new pack" notes filed roughly
**once an hour** between 18:32 and 00:30 on 2026-09-04 alone. PR #2076 (2026-09-02) already flagged
a ~141-item backlog and asked whether this trigger's cadence should be reduced or paused; that
question is still open three days and dozens of runs later, and the trigger has since started
producing status-only PRs in addition to topic packs — meaning the backlog is now growing on two
fronts at an hourly cadence, not one. Repeating "please review" a fifth time without a decision
adds another data point, not a fix. Concretely, for whoever next has operator access: **the fastest
correction is reducing this trigger's firing interval (or pausing it outright) until the existing
backlog is merged or closed** — this session has no ability to see or modify that schedule from
inside a run it did not create, only to keep naming the count each time it fires.
