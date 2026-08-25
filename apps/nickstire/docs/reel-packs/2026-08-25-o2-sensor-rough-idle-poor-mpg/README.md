# Reel pack — "A failing O2 sensor is quietly costing you gas mileage"

Produced by a **scheduled task** firing (2026-08-25), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-25 (session clock).
- Capability check this session:
  `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC|META_|INSTAGRAM|FACEBOOK|TTS|CAPCUT'`
  returned **nothing** — no Higgsfield credential, no `ADMIN_API_KEY`, no `DATABASE_URL`, no TTS
  provider key, no Meta/Instagram token. Also checked local binaries: `ffmpeg` — **missing**,
  `gh` — **missing**, `curl`/`node`/`pnpm` — present but unused (no endpoint to call). Result:
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
  - `ls apps/nickstire/docs/reel-packs/` — **92 merged pack directories** (`2026-08-14` through
    `2026-08-23`), topics spanning tires, brakes, cooling, electrical, drivetrain, HVAC, and
    emissions.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr "reel pack" in:title)` and
    `list_pull_requests(state=open)` — **7 open, unreviewed draft PRs** already exist: #1816
    (leaking heater core), #1817 (washer fluid won't spray), #1818 (trunk/hatch gas strut wear),
    #1819 (horn stops working), #1820 (turbo whistle vs boost leak), #1821 (water pump weep hole
    leak), #1823 (white smoke / head gasket). Newest is #1823, created 2026-08-24T03:30Z — roughly
    a full day before this run, so the once-per-hour cadence documented in the prior
    `BACKLOG-STATUS-*` notes has already slowed on its own.
  - Checked this pack's topic (O2/oxygen sensor — rough idle, poor fuel economy, check-engine
    light) against all 99 merged-or-pending topics — **no overlap found.** Nearest neighbors are
    `gas-cap-check-engine-light` (different root cause: loose cap, not a failing sensor),
    `egr-valve-clogged-rough-idle` (different component — carbon-clogged EGR passage, not a
    degraded oxygen sensor — though both can present as rough idle, so the script below
    deliberately names the O2 sensor and the fuel-trim symptom to keep the two distinguishable),
    and `spark-plug-wire-arcing` (different ignition-side cause of rough running).
  - **Backlog note, not escalated to a third status-only PR:** 7 open reel-pack PRs is above the
    skip threshold (5) recommended in the 2026-08-20/21 `BACKLOG-STATUS-*` notes, but well below
    the 12–17 range that prompted those two status-only runs, and the cadence has already slowed
    (last new pack PR was ~24h ago, not ~1h ago). Those notes explicitly said repeating the same
    "no new pack, please batch-review" recommendation a third time "is not useful by itself," and
    the 92 merged directories since then confirm packs have kept landing at a manageable pace.
    Producing a real pack this run — rather than a fourth status note — is consistent with what
    actually happened after that recommendation, not a reversal of it. Flagging the 7-PR queue
    here for the operator; not blocking this run on it.

## 2. Candidate scores and selected concept

Single-concept run (topic backlog is not the binding constraint this run — see §1). Scored against
the skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "Your gas mileage is dropping and you don't know why" is a proven curiosity hook shape in this pack series |
| Distinct symptom cluster | 5/5 | Poor MPG + rough idle + check-engine light from a failing O2 sensor is mechanically specific, not generic "check engine light" |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 99 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll; no dealership-specific footage required |

Selected: **"A failing O2 sensor is quietly costing you gas mileage."** No runner-up concept was
generated — single-topic run, consistent with sibling packs in this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (a degraded
  or "lazy" oxygen sensor sends inaccurate readings to the ECU, which can richen the fuel mixture
  and hurt fuel economy while triggering an O2-circuit or fuel-trim related DTC), not a
  shop-specific sourced fact. `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not
  `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the O2-sensor/fuel-trim claim; whether Nick's
  Tire & Auto specifically stocks/services O2 sensor diagnosis and replacement (near-certain for a
  general repair shop, but not confirmed against a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Your gas mileage is dropping and you don't know why." |
| 0:04–0:09 | SYMPTOM | "Idle feels a little rough. Check engine light comes on, then maybe goes off." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: a failing oxygen sensor. It can send the wrong reading to the engine computer." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "That can richen the fuel mix — burning more gas than you need to." |
| 0:21–0:26 | SAFE ACTION | "Don't guess which part it is. A scan tool can help narrow it down." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before it costs you more at the pump. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Close-up on a fuel gauge needle sitting low, paired with a dashboard MPG/trip
   computer readout ticking down, dim interior lighting, shallow depth of field, static-mounted
   camera (no hand holding a phone).
2. **0:04–0:09** — Low-angle shot of an idling engine bay under the hood, visible micro-vibration
   at idle; cut to a dashboard check-engine light illuminated amber, then fading.
3. **0:09–0:15** — Macro/cutaway shot: an oxygen sensor removed from an exhaust pipe fitting,
   resting on a workbench, visible carbon/soot discoloration on the sensor tip, slow push-in.
4. **0:15–0:21** — Close-up on a fuel-trim readout on an OBD-II scan-tool screen, numbers trending
   rich, screen glow in a dim shop bay, tool mounted/clipped in frame (no hand in shot).
5. **0:21–0:26** — Scan tool connected via cable under the dash, data scrolling on-screen, shop bay
   softly blurred in the background.
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
- Hashtags: `#CarMaintenance #CheckEngineLight #OxygenSensor #GasMileage #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "⛽ Gas mileage dropping and idle feels a little off? One clue mechanics check: a
  failing oxygen sensor. It can throw off your fuel mix and cost you at the pump. Don't guess —
  get it scanned. Stop by and we'll take a look. 🔧"

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
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated ~51/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
| Server re-score at enqueue | **BLOCKED** | No `/api/admin/reel-canary {action:"start"}` call made — no credentials/route |
| Render-integrity gate (#800/#801) | **N/A — not rendered** | No MP4 exists this session |
| Rendered QA / vision critic (`renderedQa.ts`) | **N/A — not rendered** | Same |
| Repair routing / 7-way decision | **N/A** | No job exists to route |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED (by absence of a job)** | Cannot evaluate a gate against a nonexistent render — this is the gate's own `unavailable` state, not a silent pass |
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Substituted directory + open-PR search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 8 | Low-fuel-gauge / dropping-MPG close-up hook |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "check engine light," "gas mileage," "oxygen sensor," "fuel mix" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **51/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"A failing O2 sensor is quietly costing you
gas mileage"}` to re-score, render, and move toward publish.

**Operator note:** 7 open, unreviewed `reel pack` draft PRs already exist (#1816, #1817, #1818,
#1819, #1820, #1821, #1823) — above the previously-recommended skip threshold of 5, though the
firing cadence has already slowed on its own (newest is ~24h old, not ~1h). Worth a batch review
pass before the queue grows further, but not treated as a blocker for this run.
