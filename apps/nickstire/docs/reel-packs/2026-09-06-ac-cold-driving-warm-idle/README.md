# Reel pack — "Cold air at 40 mph, warm air at a red light?"

Produced by a **scheduled task** firing (2026-09-06), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read. This
session made none of those calls. Deliverable is a full production-ready **pack**, not a claimed
render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE`/`PRODUCTION` per the skill's mode table —
  research/score/pack only, no render, no publish).
- Timestamp: 2026-09-06 (session clock).
- Capability check this session: `which ffmpeg` — **missing**; `which capcut` — **missing**;
  `env | grep -iE 'openai|higgsfield|meta|facebook|instagram|elevenlabs|tts|graph_api'` — **no
  matches**. No ChatGPT, TTS, Higgsfield, Meta-posting, or CapCut tool exists in this session's
  toolset either (confirmed by tool search, not assumed). Result: **BLOCKED: NO MOTION ROUTE** this
  session -> full pack produced per the skill's explicit fallback, not a downgraded stills-only
  asset. `getHiggsfieldAccountHealth()` was **not called** (no running server, no credentials, no
  network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — inherited doc-truth, not a live read this session.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check instead:
  - `ls apps/nickstire/docs/reel-packs/2026-*/` — **145 merged pack directories**
    (`2026-08-14` through `2026-09-06`, the newest being `2026-09-06-nitrogen-vs-air-tire-fill` and
    `2026-09-06-coolant-reservoir-safe-check`).
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack"
    in:title)` — **2 open PRs** at time of this run: #2141 (2026-09-06, "rear wiper fuse vs
    motor" — a different topic, filed ~2 hours before this run) and #2140 (2026-09-06,
    status-only backlog note: "0 open PRs, no new pack"). This is a substantial improvement over
    the 11-open/141-flagged backlog a prior run (2026-09-05) escalated — the queue has clearly
    been worked down since.
  - Checked this pack's topic (AC blows cold while driving but goes warm at idle, pointing to
    condenser-airflow/fan behavior) against all 145 merged topics and both open-PR titles — **no
    overlap found.** Every existing AC-related pack (`ac-not-blowing-cold` 08-18,
    `ac-recharge-myth-sealed-system` 08-21, `ac-blend-door-actuator-hot-cold-split` 08-25,
    `ac-compressor-clutch-not-engaging` 08-25, `musty-ac-smell-evaporator-vs-filter` 08-20,
    `heater-not-blowing-hot` 08-20) addresses a different fault mode — none covers the
    speed-dependent idle-vs-driving symptom split that points at condenser cooling-fan behavior
    specifically.
  - Still unresolved from prior runs (no DB access this session either): whether migration
    `0112_reel_publish_approvals.sql` has been applied to production TiDB. Treating the publish
    door as still shut absent explicit operator confirmation.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this backlog window. Scored against the
skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 3/5 | A relatable "why is my AC cold at speed but warm stopped" moment, but no visual failure event to open on |
| Distinct symptom cluster | 5/5 | No existing pack covers the idle-vs-driving AC split (see §1) |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 145+2 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 5/5 | All beats are static macro/cutaway/shop-bay shots; no moving-hand or dealership-specific footage required |

Selected: **"Cold air at 40 mph, warm air at a red light?"** No runner-up concept was generated —
single-topic run, consistent with sibling packs in this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). The claim below is **general automotive knowledge**: an AC system that cools fine
  while the car is moving but goes warm at idle or in stop-and-go traffic is a textbook clue that
  the condenser isn't getting enough airflow when there's no ram air — usually a cooling fan that
  isn't kicking on, a clogged condenser, or a low-refrigerant charge that only cools reliably with
  extra airflow from driving speed. This is not a shop-specific sourced fact. `entailment` status:
  **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No weather/seasonal/local-event claim is made in this script — kept out entirely rather than risk
  an unverified seasonal framing (even though AC-in-heat is seasonally relevant, the script does
  not assert current weather).
- **UNKNOWN, explicitly:** live entailment status of the idle-airflow/condenser-fan fault-tree
  claim; whether Nick's Tire & Auto specifically performs AC diagnosis and condenser-fan/refrigerant
  service (near-certain for a full-service auto shop, but not confirmed against a live
  `business_facts` row this session); whether `0112_reel_publish_approvals.sql` has been applied to
  production (see §1).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "AC ice-cold on the highway, then goes warm the second you sit at a light?" |
| 0:04–0:09 | SYMPTOM | "That speed-dependent switch isn't random — it's a real clue about what's wrong." |
| 0:09–0:15 | EXPLANATION | "One clue: it usually points to airflow at the condenser — without wind from driving, something isn't moving air across it." |
| 0:15–0:21 | CONSEQUENCE / DIFFERENTIATOR | "Could be a cooling fan that isn't kicking on, a clogged condenser, or a charge that's just low enough to need the extra airflow." |
| 0:21–0:26 | SAFE ACTION | "Don't just top off refrigerant and hope — a quick check can point to the actual cause." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before a summer traffic jam turns into a sweatbox. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess/don't just · stop by and we'll take a look.* No
prices, no guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Static shot through a car's dashboard AC vent, cold mist/condensation visibly
   swirling from the vent opening, dim cabin interior, no hand or person in frame.
2. **0:04–0:09** — Close-up on a dashboard AC temperature/fan control cluster, ambient light
   shifting subtly to suggest change, static camera, no hand adjusting it.
3. **0:09–0:15** — Front-of-engine-bay shot of an AC condenser core (thin finned radiator-like unit
   behind the grille), static mounted camera, dim garage light, no hands or tools in frame.
4. **0:15–0:21** — Close-up cutaway macro on an electric cooling fan assembly mounted behind the
   condenser, blades static, dim garage lighting, no person in frame.
5. **0:21–0:26** — Close-up on an AC service gauge manifold connected to a low-side port, gauge
   needle visible, static camera, ambient shop lighting, no hands in frame.
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
- Hashtags: `#CarAC #ACRepair #CondenserFan #SummerCarCare #CarMaintenance #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "❄️ AC ice-cold on the highway but warm the moment you stop? That speed-dependent
  switch usually points to airflow at the condenser — a fan, a clog, or a charge that needs the
  extra help from driving speed. Stop by and we'll take a look."

### Two ad-ready hook/caption/CTA variants

**Variant A — relatable-moment angle**
- Hook: "Cold on the highway. Warm at the red light. Sound familiar?"
- Caption: "That's not random — it's a real clue. One check can point to what's actually blocking
  airflow at the condenser before summer traffic makes it worse."
- CTA: "Stop by and we'll take a look."

**Variant B — myth-correction angle**
- Hook: "Topping off your AC refrigerant might not fix this."
- Caption: "If it's cold moving and warm stopped, the problem is usually airflow, not just charge.
  A quick check tells you which — before you pay for refrigerant you didn't need."
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
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated ~47/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
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
| First-frame scroll-stop (10) | 6 | Relatable-moment hook (AC vent mist) is engaging but not a visual failure event |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook -> symptom -> explanation -> consequence -> safe action -> CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 3 | "AC," "condenser," "fan" present in captions; less tire/brake-specific vocabulary than sibling packs |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **48/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete and
internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close. No
render was attempted, no generation spend occurred, no DB was read, and no publish call was made. An
operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Cold air at 40 mph, warm air at a red
light?"}` to re-score, render, and move toward publish — contingent on
`0112_reel_publish_approvals.sql` (§1, §7) actually being applied, which remains unconfirmed.

**Operator note:** at the moment of this run, only **2** `reel pack`-titled PRs sit open (#2141,
a different-topic pack from ~2 hours prior, and #2140, a status-only note) — a marked improvement
over the 11-open/141-flagged backlog a 2026-09-05 run escalated. No duplicate-topic or overproduction
signal found this run; proceeding with one new-topic pack was consistent with the now-healthy queue
depth.
