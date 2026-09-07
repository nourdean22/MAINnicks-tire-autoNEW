# Reel pack — "Steering feels heavy and there's no fluid to check? That's normal."

Produced by a **scheduled task** firing (2026-09-04), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-09-04 (session clock).
- Capability check this session:
  `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC|META_|INSTAGRAM|FACEBOOK|TTS|CAPCUT'`
  returned **nothing** — no Higgsfield credential, no `ADMIN_API_KEY`, no `DATABASE_URL`, no TTS
  provider key, no Meta/Instagram token. Also checked local binaries: `ffmpeg`/`ffprobe` —
  **missing** (`which ffmpeg ffprobe` returned nothing). Result: **BLOCKED: NO MOTION ROUTE** this
  session → full pack produced per the skill's explicit fallback, not a downgraded stills-only
  asset. `getHiggsfieldAccountHealth()` was **not called** (no running server, no credentials, no
  network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md:66` (doc-read, not re-verified live this
  session): prod is documented to pin `REEL_VIDEO_PROVIDER=template_stock` — the free
  local-ffmpeg lane, not Higgsfield/Seedance/Veo. If this pack is fed to the real pipeline today,
  per-clip generation cost is expected to be **$0**, per that documented pin.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended run per `prod-db-guard`).
  Substituted the two offline checks the skill itself requires:
  - `ls -d apps/nickstire/docs/reel-packs/2026-*/ | wc -l` — **145 merged pack directories**
    (`2026-08-14` through `2026-09-04`, including today's four merged packs: `backup-camera-black-screen`,
    `fall-car-care-checklist`, `heated-seats-not-working`, `remote-start-not-working`). Steering-related
    topics already merged: `power-steering-whine` (08-18, hydraulic-pump whine with fluid present),
    `power-steering-fluid-leak-color` (08-28, visible fluid leak diagnosis), `tie-rod-steering-wobble-test`
    (08-20, mechanical looseness), `steering-vibration-highway-speed` (08-27, vibration not assist
    failure), `steering-wheel-crooked-after-tires` (08-28, alignment after tire work). None of them
    covers an **electric** power-steering (EPS) system that has no fluid reservoir at all.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack"
    in:title)` — **3 open reel-pack PRs**: #2114 blind spot monitor light, #2115 CV axle boot
    grease-sling, #2116 fuel filter clogged/hesitation. None overlaps steering assist.
  - Checked this pack's topic (EPS fault light, heavy steering, no fluid to check) against all 145
    merged + 3 open topics — **no overlap found.**

## 2. Candidate scores and selected concept

Two candidates were scored; one selected, one parked — both against the skill's rubric out of 5
per dimension, self-estimated (no live critic panel — no DB/tournament access this session):

| Candidate | Scroll-stop hook | Distinct symptom cluster | Claim safety | Novelty vs. 145 merged + 3 open | Producibility (faceless) |
|---|---|---|---|---|---|
| **A — EPS warning light, heavy steering, no fluid to check** | 5/5 — directly contradicts a common driver assumption (go check the fluid) | 5/5 — distinct fault tree from the merged hydraulic-fluid and mechanical-wobble steering packs | 5/5 | 5/5 — no overlap found | 4/5 — all beats plausible AI-gen/stock, no dealership-specific footage |
| B — Steering wheel vibrates only above 50mph (tire balance vs. wheel bearing) — parked | 4/5 | 3/5 — close to merged `steering-vibration-highway-speed` (08-27) and `alternator-bearing-whine-vs-belt-squeal`-style "which part is it" framing; risks reading as a re-skin | 5/5 | 2/5 — meaningful overlap risk with the merged highway-speed vibration pack | 4/5 |

Selected: **"Steering feels heavy and there's no fluid to check? That's normal — here's why."**
Candidate B parked — too close to the merged `steering-vibration-highway-speed` pack to clear the
novelty bar without a sharper distinguishing hook than this session could verify offline.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (many newer
  vehicles use electric power steering — a motor mounted on the steering column or rack driven by
  a control module, with no hydraulic pump, no belt, and no fluid reservoir at all; when that
  module detects a fault — a bad torque sensor, a wiring issue, or a motor fault — it can reduce or
  remove steering assist and light a dash warning, producing heavy steering with nothing to top off
  or bleed), not a shop-specific sourced fact. `entailment` status: **`not_evaluated`** — mark
  `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is asserted as current fact.
- **UNKNOWN, explicitly:** live entailment status of the EPS fault-tree claim; whether Nick's Tire
  & Auto's actual diagnostic process names torque sensor/wiring/motor faults in this same framing
  (near-certain for any general shop scanning EPS codes, but not confirmed against a live
  `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Steering suddenly feels heavy, and there's no power steering fluid to check? That's not a mistake." |
| 0:04–0:09 | SYMPTOM | "A lot of newer cars don't use hydraulic fluid at all — an electric motor does the work instead." |
| 0:09–0:16 | EXPLANATION | "When that system logs a fault, you get a warning light and heavy steering — no leak, no whine, nothing to top off." |
| 0:16–0:22 | CONSEQUENCE | "Driving on it means driving with little or no power assist until it's actually scanned." |
| 0:22–0:26 | SAFE_ACTION | "Don't go hunting for a power steering reservoir that isn't there." |
| 0:26–0:30 | BRANDED_CTA | "It needs a scan tool, not a fluid top-off. Stop by and we'll pull the code. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*can point to (implied by "logs a fault") · worth checking (implied CTA framing) · don't guess/don't
go hunting · stop by and we'll take a look (pull the code).* No prices, no guarantees, no invented
timelines. Ran the approved-pattern-bank check by hand against `facelessReelStudio.ts`'s deny rules
(`no-you-need`, `no-this-means-bad`, `no-definitely-need`) — no matches in this script.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Interior shot, static-mounted camera behind the steering wheel at dash height,
   dim cabin lighting, a small amber steering-wheel warning icon glowing on the instrument cluster.
2. **0:04–0:09** — Engine bay cutaway-style shot: a compact electric motor unit mounted on a
   steering column/rack assembly, clean shop lighting, slow push-in, no hydraulic hoses or belt
   visible in frame.
3. **0:09–0:16** — Macro shot: the same instrument-cluster warning icon steady/lit, cut to a
   diagnostic scan-tool screen (blurred generic fault-code text, non-specific) plugged into an OBD
   port under the dash.
4. **0:16–0:22** — Wide interior shot, steering wheel held steady by a mounted rig (no hands), a
   subtle stiff/resistant motion cue on the wheel to suggest reduced assist.
5. **0:22–0:26** — Close-up under the hood where a power-steering fluid reservoir would normally
   sit — empty mounting bracket only, no reservoir present, shop-bay lighting.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's documented contract ("captions and logos are
   composited in post," per `REEL-PIPELINE.md:81`, doc-read not re-verified live this session).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 2, 3,
and 4 into two sub-shots each (angle change or push-in/pull-back) to reach ~10–12 sub-clips at
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
- Hashtags: `#PowerSteering #CarWarningLights #CarMaintenance #CarTips #AutoRepair #ElectricPowerSteering #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🛞 Heavy steering and a warning light, but no fluid to check? A lot of newer
  cars run electric power steering — no pump, no hoses, no reservoir. That means it needs a scan,
  not a top-off. Stop by and we'll pull the code. 🔧"

Ad-ready variant A (hook/caption/CTA): Hook — "Your steering just got heavy and there's no
power-steering fluid anywhere under the hood." Caption — "That's normal on a lot of newer cars —
they run electric power steering. A warning light there means a fault code, not a leak." CTA —
"Stop by Nick's Tire & Auto — we'll scan it."

Ad-ready variant B (hook/caption/CTA): Hook — "Warning light on, steering heavy — and you can't
find the fluid reservoir?" Caption — "You're not missing it. Electric power steering doesn't have
one. It needs a code pulled, not fluid topped off." CTA — "Nick's Tire & Auto — worth checking,
no pressure."

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts:28-37` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip
  = $0.25` (labeled ASSUMPTION in source), `template_stock_clip = $0`, `veo_second_720p = $0.10`
  (the one Google-published figure).
- Per `REEL-PIPELINE.md:66` (doc-read, not re-verified live this session), prod is documented to
  pin `REEL_VIDEO_PROVIDER=template_stock` → **estimated generation cost if run today: $0.00** for
  ~10–12 sub-clips on the free ffmpeg lane.
- `getHiggsfieldAccountHealth().balanceCredits`: **UNKNOWN** — not called this session (no
  credentials, no server).
- Day's `autonomy_policy_versions.limits.maxGenerationCostPerDayUsd`: **not read live this
  session** — treat as UNKNOWN, not assumed available.
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
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Directory scan (145 merged) + open-PR title search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 8 | "No fluid to check" directly subverts the viewer's expected fix (checking fluid) |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline; hand-checked against deny patterns |
| Keyword (5) | 4 | "power steering," "warning light," "scan," "fault" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **51/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Steering feels heavy and there's no fluid to
check? That's normal — here's why."}` to re-score, render, and move toward publish.
