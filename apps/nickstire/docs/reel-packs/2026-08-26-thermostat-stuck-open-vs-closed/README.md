# Reel pack — "Same tiny part, two opposite problems: engine overheats, or never warms up"

Produced by a **scheduled task** firing (2026-08-26), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-26 (session clock).
- Capability check this session:
  `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC|META_|INSTAGRAM|FACEBOOK|TTS|CAPCUT'`
  returned no credential (only unrelated `NO_PROXY`/`GLOBAL_AGENT_NO_PROXY`/`JAVA_TOOL_OPTIONS`
  lines matched, none of them a Higgsfield/admin/DB/TTS/Meta secret). Also checked local binaries:
  `ffmpeg` — **missing**, `gh` — **missing**. Result: **BLOCKED: NO MOTION ROUTE** this session →
  full pack produced per the skill's explicit fallback, not a downgraded stills-only asset.
  `getHiggsfieldAccountHealth()` was **not called** (no running server, no credentials, no network
  path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Treat this as inherited
  doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check instead:
  - `ls apps/nickstire/docs/reel-packs/` — **~103 merged pack directories** (`2026-08-14` through
    `2026-08-25`), topics spanning tires, brakes, cooling, electrical, drivetrain, HVAC, and
    emissions, plus two prior `BACKLOG-STATUS-*.md` notes.
  - `mcp__github__search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel
    pack" in:title)` → **9 open PRs**: #1835 (exhaust manifold leak, cold-start tick), #1857 (AC
    compressor clutch not engaging), #1865 (rear defroster partial-clear), #1867 (brake light
    switch / cruise / shift-lock), #1873 (4WD/AWD driveline bind), #1874 (backlog-status note,
    "132 open PRs"), #1875 (torque converter shudder), #1876 (transmission delayed engagement).
    Broader `is:pr is:open` (no title filter) → **10 total open PRs** in the repo, so effectively
    all open PRs right now are reel-pack-related.
  - **This is a large drop from the 127–132 open PRs the two most recent PR titles themselves
    report** (#1842, #1874, both created 2026-08-25). Every merged-pack directory in
    `apps/nickstire/docs/reel-packs/` carries a filesystem mtime of **2026-08-26 00:28**, i.e. a
    single batch landed at one timestamp — direct evidence a batch-merge sweep ran between the
    132-PR report and now, not just self-reported cadence slowing. The prior `BACKLOG-STATUS-*`
    notes' repeated ask ("batch-review the open PRs") appears to have been acted on.
  - Checked this pack's topic (thermostat stuck closed vs. stuck open — engine overheats fast, or
    never reaches temperature / heater stays lukewarm / mileage drops) against the ~103 merged
    topics and the 9 open ones — **no overlap found.** Nearest neighbors are
    `engine-overheating-first-60-seconds` (general first-drive overheat causes, not
    thermostat-specific), `radiator-fan-idle-overheat` (fan-circuit root cause, not the
    thermostat), `radiator-cap-pressure-test` (cap seal, not the thermostat), `collapsing-radiator-hose`
    (hose collapse under vacuum, not the thermostat), and `heater-not-blowing-hot` (general heater
    cold — coolant level/blend door framing, not the thermostat as the named root cause). The
    script below deliberately names "thermostat" explicitly and frames the two-opposite-symptoms
    hook, which none of those five packs use, to keep this topic distinguishable from all of them.
  - **Backlog note, not escalated to a fourth status-only PR:** 9 open reel-pack PRs is slightly
    above the skip threshold (5) recommended in the 2026-08-20/21 `BACKLOG-STATUS-*` notes, but
    far below the 12–17 (and later 127–132) range that prompted those escalations, and there is
    now direct filesystem evidence (the single-timestamp batch-merge above) that review capacity
    caught up rather than staying stuck. The 2026-08-25 O2-sensor pack in this same directory
    reached the identical conclusion at 7 open PRs and produced a real pack rather than a status
    note; this run extends that same call at 9. Flagging the queue here for the operator, not
    blocking this run on it, and not repeating a recommendation that was, this time, visibly acted on.

## 2. Candidate scores and selected concept

Single-concept run (topic backlog is not the binding constraint this run — see §1). Scored against
the skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 5/5 | "Same tiny part, two totally opposite problems" is a strong curiosity/pattern-interrupt hook — most drivers assume overheating and "never warms up" are unrelated |
| Distinct symptom cluster | 5/5 | Fast overheat (stuck closed) vs. never-reaches-temp/cold-heater/poor-mileage (stuck open) from one root part is mechanically specific, not generic "check your coolant" |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing ~103 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll; no dealership-specific footage required |

Selected: **"Same tiny part, two opposite problems: engine overheats, or never warms up — the
thermostat."** No runner-up concept was generated — single-topic run, consistent with sibling
packs in this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (a
  thermostat stuck closed blocks coolant flow to the radiator, causing rapid overheating; a
  thermostat stuck open lets coolant circulate to the radiator continuously, so the engine never
  reaches normal operating temperature — which shows as a cold-running heater and can hurt fuel
  economy since the ECU stays in a richer warm-up fuel map longer), not a shop-specific sourced
  fact. `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the thermostat-failure-mode claim; whether
  Nick's Tire & Auto specifically stocks/services thermostat replacement (near-certain for a
  general repair shop, but not confirmed against a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Two totally different problems — same tiny part." |
| 0:04–0:09 | SYMPTOM A | "Temp gauge climbs fast. Engine overheats within minutes of driving." |
| 0:09–0:15 | SYMPTOM B / CUTAWAY | "Or the opposite — heater stays lukewarm, gauge barely moves, gas mileage drops." |
| 0:15–0:21 | EXPLANATION | "One clue: the thermostat. Stuck closed traps the heat. Stuck open lets it escape." |
| 0:21–0:26 | SAFE ACTION | "Don't just top off coolant and hope — the part itself may need replacing." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before it strands you or wastes gas. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess-equivalent ("don't just... and hope") · stop by and
we'll take a look.* No prices, no guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Split-screen composition: left half a dashboard temperature gauge needle pinned
   toward "H," right half the same gauge style needle sitting cold near "C," both dimly lit
   interiors, static-mounted camera (no hand holding a phone).
2. **0:04–0:09** — Close-up on a dashboard temperature gauge needle climbing steadily into the red
   zone; cut to a wisp of steam rising from under a hood in a parking lot, warm daylight.
3. **0:09–0:15** — Close-up on an HVAC vent with visibly cool/lukewarm air movement (subtle fabric
   ribbon flutter, no visible breath fog), then cut to a dashboard trip-computer MPG readout
   ticking down.
4. **0:15–0:21** — Macro cutaway shot: a thermostat housing removed from an engine, the thermostat
   valve visible either fully closed (stuck-shut framing) or fully open (stuck-open framing),
   resting on a clean workbench, slow push-in.
5. **0:21–0:26** — A coolant reservoir being topped off, then a slow pull-back revealing the
   thermostat housing still sitting disassembled on the bench nearby — visual contrast between the
   "quick fix" and the actual part.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 1, 2, 3,
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
- Hashtags: `#CarMaintenance #CheckEngineLight #ThermostatFail #EngineOverheat #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🌡️ Engine running hot — or heater never warms up? Same tiny part can cause both:
  the thermostat. Stuck closed traps heat, stuck open lets it escape. Don't just top off coolant
  and hope. Stop by and we'll take a look. 🔧"

Two ad-ready hook/caption/CTA variants (per the skill's required-response §8):

- **Variant A (overheat-first):** Hook: "Your engine just overheated and you don't know why."
  Caption: "A stuck thermostat can trap coolant flow and send your temp gauge into the red in
  minutes. One tiny part, one big problem." CTA: "Stop by and we'll take a look — Nick's Tire &
  Auto."
- **Variant B (cold-heater-first):** Hook: "Heater never gets warm, even after 20 minutes of
  driving?" Caption: "That can point to the opposite thermostat failure — stuck open, engine never
  reaches temperature, mileage can suffer too." CTA: "Worth checking before winter. Stop by — Nick's
  Tire & Auto."

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
| First-frame scroll-stop (10) | 8 | Split-screen hot/cold gauge hook, pattern-interrupt framing |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom A → symptom B → explanation → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "overheat," "thermostat," "heater," "gas mileage" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **51/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Same tiny part, two opposite problems: engine
overheats, or never warms up"}` to re-score, render, and move toward publish.

**Operator note:** 9 open, unreviewed `reel pack` draft PRs exist (#1835, #1857, #1865, #1867,
#1873, #1874, #1875, #1876, plus this run's new PR) — slightly above the previously-recommended
skip threshold of 5. However, filesystem timestamps in this directory show a batch-merge sweep
landed ~100 packs at a single moment (2026-08-26 00:28), right after the two most recent
backlog-status PRs reported 127–132 open. That is direct evidence the standing "batch-review the
queue" recommendation was acted on this time, not further evidence of a stuck pipeline — so this
run is not repeating that recommendation, only noting the current count for visibility.
