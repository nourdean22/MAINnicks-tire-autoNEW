# Reel pack — "A fuse that keeps blowing isn't a fuse problem — it's a short"

Produced by a **scheduled task** firing (2026-08-27), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-27 (session clock).
- Capability check this session:
  `env | grep -iE 'HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|REEL_|OPENAI|ELEVENLABS|TTS'` returned
  **nothing** — no Higgsfield credential, no `ADMIN_API_KEY`, no `DATABASE_URL`, no TTS provider
  key, no Meta/Instagram token. Also checked local binaries: `ffmpeg` — **missing** (`command -v
  ffmpeg` returned nothing); `node`/`git` — present but unused (no endpoint to call, no server
  running). This session's GitHub access is via the `mcp__github__*` connector, not a `gh` CLI.
  Result: **BLOCKED: NO MOTION ROUTE** this session → full pack produced per the skill's explicit
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
  - `ls apps/nickstire/docs/reel-packs/` — **101 merged pack directories** (`2026-08-14` through
    `2026-08-25`), topics spanning tires, brakes, cooling, electrical, drivetrain, HVAC, and
    emissions.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel" in:title)` —
    **20 open PRs**: 15 are new-topic reel packs (#1919 alternator overcharging/swollen battery,
    #1917 idle air control valve, #1906 clogged air filter, #1884 EVAP purge valve, #1880 throttle
    hesitation/MAF, #1879 CEL flashing vs. steady, #1878 exhaust hanger rattle, #1877 thermostat
    stuck, #1876 transmission delayed engagement, #1875 torque converter shudder, #1873 4WD/AWD
    driveline bind, #1867 brake light switch/cruise/shift-lock, #1865 rear defroster, #1857 AC
    compressor clutch, #1835 exhaust manifold leak); 5 are prior status-only "no new pack this run"
    notes (#1909, #1908, #1885, #1874, #1842).
  - Checked this pack's topic (a fuse that repeatedly blows = a short pulling excess current, and
    the fire-risk danger of upsizing the fuse to make it stop) against all 101 merged directories
    and all 15 open-PR topics — **no dedicated match.** A `grep -il fuse` sweep across every pack's
    `README.md`/`brief.json` found 24 hits, all incidental (e.g. `horn-wont-work` names a blown
    fuse as one possible cause among several, `battery-parasitic-drain` and
    `burning-smell-diagnosis` mention fuses in passing) — none is centered on repeat-blow diagnosis
    or the upsized-fuse fire-hazard warning. Topic selected as genuinely novel.
  - **Backlog note, not escalated to a sixth status-only PR:** 15 open new-topic reel-pack PRs is
    above the 5-PR skip threshold from the 2026-08-20/21 `BACKLOG-STATUS-*` notes, and close to the
    16–17 range that produced status-only runs #1908/#1909 as recently as yesterday. But the two
    most recent actual runs (#1917, #1919, both today) produced real packs despite that same
    backlog level, and the open count has fallen from a peak of 132 to 20 — the queue is shrinking,
    not growing unboundedly. Producing one pack this run is consistent with the two immediately
    preceding runs, not a reversal. Flagging the 15-PR queue here for the operator: **worth a batch
    review pass** before it climbs back toward the range that has twice triggered a skip.

## 2. Candidate scores and selected concept

Single-concept run (topic backlog is not the binding constraint this run — see §1). Scored against
the skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "You replace the fuse. It blows again in minutes." is a concrete, relatable failure loop |
| Distinct symptom cluster | 5/5 | Repeat-blow fuse + the upsize-fuse fire-risk warning is mechanically specific, distinct from every prior electrical pack |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 101 + 15 open topics | 5/5 | No dedicated match found (see §1) |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll; no dealership-specific footage required |

Selected: **"A fuse that keeps blowing isn't a fuse problem — it's a short."** No runner-up concept
was generated — single-topic run, consistent with sibling packs in this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-electrical knowledge** (a fuse
  that blows again immediately after replacement typically indicates a short circuit or overloaded
  circuit downstream, not a defective fuse; installing a higher-amperage fuse than the circuit is
  rated for removes the intended overcurrent protection and lets excess heat build in the wiring —
  a well-documented fire-safety hazard in automotive electrical repair), not a shop-specific
  sourced fact. `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the short-circuit/overcurrent claim; whether
  Nick's Tire & Auto specifically offers electrical short-circuit diagnosis (near-certain for a
  general repair shop, but not confirmed against a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "You replace the fuse. It blows again in minutes." |
| 0:04–0:09 | SYMPTOM | "Same accessory, same fuse, dead again — right after you swap it in." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "That can point to a short — pulling more current than the circuit is rated for." |
| 0:15–0:21 | WARNING | "A higher-amp fuse doesn't fix it — it just lets more heat build up in the wiring." |
| 0:21–0:26 | SAFE ACTION | "The circuit needs to be traced, not the fuse upsized." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before it becomes a bigger electrical repair. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*can point to · worth checking · stop by and we'll take a look.* No prices, no guarantees, no
invented timelines. Deliberately does **not** show or describe flames/fire — the heat/overload risk
is conveyed through a warning-tint visual cue (beat 4 below), not a literal fire depiction.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Macro close-up on an open vehicle fuse box panel under a small utility light,
   one socket holding a fuse with a visibly broken filament, static overhead camera, no hand in
   frame.
2. **0:04–0:09** — Cut to a fresh fuse already seated in the same socket (no insertion motion
   shown); quick cut to an interior accessory display (radio or power outlet indicator) going dark
   a second time, dim cabin lighting.
3. **0:09–0:15** — Cutaway/diagram-style macro shot of a wiring harness section with one visibly
   worn insulation spot, slow push-in, dim garage lighting, no sparks or flame shown.
4. **0:15–0:21** — Close-up comparison on a workbench: two fuses side by side, one at the correct
   amperage rating, one at a visibly higher rating with a subtle warm/orange warning-tint overlay
   suggesting heat risk (no literal flame or smoke), static camera.
5. **0:21–0:26** — A multimeter mounted on a bench stand with probe clips attached to a harness
   section, resistance/continuity reading visible on the tool's own screen, shop bay softly blurred
   behind, no hand in frame.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 2, 3, and
4 into two sub-shots each (quick punch-in or angle change) to reach ~9 sub-clips at ~3s apiece
before this pack is fed to real generation. Flagging this explicitly rather than presenting the
6-beat table as render-ready.

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
- Hashtags: `#CarMaintenance #BlownFuse #CarElectrical #AutoRepair #CarTips #ElectricalShort #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🔌 Fuse keeps blowing no matter how many times you swap it? That usually points
  to a short — not a weak fuse. Bumping the amp rating doesn't fix it, it just adds heat risk to
  the wiring. Worth having the circuit traced before it turns into a bigger repair. Stop by and
  we'll take a look. ⚡"

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` → **estimated generation cost if run today: $0.00** for ~9
  sub-clips on the free ffmpeg lane. This is a doc-inherited estimate, not a live balance read.
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
| First-frame scroll-stop (10) | 7 | Blown-fuse macro close-up is a solid but not top-tier hook |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → warning → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline, no literal fire depiction |
| Keyword (5) | 4 | "fuse," "short," "electrical," "wiring" present in captions/copy |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **50/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"A fuse that keeps blowing isn't a fuse
problem — it's a short"}` to re-score, render, and move toward publish.

**Operator note:** 15 open, unreviewed new-topic `reel pack` draft PRs already exist (list in §1),
plus 5 prior status-only PRs — above the 5-PR skip threshold used in earlier backlog notes, and
approaching the 16–17-PR range that triggered status-only runs as recently as yesterday. Worth a
batch review/merge pass before the queue climbs back into that range; not treated as a blocker for
this run since the two immediately preceding runs both produced real packs at this same backlog
level.
