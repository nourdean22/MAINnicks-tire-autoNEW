# Reel pack — "Heated seats stopped working and it's not always the switch"

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
  provider key, no Meta/Instagram token. Also checked local binaries: `ffmpeg` — **missing**
  (`command -v ffmpeg` returned nothing). `gh` CLI is not available either — GitHub access this
  session goes through the connected GitHub MCP tools. Result: **BLOCKED: NO MOTION ROUTE** this
  session → full pack produced per the skill's explicit fallback, not a downgraded stills-only
  asset. `getHiggsfieldAccountHealth()` was **not called** (no running server, no credentials, no
  network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md:66` (re-read live this session, not
  inherited): prod pins `REEL_VIDEO_PROVIDER=template_stock` (verified 2026-08-11 per that doc's
  own note) — the free local-ffmpeg lane, not Higgsfield/Seedance/Veo. If this pack is fed to the
  real pipeline today, per-clip generation cost is expected to be **$0**.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended run per `prod-db-guard`).
  Substituted the two offline checks the skill itself requires:
  - `ls apps/nickstire/docs/reel-packs/` — **145 merged pack directories** (`2026-08-14` through
    `2026-08-28`), covering tires, brakes, cooling, electrical, drivetrain, HVAC, exhaust, interior
    controls (power windows, mirrors, seats, locks, sunroof, horn) and emissions. HVAC/climate
    topics already merged: `ac-not-blowing-cold`, `heater-not-blowing-hot`, `musty-ac-smell`,
    `ac-recharge-myth-sealed-system`, `ac-blend-door-actuator-hot-cold-split`,
    `ac-compressor-clutch-not-engaging`, `foggy-windshield-recirculate-trick`,
    `rear-defroster-grid-line-test`, `blower-motor-resistor` — none of them is heated seats.
    Interior-electrical "fuse vs. component" style packs already merged: `power-window-stuck-halfway`,
    `power-mirror-wont-move`, `door-lock-actuator-stripped-gear`, `horn-wont-work` — none covers
    seat heaters.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack"
    in:title)` — **8 open reel-pack PRs**: #2104 backup camera goes black mid-reverse, #2106 fall
    car-care checklist, #2044 seatbelt warning light, #2045 power seat won't move (fuse vs. motor),
    #2041 car alarm false-trigger, #2037 clutch pedal sinking, #2046 sticky/heavy gas pedal, plus
    #2076 (backlog-status only, no new pack). #2045 "power seat won't move" is the closest
    neighbor — it diagnoses seat *motor/motion* failure (fuse vs. motor), not seat *heating*
    element failure. Different fault tree, different symptom, kept explicitly distinct in the
    script below (this pack never mentions the seat not moving).
  - Checked this pack's topic (heated seats that stop warming, fuse vs. heating-element vs. switch)
    against all 145 merged + 8 open topics — **no overlap found.**

## 2. Candidate scores and selected concept

Two candidates were scored; one selected, one parked — both against the skill's rubric out of 5
per dimension, self-estimated (no live critic panel — no DB/tournament access this session):

| Candidate | Scroll-stop hook | Distinct symptom cluster | Claim safety | Novelty vs. 145 merged + 8 open | Producibility (faceless) |
|---|---|---|---|---|---|
| **A — Heated seats stopped working (fuse vs. element vs. switch)** | 4/5 | 5/5 — seasonal, distinct fault tree from `power-seat-wont-move` (motion, not heat) | 5/5 | 5/5 — no overlap found | 4/5 — all beats plausible AI-gen/stock, no dealership-specific footage |
| B — Remote start won't work (key fob vs. relay vs. dead battery) — parked | 4/5 | 4/5 — adjacent to `key-fob-dead-battery-no-start` (merged 2026-08-21), which already covers the fob/battery no-start fault tree; remote start narrows to the *push-button-from-outside* variant, close enough to read as a re-skin of an existing topic | 5/5 | 3/5 — meaningful overlap risk with the merged fob/battery pack | 4/5 |

Selected: **"Heated seats stopped working and it's not always the switch."** Candidate B parked —
too close to the merged `key-fob-dead-battery-no-start` pack to clear the novelty bar without a
sharper distinguishing hook than this session could verify offline.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (seat heaters
  are typically a resistive heating pad or wire grid inside the seat cushion/backrest, powered
  through a dedicated fuse and switched by a relay or an integrated switch module with a
  thermostat; a dead heater can result from a blown fuse, a failed switch/module, a broken wire in
  a high-flex point of the seat frame, or a failed heating element itself — each has a different
  fix), not a shop-specific sourced fact. `entailment` status: **`not_evaluated`** — mark
  `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is asserted as current fact — "as it gets colder" is used as a
  general seasonal framing device, not a claim about today's actual Cleveland weather.
- **UNKNOWN, explicitly:** live entailment status of the fuse/switch/element fault-tree claim;
  whether Nick's Tire & Auto's actual electrical-diagnostic process names these same three failure
  points in this order (near-certain for any general shop, but not confirmed against a live
  `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Heated seats stopped working? It's not always the switch." |
| 0:04–0:09 | SYMPTOM | "One side warms, the other stays cold — or neither side does anymore." |
| 0:09–0:16 | EXPLANATION / CUTAWAY | "Three clues to check in order: the fuse, the switch, then the heating element itself." |
| 0:16–0:22 | CONSEQUENCE / PROOF | "A blown fuse can point to a bigger short — one that can keep coming back if it's ignored." |
| 0:22–0:26 | SAFE ACTION | "Don't guess which one it is before you start pulling seats apart." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before winter gets here. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*can point to · worth checking · one clue → three clues (rubric phrasing kept in spirit) · don't
guess · stop by and we'll take a look.* No prices, no guarantees, no invented timelines. "A blown
fuse can point to a bigger short" alludes to a real electrical-fault pattern without naming a
specific outcome or timeline as fact. Ran the approved-pattern-bank check by hand against
`facelessReelStudio.ts`'s deny rules (`no-you-need`, `no-this-means-bad`, `no-definitely-need`) —
no matches in this script.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Interior shot, static-mounted camera low across a front seat cushion, cool
   overcast light through the windshield, subtle breath-fog suggesting cold cabin air.
2. **0:04–0:09** — Split-style cut: close-up on a seat-heater toggle switch icon on a center
   console, glowing amber (unresponsive), then a wide interior shot of two front seats side by
   side under even cabin lighting.
3. **0:09–0:16** — Macro/cutaway shot: a fuse box panel with one visible blown fuse held near the
   panel (tool/part visible, no hand in frame), slow push-in; cut to a seat cushion partially
   removed on a workbench with a wiring harness and thermostat module visible.
4. **0:16–0:22** — Close-up on a scorched or discolored wire connector resting on a shop bench,
   dim shop-bay lighting, static hold, subtle grain to suggest an electrical fault.
5. **0:22–0:26** — Underbody-style inspection shot repurposed for interior: a multimeter probe
   positioned near a seat wiring connector (tool visible, mounted/clipped — no hand in frame), shop
   bay softly blurred behind.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md:81`).

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
- Hashtags: `#CarMaintenance #HeatedSeats #WinterCarCare #CarElectrical #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🔥 Heated seats gone cold? It's not always the switch — fuse, switch, and
  heating element are three separate things that can fail. Don't guess before winter gets here —
  stop by and we'll take a look. 🚗"

Ad-ready variant A (hook/caption/CTA): Hook — "Heated seats stopped warming and you assumed the
switch broke?" Caption — "It could be the fuse, the switch, or the element itself — three
different fixes. Worth checking before the cold really sets in." CTA — "Stop by Nick's Tire &
Auto — we'll take a look."

Ad-ready variant B (hook/caption/CTA): Hook — "One heated seat still works, the other doesn't?"
Caption — "That's a clue, not a guess — could be a blown fuse, a bad switch, or a failed heating
element. Don't start pulling the seat apart without knowing which." CTA — "Nick's Tire & Auto —
worth checking, no pressure."

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts:28-37` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip
  = $0.25` (labeled ASSUMPTION in source), `template_stock_clip = $0`, `veo_second_720p = $0.10`
  (the one Google-published figure).
- Per `REEL-PIPELINE.md:66` (re-read live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` → **estimated generation cost if run today: $0.00** for
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
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated ~50/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
| Server re-score at enqueue | **BLOCKED** | No `/api/admin/reel-canary {action:"start"}` call made — no credentials/route |
| Render-integrity gate (#800/#801) | **N/A — not rendered** | No MP4 exists this session |
| Rendered QA / vision critic (`renderedQa.ts`) | **N/A — not rendered** | Same |
| Repair routing / 7-way decision | **N/A** | No job exists to route |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED (by absence of a job)** | Cannot evaluate a gate against a nonexistent render — this is the gate's own `unavailable` state, not a silent pass |
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Directory scan (145 merged) + open-PR title search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 7 | "Not always the switch" framing is a specific, curiosity-driving reframe of a common assumption |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline; hand-checked against deny patterns |
| Keyword (5) | 4 | "heated seats," "fuse," "switch," "heating element" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **50/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Heated seats stopped working and it's not
always the switch"}` to re-score, render, and move toward publish.
