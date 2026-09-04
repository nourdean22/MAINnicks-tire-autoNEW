# Reel pack — "Your seatbelt light won't turn off — even after you buckle up"

Produced by a **scheduled task** firing (2026-09-01), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-09-01 (session clock).
- Capability check this session:
  `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC|META_|INSTAGRAM|FACEBOOK|TTS|CAPCUT'`
  returned no credential (only unrelated proxy/`JAVA_TOOL_OPTIONS` no-proxy lists matched, none of
  them a Higgsfield/admin/DB/TTS/Meta secret). `which ffmpeg` / `which gh` — **both missing**
  (GitHub access this session is via the MCP `github` connector, not a local `gh` binary). Result:
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
  - `ls apps/nickstire/docs/reel-packs/` — **136 merged pack directories** (`2026-08-14` through
    `2026-08-28`), plus 10 `BACKLOG-*.md` notes.
  - `mcp__github__search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel"
    in:title)` → **3 open reel PRs**: #2037 (clutch pedal sinking to the floor / hydraulic leak),
    #2038 (backlog-status note, no new pack), #2041 (car alarm false-trigger — hood latch / fob
    battery). Well below the 127–132 range that previously triggered a status-only escalation, so
    this run proceeds with a new pack rather than another backlog note.
  - Checked this pack's topic (seatbelt warning chime/light staying on after the belt is buckled —
    a buckle-switch/sensor fault, not the webbing or pretensioner) against all 136 merged topics
    and the 2 open pack topics — **no overlap found.** No existing pack touches seatbelts, buckle
    switches, or chime/warning-light logic at all; nearest adjacent topics
    (`dashboard-light-colors`, `check-engine-flashing-vs-steady`) are about the instrument cluster
    generally, not this specific warning system.

## 2. Candidate scores and selected concept

Single-concept run (topic backlog is not the binding constraint this run — see §1). Scored against
the skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 5/5 | "Your seatbelt light won't turn off" is an immediate, relatable annoyance almost every driver has hit |
| Distinct symptom cluster | 5/5 | Buckle-switch fault (light/chime persists after buckling) is mechanically specific and unlike any of the 136 existing topics |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only; frames as "have it checked," never "ignore the belt itself" |
| Novelty vs. existing 136+2 topics | 5/5 | No overlap found (see §1) — first seatbelt-system topic in the backlog |
| Producibility (faceless, no live footage needed) | 5/5 | All beats are static/macro cutaway shots of a buckle, seat, and dashboard icon; no hands/faces required |

Selected: **"Your seatbelt light won't turn off — even after you buckle up."** No runner-up
concept was generated — single-topic run, consistent with sibling packs in this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (the
  seatbelt warning light/chime is driven by a buckle switch inside the receptacle that detects
  whether the latch plate is seated; a worn, corroded, or debris-jammed switch can fail to register
  a properly buckled belt and keep the warning active even though the belt itself is fine; this is
  a sensor/switch issue, not a webbing or pretensioner failure), not a shop-specific sourced fact.
  `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — this is a year-round mechanical topic, not seasonal.
- **UNKNOWN, explicitly:** live entailment status of the buckle-switch-fault mechanism claim;
  whether Nick's Tire & Auto specifically services seatbelt buckle assemblies (near-certain for a
  general repair shop, but not confirmed against a live `business_facts` row this session).
- **Safety-framing note:** the script explicitly does NOT tell viewers to ignore the light or
  stop wearing the belt — it frames the fix as "have the switch checked," keeping the belt itself
  as the thing you always wear regardless of the warning. This avoids the claim-safety failure
  mode of sounding like it's minimizing a real safety system.

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Your seatbelt light won't turn off — even after you buckle up." |
| 0:04–0:09 | SYMPTOM | "The belt clicks in fine. The chime keeps going, or the icon stays lit anyway." |
| 0:09–0:15 | EXPLANATION | "That's usually the buckle switch — a small sensor inside the receptacle — not the belt itself." |
| 0:15–0:21 | CAUSE / CUTAWAY | "Wear, corrosion, or debris inside the buckle can stop it from registering a good latch." |
| 0:21–0:26 | SAFE ACTION | "Always wear the belt regardless — but a switch like that can point to a bigger electrical gremlin." |
| 0:26–0:30 | BRANDED CTA | "Worth checking it out. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*can · worth checking · stop by and we'll take a look.* No prices, no guarantees, no invented
timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Close-up on a car seat with a seatbelt buckled into its receptacle, static
   camera, warm interior daylight; quick cut to a dashboard instrument cluster with a seatbelt
   warning icon lit (generic icon, no readable brand text).
2. **0:04–0:09** — Macro shot of the seatbelt latch plate clicking into the buckle receptacle
   (rig-mounted, no hand/arm in frame); cut to the same dashboard icon still lit, static hold.
3. **0:09–0:15** — Macro cutaway of a seatbelt buckle receptacle removed from its mount, interior
   mechanism visible, resting on a clean workbench, slow push-in on the small switch component
   inside.
4. **0:15–0:21** — Extreme macro on the buckle switch contact points showing light surface
   corrosion/dust, shallow depth of field; cut to a small precision tool resting beside the
   opened buckle housing on the workbench (tool at rest, not in use — no hand in frame).
5. **0:21–0:26** — Close-up on a buckled seatbelt across an empty seat, calm static hold,
   soft daylight — reinforcing "always wear it" without showing a driver.
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
- Hashtags: `#CarMaintenance #SeatbeltSafety #CarTips #AutoRepair #ClevelandAuto #CarElectrical #NicksTireAndAuto #DashboardLights`
- Caption (feed): "🔔 Seatbelt chime won't stop even after you buckle up? That's usually the buckle
  switch, not the belt — wear, corrosion, or debris can stop it from registering a good latch.
  Always wear the belt regardless. Worth checking it out. Stop by and we'll take a look. 🔧"

Two ad-ready hook/caption/CTA variants (per the skill's required-response §8):

- **Variant A (annoyance-first):** Hook: "That seatbelt chime that won't shut up? It's probably
  not the belt." Caption: "A worn or corroded buckle switch can keep the warning on even after
  you're buckled in tight. One clue: it's a sensor issue, not a safety failure — but it's worth a
  look." CTA: "Stop by and we'll take a look — Nick's Tire & Auto."
- **Variant B (bigger-gremlin-first):** Hook: "One stuck seatbelt light can point to more than
  just the belt." Caption: "A buckle switch that won't register a latch is often the first sign
  of a small electrical gremlin — worth checking before it shows up somewhere else." CTA: "Worth
  checking it out. Stop by — Nick's Tire & Auto."

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
| First-frame scroll-stop (10) | 8 | Relatable dashboard-annoyance hook most drivers recognize instantly |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → cause → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline, explicitly reinforces "always wear the belt" |
| Keyword (5) | 3 | "seatbelt," "buckle," "light" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **50/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Your seatbelt light won't turn off — even
after you buckle up"}` to re-score, render, and move toward publish.

**Operator note — reel-pack review queue is small right now:** only 3 open reel PRs exist
(#2037 clutch pedal sinking, #2038 backlog-status note, #2041 car alarm false-trigger, plus this
run's new PR), well below the 127–132 range that previously warranted a dedicated status-only PR.
Unlike the trend flagged in the 2026-08-28 pack (queue growing ~1/hour with nothing merging), the
queue appears to have been substantially cleared since then — 136 packs are now merged into
`docs/reel-packs/` versus 118 at that point. No escalation needed this run.
