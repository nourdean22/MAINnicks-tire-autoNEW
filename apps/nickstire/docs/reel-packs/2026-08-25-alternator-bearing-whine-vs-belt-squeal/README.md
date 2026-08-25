# Reel pack — "Alternator bearing whine vs. belt squeal: same pitch, different fix"

Produced by a **scheduled task** firing (2026-08-25), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-25 (session clock).
- Capability check this session: `env | grep -Ei 'REEL|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ELEVEN|TTS'`
  returned **nothing** — no `HIGGSFIELD_CREDENTIALS_JSON`, no `ADMIN_API_KEY`, no `DATABASE_URL`,
  no TTS provider key. Only `apps/nickstire/.env.example` (the template, not live config) is
  present in this checkout. `getHiggsfieldAccountHealth()` was **not called** (no path to reach
  it — no running server, no credentials). Result: **BLOCKED: NO MOTION ROUTE** this session →
  full pack produced per the skill's explicit fallback, not a downgraded stills-only asset.
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Treat this as inherited
  doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check instead:
  - `ls apps/nickstire/docs/reel-packs/` — **89 merged pack directories**, topics spanning tires,
    brakes, cooling, electrical, drivetrain, HVAC, emissions.
  - `search_pull_requests(is:open "reel pack" in:title)` — **11 open, unreviewed draft PRs**
    already exist: #1816–#1828 (water pump weep hole, turbo whistle vs boost leak, horn
    fuse/relay/clockspring, collapsing lower radiator hose, AC blend door actuator, car shudders
    under acceleration, failing O2 sensor, sweet-smell heater core leak, milky oil cap/head
    gasket, trunk strut wear, washer-fluid nozzle order). Oldest (#1816) is ~39h old, zero review
    activity.
  - Checked this pack's topic (alternator bearing whine misread as belt squeal) against all
    100 merged-or-pending topics via `grep -rli "alternator"` across every pack README, then
    hand-checked the three nearest neighbors (`serpentine-belt-squeal`, `fuel-pump-whine`,
    `wont-start-battery-starter-alternator`) for a whine/bearing overlap — none exists; alternator
    only appears there as a passing mention or unrelated no-start context, never as the selected
    or parked concept. **A prior candidate table check mattered here**: "thermostat stuck open"
    was my first draft topic and was rejected after grep showed it was already shipped as the
    core beat of `2026-08-20-heater-not-blowing-hot` and separately **parked twice** (2026-08-21
    `blower-motor-resistor`, 2026-08-21 `radiator-cap-pressure-test`) — grep-for-directory-name
    alone would have missed both, since neither pack's directory name says "thermostat."
  - **Flag for the operator, escalating, not silently absorbed:** the open-PR backlog has grown
    from **4 (2026-08-23) to 11 (2026-08-25)** — nearly tripled in two days, while the merge rate
    stayed at zero over that window. This is the same failure mode the skill file documents from
    2026-08-14/15 (eight packs, eight directories) recurring in a new, worse shape: every run now
    correctly uses the shared directory convention and the shared PR-search dedup check, so no
    topic has actually collided — but the *review* step that would turn a pack into a usable
    asset isn't happening at all. At the current cadence (~1 pack every 1–3h) the queue will keep
    growing indefinitely. **Recommend: pause new scheduled runs, or route them to a lower
    frequency, until a batch review/merge pass clears the 11 open PRs** — producing pack #101
    while #90 sits unreviewed for two days is motion, not progress.

## 2. Candidate scores and selected concept

Single-concept run (topic backlog is not the constraint this run — see §1). Scored against the
skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | Underhood whine on rev is a proven audio-hook shape already validated by the merged `power-steering-whine` and `fuel-pump-whine` packs |
| Distinct symptom cluster | 5/5 | "Sounds exactly like belt slip but isn't" is a specific misdiagnosis-correction angle, mechanically distinct from both existing whine packs (PS pump fluid, fuel pump electric hum) |
| Claim safety | 5/5 | No price, no guarantee, no invented timeline — soft language only |
| Novelty vs. existing 100 topics | 5/5 | No overlap found after both directory-name and full-text grep (see §1) |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll; the stethoscope-test beat needs a close-up prop shot, no face/hand required if framed as tool-on-engine |

Selected: **"Alternator bearing whine vs. belt squeal: same pitch, different fix."** No runner-up
concept was generated — single-topic run, consistent with sibling packs in this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (a worn
  alternator bearing can produce a whine at a pitch easily confused with belt slip; a seized
  alternator can damage or throw the serpentine belt it drives), not a shop-specific sourced
  fact. `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts:
  no price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the bearing-whine/belt-slip pitch-similarity
  claim and the seized-alternator/belt-damage consequence claim; whether Nick's Tire & Auto
  specifically stocks/services alternator diagnosis (near-certain for a general repair shop, but
  not confirmed against a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Whining noise from under the hood when you rev the engine?" |
| 0:04–0:09 | SYMPTOM | "Sounds like the belt. It might not be." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: a worn alternator bearing can whine at the exact same pitch as belt slip." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "Keep driving on it and the alternator can seize — and take the belt with it." |
| 0:21–0:26 | SAFE ACTION | "Don't guess which part is whining. A quick listening test narrows it down." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before a seized pulley strands you. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · don't guess · worth checking · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Under-hood shot, engine at idle transitioning to a rev, serpentine belt and
   alternator pulley visible spinning, shallow depth of field, static-mounted camera (no hand
   holding a phone).
2. **0:04–0:09** — Close push-in on the serpentine belt path across pulleys, subtle motion blur at
   pulley edges, dim engine-bay lighting.
3. **0:09–0:15** — Macro/cutaway shot: an alternator removed and resting on a workbench, rear
   bearing housing visible, slow push-in on the bearing seat; no hand touching the part.
4. **0:15–0:21** — Wide shot of a serpentine belt with visible frayed/glazed edge damage,
   shop-bay lighting, static hold.
5. **0:21–0:26** — Mechanic's stethoscope tool tip resting against an alternator housing (tool
   only in frame, no hand/arm), subtle vibration on the tool body suggesting the listening test.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six
~5s beats as scripted above are too coarse on their own — recommend the assembler split beats
1, 3, and 4 into two sub-shots each (quick punch-in or angle change) to reach ~10–12 sub-clips
at ~2.5–3s apiece before this pack is fed to real generation. Flagging this explicitly rather than
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
- Hashtags: `#CarMaintenance #AlternatorProblems #CarNoises #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🔧 Whining under the hood when you rev it? Might not be the belt. A worn
  alternator bearing can whine at the exact same pitch — and if it seizes, it can take the belt
  with it. Don't guess which part it is. Worth checking before it strands you. Stop by and we'll
  take a look. 🛠️"

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
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Substituted directory + full-text grep + open-PR search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 7 | Underhood whine hook, one tier below a visible dashboard-warning hook |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "alternator," "whine," "belt," "bearing" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **50/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"alternator bearing whine vs. belt squeal:
same pitch, different fix"}` to re-score, render, and move toward publish.

**Operator note, escalated from the prior run's flag:** the open, unreviewed `reel pack` draft-PR
backlog has grown from 4 (2026-08-23) to **11** (2026-08-25) with zero merges in between. Recommend
pausing or slowing this scheduled task until a batch review/merge pass clears the queue — see §1.
