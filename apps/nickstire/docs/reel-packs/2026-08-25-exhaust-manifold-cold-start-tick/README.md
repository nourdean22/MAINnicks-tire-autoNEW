# Reel pack — "That ticking sound when you start your car cold? It might be an exhaust manifold leak"

Produced by a **scheduled task** firing (2026-08-25), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-25 (session clock).
- Capability check this session: no running nickstire server (`ps aux` shows only the harness's
  own environment-manager process — no `node`/`tsx` server), only `.env.example` present under
  `apps/nickstire/` (no real `.env`) — so no `DATABASE_URL`, no `ADMIN_API_KEY`, no Higgsfield
  credential, no TTS provider key, no Meta/Instagram token reachable this session. `ffmpeg` —
  **not installed** (`which ffmpeg` empty). No ChatGPT/OpenAI tool, no dedicated TTS tool, no
  Higgsfield MCP tool, and no Meta/Instagram posting tool are connected to this session (checked
  the full connected + deferred tool list; none present). Result: **BLOCKED: NO MOTION ROUTE**
  this session → full pack produced per the skill's explicit fallback, not a downgraded
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
  - `ls apps/nickstire/docs/reel-packs/` — **97 prior pack directories** (`2026-08-14` through
    `2026-08-25`, including five already produced today: `ac-blend-door-actuator-hot-cold-split`,
    `alternator-bearing-whine-vs-belt-squeal`, `collapsing-radiator-hose`,
    `misfire-shudder-coil-vs-plug`, `o2-sensor-rough-idle-poor-mpg`), spanning tires, brakes,
    cooling, electrical, drivetrain, HVAC, exhaust, and emissions.
  - `list_pull_requests(state=open)` on this repo — **2 open PRs total**, `#1830`
    ("stage the two SMS-capable crons behind the manual trigger") and `#1824` (a dependabot dev-dep
    bump) — **zero** open `reel pack` PRs. The 7-PR backlog flagged by the prior (O2 sensor) pack's
    run has since cleared; no batch-review blocker exists this run.
  - Checked this pack's topic (exhaust manifold leak — cold-start ticking noise that fades as the
    engine warms) against all 102 merged-or-recent topics — **no overlap found.** Nearest
    neighbors are `turbo-whistle-vs-boost-leak` (2026-08-24, a whistle/hiss under boost, not a
    cold-start tick), `exhaust-suddenly-loud-rusted-muffler` (2026-08-23, a volume/rust failure
    downstream of the manifold, not a leak at the head), `rotten-egg-exhaust-smell`
    (2026-08-22, a catalytic-converter odor symptom, not a mechanical tick), and
    `timing-chain-rattle-cold-start` (2026-08-21, also a cold-start noise but a rattle from the
    timing case, not a tick from the exhaust flange) — close enough on the "cold start noise"
    shape that the script below deliberately names the exhaust manifold and the metal-contraction
    mechanism early, to keep the two distinguishable.

## 2. Candidate scores and selected concept

Single-concept run (topic backlog is not the binding constraint this run — see §1, zero open
reel-pack PRs). Scored against the skill's rubric out of 5 per dimension, self-estimated (no live
critic panel — no DB/tournament access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | A named, specific noise ("that ticking sound") is a proven curiosity hook shape in this pack series |
| Distinct symptom cluster | 5/5 | Cold-start-only ticking that fades as the engine warms is mechanically specific — distinct from the rattle/whistle/smell topics already produced |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only; the carbon-monoxide mention is a factual mechanism note, not fearmongering, and pairs with a calm "don't ignore / get it checked" CTA |
| Novelty vs. existing 102 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll; no dealership-specific footage required |

Selected: **"That ticking sound when you start your car cold? It might be an exhaust manifold
leak."** No runner-up concept was generated — single-topic run, consistent with sibling packs in
this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). The mechanical claim below is **general automotive-repair knowledge** (a small gap
  at an exhaust manifold gasket or crack contracts when cold and expands as the engine warms,
  producing a tick that quiets as the joint seals — and, separately, that gap can allow exhaust
  gas, including carbon monoxide, to escape into the engine bay before it reaches the tailpipe),
  not a shop-specific sourced fact. `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not
  `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the manifold-leak/cold-start-tick claim;
  whether Nick's Tire & Auto specifically stocks/services exhaust manifold gaskets (near-certain
  for a general repair shop, but not confirmed against a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "That ticking sound when you start your car cold?" |
| 0:04–0:09 | SYMPTOM | "Loudest right after startup. Quiets down in a minute or two." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: a small exhaust manifold leak. Metal contracts when cold, so the gap ticks until it seals up warm." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "That gap can also let exhaust gas — including carbon monoxide — into the engine bay." |
| 0:21–0:26 | SAFE ACTION | "Don't ignore a cold-start tick. A quick listen can confirm where it's coming from." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before it gets worse. Stop by and we'll take a look — Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't ignore · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Static exterior shot of a car on a cold morning, visible exhaust vapor
   condensing from the tailpipe against frosty air, frost lightly dusting the windshield, engine
   idling, low winter sun.
2. **0:04–0:09** — Low-angle under-hood shot of an idling engine bay, camera holding steady as
   subtle heat-shimmer builds near the exhaust manifold over the shot (visual metaphor for the
   engine warming up).
3. **0:09–0:15** — Macro/cutaway shot: an exhaust manifold flange with a visible thin carbon-soot
   streak trailing from the gasket seam, slow push-in revealing the leak path.
4. **0:15–0:21** — A handheld-style (fixture-mounted, no hand in frame) combustion/CO leak
   detector wand held near the manifold gap, small indicator light activating, dim shop-bay
   lighting.
5. **0:21–0:26** — A mechanic's stethoscope-style listening probe clipped against an engine
   component (tool visible, no hand or arm in frame), a simple audio-waveform graphic overlay
   pulsing in sync with engine idle.
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
- Hashtags: `#CarMaintenance #ExhaustLeak #CarSounds #ColdStart #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🥶 Ticking sound when you start your car cold, gone a minute later? One clue
  mechanics check: a small exhaust manifold leak — metal contracts cold, so it ticks until the
  joint seals warm. Don't ignore it. Stop by and we'll take a look. 🔧"

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
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Substituted directory + open-PR search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 7 | Cold-morning tailpipe-vapor close-up is a recognizable, seasonal hook, slightly less universal than a dashboard-gauge hook |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline; CO mention is factual and paired with a calm CTA |
| Keyword (5) | 4 | "ticking sound," "cold start," "exhaust manifold leak," "engine" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **50/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"That ticking sound when you start your car
cold? It might be an exhaust manifold leak."}` to re-score, render, and move toward publish.

**Operator note:** zero open `reel pack` draft PRs exist right now (checked via
`list_pull_requests(state=open)` — only `#1830` and `#1824`, neither reel-related), so no
batch-review backlog blocks this or future runs. Six packs have now been produced today
(2026-08-25); worth a periodic sanity check that review throughput is keeping pace with the daily
firing cadence, but not a blocker for this run.
