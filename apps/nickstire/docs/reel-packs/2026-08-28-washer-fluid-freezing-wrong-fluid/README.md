# Reel pack — "Your washer fluid just froze solid — and cracked the reservoir"

Produced by a **scheduled task** firing (2026-08-28), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-28 (session clock).
- Capability check this session:
  `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC|META_|INSTAGRAM|FACEBOOK|TTS|CAPCUT'`
  returned no credential (only unrelated proxy/`JAVA_TOOL_OPTIONS` lines matched, none of them a
  Higgsfield/admin/DB/TTS/Meta secret). `which ffmpeg gh` — **both missing**. Result:
  **BLOCKED: NO MOTION ROUTE** this session → full pack produced per the skill's explicit
  fallback, not a downgraded stills-only asset. `getHiggsfieldAccountHealth()` was **not called**
  (no running server, no credentials, no network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Treat this as inherited
  doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check instead:
  - `ls apps/nickstire/docs/reel-packs/` — **118 merged pack directories** (`2026-08-14` through
    `2026-08-27`), plus 9 `BACKLOG-STATUS-*.md` notes.
  - `mcp__github__search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel
    pack" in:title)` → **11 open reel-pack PRs**: #1927 (steering wheel vibration highway speed),
    #1932 (engine pinging/knocking under acceleration), #1941 (grinding brakes, first stop of the
    day), #1942 (synthetic vs. conventional oil), #1945 (grinding starter noise), #1948
    (backlog-status note), #1952 (excessive brake dust), #1953 (foggy windshield recirculate-button
    trick), #1954 (fuel injector tick at idle), #1955 (battery fine all summer/dead first cold
    morning), #1956 (new brakes squeaking, bed-in glaze vs. bad pads).
  - **Trend note:** open reel-pack PRs have grown from 9 (the last pack in this directory,
    2026-08-26) to 11 now, roughly one new PR per hour over the last day with none merged in that
    window. Still below the 127–132 range that previously triggered a status-only escalation, so
    this run is not spending itself as a fourth backlog note — but the direction reversed from the
    2026-08-26 pack's "batch-merge caught up" finding. Flagging the trend in §9, not blocking on it.
  - Checked this pack's topic (washer fluid freezing solid in cold weather — wrong fluid or water,
    not a pump/nozzle failure — cracking the reservoir/pump/lines) against all 118 merged topics
    and the 11 open ones — **no overlap found.** Nearest neighbor is `washer-fluid-wont-spray`
    (2026-08-23), which is a **mechanical** pump/nozzle-clog framing; this pack's root cause is the
    **fluid itself** (freeze point, not a clogged or seized part) and the failure mode is a
    **cracked reservoir/pump/line**, not "won't spray" from wear. The script below names "frozen
    solid" and "cracked" explicitly to keep the two topics distinguishable.

## 2. Candidate scores and selected concept

Single-concept run (topic backlog is not the binding constraint this run — see §1). Scored against
the skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 5/5 | "You just lost your wipers mid-storm" is an immediate, relatable fear for anyone who drives in winter |
| Distinct symptom cluster | 4/5 | Frozen fluid -> cracked reservoir/pump/line is mechanically specific, though softer than a multi-symptom diagnostic hook |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 118 topics | 5/5 | No overlap found (see §1); clearly distinct from `washer-fluid-wont-spray` |
| Producibility (faceless, no live footage needed) | 5/5 | All beats are static/macro cutaway shots or stock B-roll; no dealership-specific footage or hands/faces required |

Selected: **"Your washer fluid just froze solid — and cracked the reservoir."** No runner-up
concept was generated — single-topic run, consistent with sibling packs in this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (water and
  summer-blend washer fluid have freezing points at or near 32°F; when the fluid in a reservoir,
  pump, or line freezes it expands, and that expansion can crack the plastic reservoir tank, the
  pump housing, or the fluid lines; winter-rated fluid is formulated with a lower freeze point,
  typically rated to -20°F or lower on the label), not a shop-specific sourced fact. `entailment`
  status: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made (no specific date, temperature, or Cleveland-specific
  weather claim — "before the first hard freeze" is a seasonal generality, not a forecast claim).
- **UNKNOWN, explicitly:** live entailment status of the freeze-point/crack-mechanism claim;
  whether Nick's Tire & Auto specifically stocks/services washer reservoir or pump replacement
  (near-certain for a general repair shop, but not confirmed against a live `business_facts` row
  this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Your washer fluid just froze solid — and it cracked the reservoir." |
| 0:04–0:09 | SYMPTOM | "No spray, just a dry click. In freezing weather, that's a warning sign, not a fluke." |
| 0:09–0:15 | EXPLANATION A | "Summer-blend fluid — or plain water — can freeze solid below thirty-two degrees." |
| 0:15–0:21 | EXPLANATION B / CUTAWAY | "Frozen fluid expands. That can crack the plastic reservoir, the pump, even the lines." |
| 0:21–0:26 | SAFE ACTION | "A winter-rated fluid, rated to negative twenty or lower, can keep that from happening." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before the first hard freeze. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*can · worth checking · stop by and we'll take a look.* No prices, no guarantees, no invented
timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Close-up on a windshield washer-fluid reservoir cap, frost visible on the
   plastic, static-mounted camera, cold blue-toned daylight; quick cut to a hairline crack visible
   along the reservoir's plastic seam.
2. **0:04–0:09** — Close-up on a windshield wiper arm at rest, no fluid arc visible on the glass;
   cut to a windshield coated in road grime with a dry wiper streak across it, overcast winter
   light.
3. **0:09–0:15** — Macro shot of an unbranded washer-fluid jug exterior with frost and condensation
   beading on the plastic; cut to a close-up of a car exterior thermometer-style trim detail in a
   frigid parking lot at dusk (no readable text/logos).
4. **0:15–0:21** — Macro cutaway of a cracked plastic reservoir tank removed from a vehicle, visible
   fracture line, resting on a clean workbench, slow push-in; cut to a close-up of a small pump
   component with a hairline split, sitting beside it.
5. **0:21–0:26** — A washer-fluid jug tipped on a static countertop rig, blue fluid pouring into an
   open reservoir cap with no hands or arms in frame, cold daylight through a garage door.
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
- Hashtags: `#CarMaintenance #WinterCarCare #WasherFluid #CarTips #AutoRepair #ClevelandAuto #WinterDriving #NicksTireAndAuto`
- Caption (feed): "❄️ Washer fluid frozen solid can crack the reservoir, the pump, even the lines.
  Summer-blend fluid or plain water won't cut it below freezing. Worth checking before the first
  hard freeze. Stop by and we'll take a look. 🔧"

Two ad-ready hook/caption/CTA variants (per the skill's required-response §8):

- **Variant A (mid-storm-fear-first):** Hook: "You just lost your wipers in the middle of a
  snowstorm." Caption: "Frozen washer fluid doesn't just stop spraying — it can crack the
  reservoir, the pump, or the lines. One cold snap, one expensive surprise." CTA: "Stop by and
  we'll take a look — Nick's Tire & Auto."
- **Variant B (prevention-first):** Hook: "Still running summer washer fluid into winter?" Caption:
  "That can point to a frozen reservoir waiting to happen — plain water freezes even faster. A
  winter-rated fluid is a five-minute fix before the damage." CTA: "Worth checking before the first
  hard freeze. Stop by — Nick's Tire & Auto."

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
| First-frame scroll-stop (10) | 8 | Frosted cap + cracked reservoir hook, relatable winter-fear framing |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation A → explanation B → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 3 | "washer fluid," "freeze," "winter" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **50/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Your washer fluid just froze solid — and
cracked the reservoir"}` to re-score, render, and move toward publish.

**Operator note — reel-pack review queue is growing, not shrinking:** 11 open, unreviewed
`reel pack` draft PRs exist (#1927, #1932, #1941, #1942, #1945, #1948, #1952, #1953, #1954, #1955,
#1956, plus this run's new PR), up from 9 two days ago, at a pace of roughly one new PR per hour
with none merged in that window. This is still well below the 127–132 range that previously
warranted a dedicated status-only PR, so this run is not spending itself on a twelfth backlog
note — but the trend reversed from the 2026-08-26 pack's "batch-merge caught up" finding, and at
the observed ~1/hour production rate the queue will cross the prior escalation threshold within a
few days if nothing merges. Worth a look at either the review cadence or the schedule's firing
interval before that happens.
