# Reel pack — "A stuck EVAP purge valve throws a check-engine light for a reason you'd never guess"

Produced by a **scheduled task** firing (2026-08-26), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
  The stored prompt's own steps 2–3 ask "check tools, render if all available" — capability check
  below shows no motion route exists this session, so per the skill this falls straight to the pack
  fallback, never to `PUBLISH`.
- Timestamp: 2026-08-26 (session clock).
- Capability check this session:
  `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC|META_|INSTAGRAM|FACEBOOK|TTS|CAPCUT'`
  returned **nothing** — no Higgsfield credential, no `ADMIN_API_KEY`, no `DATABASE_URL`, no TTS
  provider key, no Meta/Instagram token, no ChatGPT/OpenAI key. Local binary check: `ffmpeg` —
  **missing**, `gh` — **missing**, `curl`/`node`/`pnpm` — present but unused (no endpoint to call,
  no server running). Result: **BLOCKED: NO MOTION ROUTE** this session → full pack produced per
  the skill's explicit fallback, not a downgraded stills-only asset. `getHiggsfieldAccountHealth()`
  was **not called** (no running server, no credentials, no network path to it). No CapCut or any
  editing GUI is reachable from this shell — assembly below is written as ffmpeg/CapCut
  instructions for a human or a downstream job, not executed here.
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Inherited doc-truth, not a live
  read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the documented offline check instead:
  - `ls apps/nickstire/docs/reel-packs/` — **99 merged pack directories** (`2026-08-14` through
    `2026-08-25`), topics spanning tires, brakes, cooling, electrical, drivetrain, HVAC, and
    emissions. No `evap`/`purge valve` topic among them.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew, "reel" in:title, is:open)` — **13
    open PRs** (of 16 open PRs repo-wide): #1835, #1842, #1857, #1865, #1867, #1873, #1874, #1875,
    #1876, #1877, #1878, #1879, #1880. None cover an EVAP purge valve — nearest neighbors are
    `egr-valve-clogged-rough-idle` (merged, different component: carbon-clogged EGR gas-recirculation
    passage, not a fuel-vapor purge solenoid) and `gas-cap-check-engine-light` (merged, different
    root cause: a loose/failed cap seal, not a stuck solenoid). No overlap found against 112
    merged-or-pending topics total.
  - **Backlog context, not escalated to a status-only PR:** two prior runs (#1874 "132 open PRs",
    #1842 "127 open PRs", both 2026-08-25) paused new-pack production and filed status-only notes
    at that queue depth. Since then the queue has been brought down to **13 open** — evidence the
    backlog is being actively worked down, not accumulating. Per the same precedent the
    2026-08-25 O2-sensor pack set at 7 open PRs ("flagging, not blocking"), 13 is above the
    previously-recommended skip threshold of 5 but is a small fraction of the depth that actually
    triggered a pause. Producing one pack this run, flagging the queue depth for a batch-review
    pass, is consistent with that precedent rather than a third redundant status note.

## 2. Candidate scores and selected concept

Single-concept run (topic backlog is not the binding constraint this run — see §1). Scored against
the skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "Check engine light comes and goes, smells like fuel near the gas cap" is a concrete sensory hook, not a generic "check engine light" tease |
| Distinct symptom cluster | 5/5 | Intermittent CEL + rough idle/stumble right after fueling + faint fuel smell, tied to a stuck EVAP purge solenoid, is mechanically specific |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 112 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll/cutaway; no dealership-specific footage required |

Selected: **"A stuck EVAP purge valve throws a check-engine light for a reason you'd never guess."**
No runner-up concept was generated — single-topic run, consistent with sibling packs in this
backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (the EVAP
  purge valve/solenoid meters stored fuel-vapor flow from the charcoal canister into the intake;
  stuck closed it can trap vapor and sometimes trigger a canister-pressure DTC, stuck open it can
  pull in extra uncontrolled vapor/air and cause a rough or stumbling idle, particularly right after
  refueling), not a shop-specific sourced fact. `entailment` status: **`not_evaluated`** — mark
  `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the EVAP-purge-valve/rough-idle claim; whether
  Nick's Tire & Auto specifically stocks/services EVAP-system diagnosis and solenoid replacement
  (near-certain for a general repair shop offering emissions-related work, but not confirmed against
  a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Check engine light comes and goes, and you catch a faint fuel smell near the gas cap?" |
| 0:04–0:09 | SYMPTOM | "Idle stumbles a little, especially right after you fill up." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: a stuck EVAP purge valve. It controls fuel vapor flow into the engine." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "Stuck open or closed, it can throw off your idle and trip that light." |
| 0:21–0:26 | SAFE ACTION | "Don't guess which part it is. A smoke test can help find the leak." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before it fails emissions testing. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Close-up on a fuel filler door/gas cap area at a pump, slight haze/heat shimmer
   suggesting a faint vapor smell, static-mounted camera (no hand holding a phone).
2. **0:04–0:09** — Low-angle shot of an idling engine bay, visible slight rpm flutter at idle; cut to
   a dashboard check-engine light illuminated amber, then fading.
3. **0:09–0:15** — Macro/cutaway shot: an EVAP purge solenoid valve on a workbench, hose fittings
   visible, slow push-in revealing an internal diaphragm cutaway diagram overlay-style shot.
4. **0:15–0:21** — Close-up on an OBD-II scan-tool screen showing an idle/RPM trace dipping and
   recovering, screen glow in a dim shop bay, tool mounted/clipped in frame (no hand in shot).
5. **0:21–0:26** — Handheld-style (rig-mounted, not human-held) smoke-test wand emitting visible
   smoke near an intake hose joint in a shop bay, soft background blur.
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

### Assembly instructions (ffmpeg/CapCut)

1. Order clips exactly as beats 1→6 above (after the sub-shot split noted above).
2. Trim each sub-clip to its allotted window; hard-cut or short (≤0.2s) crossfade between beats — no
   `zoompan`/Ken-Burns stills filters (documented cause of the frozen-frame regression in
   `REEL-PIPELINE.md` §"Render-integrity gate").
3. Burn in captions from `captions.srt` (below), bottom-third safe zone, high-contrast style matching
   the account's existing caption preset.
4. Composite the Nick's Tire & Auto logo and CTA text on beat 6 only, in post (not generated).
5. Mix voiceover (TTS, not produced this session — no TTS credential available) as the primary audio
   layer; add a 3s freeze-frame "SAVE" card after 0:30 per the storyboard contract used by the
   render-integrity gate (container duration = beats + 3s freeze ≈ 33s).
6. Export 9:16, 1080×1920, H.264, target ≥30fps throughout (render-integrity gate requires ≥80% of
   expected 30fps frame count).

### Posting specs

- Platform: Instagram Reels (primary), cross-post to Facebook Reels via the same asset.
- Dimensions: 1080×1920 (9:16), MP4, ≤30s target already met.
- Hashtags: `#CheckEngineLight #EVAPSystem #CarMaintenance #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto #EmissionsTest`
- Caption (feed): "🚨 Check engine light flickers and you catch a whiff of fuel near the gas cap?
  One clue mechanics check: a stuck EVAP purge valve. It can throw off your idle and trip that
  light — especially right after fueling up. Don't guess — get it smoke-tested. Stop by and we'll
  take a look. 🔧"

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` → **estimated generation cost if run today: $0.00** for
  ~10–12 sub-clips on the free ffmpeg lane. Doc-inherited estimate, not a live balance read.
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
| First-frame scroll-stop (10) | 7 | Gas-cap/fuel-smell close-up hook is concrete but less visceral than a dashboard-gauge shot |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "check engine light," "EVAP purge valve," "idle," "emissions" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **50/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete and
internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close. No
render was attempted, no generation spend occurred, no DB was read, and no publish call was made. An
operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"A stuck EVAP purge valve throws a check-engine
light for a reason you'd never guess"}` to re-score, render, and move toward publish.

**Operator note:** 13 open, unreviewed `reel pack` draft PRs currently exist (#1835, #1842, #1857,
#1865, #1867, #1873, #1874, #1875, #1876, #1877, #1878, #1879, #1880) out of 16 open PRs repo-wide —
above the previously-recommended skip threshold of 5, but a small fraction of the 127–132 depth that
previously triggered a pause, and the queue is visibly being worked down (down from 132 as of
2026-08-25 to 13 as of this run). Worth a batch review pass before it grows again, but not treated as
a blocker for this run.
