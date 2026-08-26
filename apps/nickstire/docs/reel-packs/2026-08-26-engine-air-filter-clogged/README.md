# Reel pack — "A dirty engine air filter is choking your power and your gas mileage"

Produced by a **scheduled task** firing (2026-08-26), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-26 (session clock).
- Capability check this session: `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC|META_|INSTAGRAM|FACEBOOK|TTS|CAPCUT'`
  returned no Higgsfield credential, no `ADMIN_API_KEY`, no `DATABASE_URL`, no TTS provider key, no
  Meta/Instagram token (only unrelated proxy/build env vars). `which ffmpeg` — **missing**. `curl`,
  `node`, `pnpm` present but unused (no endpoint to call, no server running). Result: **BLOCKED: NO
  MOTION ROUTE** this session → full pack produced per the skill's explicit fallback, not a
  downgraded stills-only asset. `getHiggsfieldAccountHealth()` was **not called** — no credentials,
  no network path to it.
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — if this pack is fed to the real pipeline today, expected per-clip
  generation cost is **$0**, not the `$0.25` Seedance estimate. Inherited doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended run per `prod-db-guard`).
  Substituted the documented offline check:
  - `ls apps/nickstire/docs/reel-packs/` — **~110 merged pack directories** (`2026-08-14` through
    `2026-08-25`), spanning tires, brakes, cooling, electrical, drivetrain, HVAC, fuel/emissions,
    exhaust, and glass/body topics.
  - `list_pull_requests(state=open)` on `nourdean22/mainnicks-tire-autonew` — **12 open, unreviewed
    draft PRs** exist right now: #1835 (exhaust manifold leak), #1857 (AC compressor clutch),
    #1865 (rear defroster), #1867 (brake light switch/cruise/shift-lock), #1873 (4WD/AWD driveline
    bind), #1874 (backlog-status-only, no pack), #1875 (torque converter shudder), #1876
    (transmission delayed engagement), #1877 (thermostat stuck), #1878 (exhaust hanger rattle),
    #1879 (check engine light flashing vs. steady), #1880 (throttle hesitation/dirty MAF), #1884
    (EVAP purge valve), #1885 (backlog-status-only, no pack, created 06:47 today). **Zero of the 12
    content PRs have been merged or closed since #1885 was filed** — same "no review throughput"
    pattern #1885 itself flagged.
  - Checked this pack's topic (clogged **engine** air filter — power loss, poor MPG, rough idle at
    the intake, black smoke on hard acceleration) against all ~122 merged-or-pending topics — **no
    overlap found.** Nearest neighbor is `cabin-air-filter` (2026-08-17), which is a different
    component (HVAC intake, not engine intake) with a different symptom cluster (odor/allergens/weak
    airflow through vents, not engine power or fuel economy) — the script below names "engine air
    filter" explicitly to keep the two distinguishable in a viewer's mind.
- **Backlog judgment call, made explicit rather than defaulted:** #1885 (this morning, same day)
  already filed a third consecutive "no new pack, batch-review the queue" status note and
  recommended *raising* the skip threshold, since (a) the pool of clearly-novel automotive-symptom
  topics is visibly narrowing after ~110 packs, and (b) a fourth repetition of the identical
  recommendation carries no new information for the operator — the precedent set by the
  2026-08-25 O2-sensor pack (`2026-08-25-o2-sensor-rough-idle-poor-mpg/README.md` §1) reasoned the
  same way at a lower PR count and chose to ship a real pack rather than a third status note. This
  run follows that precedent: a genuinely novel topic exists, so it produces a real pack rather than
  a fourth identical skip note. **Flagging, not fixing:** 12 open unreviewed content PRs is a real
  operator backlog — see the final-status note below.

## 2. Candidate scores and selected concept

Single-concept run (topic-pool exhaustion, not multi-candidate ideation, is the binding constraint
at this stage — see #1885). Scored against the skill's rubric out of 5 per dimension, self-estimated
(no live critic panel — no DB/tournament access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "Your car feels sluggish and you're filling up more than you used to" is a proven curiosity-hook shape in this pack series |
| Distinct symptom cluster | 5/5 | Power loss + poor MPG + rough idle from a clogged *engine* intake filter is mechanically specific, distinct from the cabin-filter (HVAC/odor) topic already produced |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing ~122 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 5/5 | Every beat is a plausible AI-gen or stock B-roll shot; no dealership-specific footage required |

Selected: **"A dirty engine air filter is choking your power and your gas mileage."** No runner-up
concept generated — single-topic run, consistent with sibling packs in this series.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (a clogged
  air filter restricts airflow into the engine, which can richen the fuel mixture, reduce power
  under acceleration, and lower fuel economy — one of the most commonly cited DIY-checkable causes
  in general auto-repair literature), not a shop-specific sourced fact. `entailment` status:
  **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the airflow/fuel-mix claim; whether Nick's Tire
  & Auto specifically stocks/replaces engine air filters (near-certain for a general repair shop,
  but not confirmed against a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Your car feels sluggish, and you're filling up more than you used to." |
| 0:04–0:09 | SYMPTOM | "Acceleration feels weak. Idle's a little rough. Maybe a whiff of gas smell at startup." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: a clogged engine air filter. It can choke off the air your engine needs to breathe." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "Less air means a richer fuel mix — less power, worse mileage." |
| 0:21–0:26 | SAFE ACTION | "It's a 30-second check. Pull the filter, hold it to the light — if you can't see through it, it's time." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before it costs you more at the pump. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess (implied by "it's a 30-second check," no diagnosis
claimed) · stop by and we'll take a look.* No prices, no guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Close-up on a dashboard tachometer/MPG trip-computer readout, static-mounted
   camera, dim interior lighting, shallow depth of field, engine bay visible faintly through a
   windshield reflection.
2. **0:04–0:09** — Low-angle shot of an idling engine bay, subtle vibration at idle; quick cut to a
   dashboard fuel-gauge needle sitting lower than expected.
3. **0:09–0:15** — Macro/cutaway shot: an engine air filter housing opened, the pleated paper
   filter element lifted out, visibly dark and clogged with dust/debris, workbench setting, slow
   push-in.
4. **0:15–0:21** — Side-by-side static composition: a clean white pleated filter next to the dirty
   one from beat 3, studio-lit, no hands in frame (filters resting on a stand/mount).
5. **0:21–0:26** — The dirty filter held up backlit by a work-light on a stand, light visibly
   failing to pass through the clogged section — the visual "hold it to the light" test — shop bay
   softly blurred behind it.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 2, 3, and
5 into two sub-shots each (quick punch-in or angle change) to reach ~10–12 sub-clips at ~2.5–3s
apiece before this pack is fed to real generation. Flagging this explicitly rather than presenting
the 6-beat table as render-ready.

### Captions

See `captions.srt` in this directory — one cue per narration beat, burned in bottom-third safe zone.

### Assembly instructions (ffmpeg/CapCut)

1. Order clips exactly as beats 1→6 above (after the sub-shot split noted above).
2. Trim each sub-clip to its allotted window; hard-cut or short (≤0.2s) crossfade between beats —
   no `zoompan`/Ken-Burns stills filters (documented cause of the frozen-frame regression in
   `REEL-PIPELINE.md` §"Render-integrity gate").
3. Burn in captions from `captions.srt`, bottom-third safe zone, high-contrast style matching the
   account's existing caption preset.
4. Composite the Nick's Tire & Auto logo and CTA text on beat 6 only, in post (not generated).
5. Mix voiceover (TTS, not produced this session — no TTS credential available) as the primary
   audio layer; add a 3s freeze-frame "SAVE" card after 0:30 per the storyboard contract used by
   the render-integrity gate (container duration = beats + 3s freeze ≈ 33s).
6. Export 9:16, 1080×1920, H.264, target ≥30fps throughout (render-integrity gate requires ≥80% of
   expected 30fps frame count).

### Posting specs

- Platform: Instagram Reels (primary), cross-post to Facebook Reels via the same asset.
- Dimensions: 1080×1920 (9:16), MP4, ≤30s target already met.
- Hashtags: `#CarMaintenance #EngineAirFilter #GasMileage #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto #CarCare`
- Caption (feed): "🚗 Car feel sluggish and gas mileage dropping? One clue mechanics check: a
  clogged engine air filter. It can choke off airflow, richen your fuel mix, and cost you power and
  MPG. 30-second check: pull it, hold it to the light. Stop by and we'll take a look. 🔧"

### Two ad-ready hook/caption/CTA variants

1. **Curiosity-first:** Hook — "Why does my car feel slower than it used to?" · Caption — "It might
   not be your engine — it might be what your engine's breathing through." · CTA — "Stop by, we'll
   check it in 30 seconds."
2. **Cost-first:** Hook — "You could be paying more at the pump for no reason." · Caption — "A
   clogged air filter chokes airflow and richens your fuel mix — worse mileage, less power." · CTA —
   "Worth a quick check before your next fill-up. Nick's Tire & Auto."

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` → **estimated generation cost if run today: $0.00** for
  ~10–12 sub-clips on the free ffmpeg lane. Doc-inherited estimate, not a live balance read.
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
| First-frame scroll-stop (10) | 8 | Sluggish-acceleration / low-MPG dashboard hook |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "air filter," "gas mileage," "engine power," "fuel mix" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **51/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete and
internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"A dirty engine air filter is choking your
power and your gas mileage"}` to re-score, render, and move toward publish.

**Operator note — backlog, stated plainly:** 12 open, unreviewed `reel pack` draft PRs exist right
now (#1835, #1857, #1865, #1867, #1873, #1875, #1876, #1877, #1878, #1879, #1880, #1884), plus two
status-only PRs (#1874, #1885) recommending a batch-review pass. Zero have been merged or closed
since #1885 was filed this morning. This run produced a real pack rather than a fourth status-only
note, per the precedent in §1 — but the underlying problem (no human review throughput on this
series) is unchanged and worth a batch pass: merge, close-as-duplicate, or reject the 12 content
PRs before the queue grows further. This task's firing cadence can only be changed at the
account/trigger level — no in-session tool reaches that trigger.
