# Reel pack — "Aired up the tire and the low-pressure light is still on?"

Produced by a **scheduled task** firing (2026-09-07), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read. This
session made none of those calls. Deliverable is a full production-ready **pack**, not a claimed
render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE`/`PRODUCTION` per the skill's mode table —
  research/score/pack only, no render, no publish).
- Timestamp: 2026-09-07 (session clock).
- Capability check this session: `which ffmpeg` — missing (`ffmpeg: command not found`); `which
  capcut` — no such tool; `env | grep -iE 'higgsfield|openai|elevenlabs|meta|facebook|instagram|tts'`
  — no matches; `env | grep -iE 'DATABASE_URL|ADMIN_API_KEY|REEL_'` — no matches; only
  `apps/nickstire/.env.example` exists on disk, not a real `.env`. No ChatGPT, TTS, Higgsfield,
  Meta-posting, or CapCut tool exists in this session's toolset either (checked the full tool list —
  an Adobe Express/Firefly connector is present but has no TTS/voice-generation primitive and no
  Higgsfield/Meta bridge). Result: **BLOCKED: NO MOTION ROUTE** this session -> full pack produced
  per the skill's explicit fallback, not a downgraded stills-only asset. `getHiggsfieldAccountHealth()`
  was **not called** (no running server, no credentials, no network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — treated as inherited doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check instead:
  - `git fetch origin main` + `git ls-tree -d origin/main -- apps/nickstire/docs/reel-packs/` —
    **160 merged pack directories** (`2026-08-14` through `2026-09-06`, this pack's own topic
    checked against every one of them).
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack" OR
    "reel-packs" in:title,body)` — **0 open PRs** at the time of this run. The prior 2026-09-05/06
    backlog note (down to 1 open status-only PR) has since been fully cleared per commit
    `866c3b8` ("merged 1 stranded PR, no new pack").
  - Checked this pack's topic (TPMS light staying lit after a refill / drive-cycle reset) against
    all 160 merged topics — no overlap. The two closest existing packs are
    `2026-08-18-tpms-sensor-battery` (sensor battery end-of-life, a hardware-replacement story) and
    `2026-08-18-cold-weather-tire-light` (why the light comes on at all in cold weather) — neither
    covers *why the light stays on after you've already fixed the pressure* or the drive-cycle
    reset behavior, which is this pack's distinct angle.
  - Still unresolved from prior runs (no DB access this session either): whether migration
    `0112_reel_publish_approvals.sql` has been applied to production TiDB. Treating the publish
    door as still shut absent explicit operator confirmation.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this backlog window. Scored against the
skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | Direct annoyance/confusion hook ("light still on after I fixed it") targets a common real frustration, distinct phrasing from existing dashboard-light packs |
| Distinct symptom cluster | 5/5 | No existing pack covers the post-refill drive-cycle reset behavior (see §1) |
| Claim safety | 5/5 | No price, no guarantee, no invented timeline — soft language only |
| Novelty vs. existing 160 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 5/5 | All beats are static macro/dash/scanner shots; no moving-hand or dealership-specific footage required |

Selected: **"Aired up the tire and the low-pressure light is still on? Here's why it doesn't clear
right away."** No runner-up concept was generated — single-topic run.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). The claims below are **general automotive knowledge**, not shop-specific sourced
  facts:
  - "TPMS systems generally re-check pressure after a short drive rather than clearing the light
    instantly" — a widely documented behavior of indirect and direct TPMS systems, hedged as "most
    systems" rather than asserted universally (some vehicles do clear near-instantly; behavior
    varies by make).
  - "A light that won't clear after a real drive can indicate a sensor fault rather than a pressure
    problem" — standard diagnostic knowledge, stated with the approved hedge "may indicate."
  - `entailment` status for both: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Script deliberately contains **zero** shop-specific
  facts: no price for a TPMS scan/reset, no hours, no phone number, no warranty claim — sidesteps
  the documented `FactChannel` gap (no `"reel"`/`"social"` scope exists yet).
- No weather/seasonal/local-event claim in this script at all.
- **UNKNOWN, explicitly:** live entailment status of the two claims above; whether Nick's Tire &
  Auto specifically offers a TPMS diagnostic/reset service (near-certain for a full-service tire
  shop, but not confirmed against a live `business_facts` row this session — the script avoids
  asserting the shop offers or performs a specific reset procedure, only that a lingering light is
  worth a scan); whether `0112_reel_publish_approvals.sql` has been applied to production (see §1).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Aired up the tire and the low-pressure light is still on?" |
| 0:04–0:10 | CONTEXT | "Most systems don't clear the second you fill it — they need a short drive to recheck all four sensors." |
| 0:10–0:17 | VALUE | "Give it a few minutes above around fifteen miles an hour. If it's still lit after that, double-check every tire actually got filled — not just the one that looked low." |
| 0:17–0:23 | CAVEAT | "A light that stays on after a real drive may indicate a sensor issue, not just low pressure." |
| 0:23–0:27 | SAFE ACTION / BRANDED CTA | "Worth checking if it lingers. Stop by and we'll take a look." |

Total runtime: 27s (within the 20–35s creative-quality-floor window). Approved soft language used:
*may indicate · worth checking · stop by and we'll take a look.* No prices, no guarantees, no
invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Macro shot of a tire pressure gauge dial, needle settling, pressed to a valve
   stem against a dark tire sidewall backdrop, static camera, soft studio-style side light.
2. **0:04–0:10** — Interior wide shot of a dashboard instrument cluster with the TPMS icon
   illuminated (the cluster's own physical icon graphic, not a generated text overlay), static
   mounted camera, dim ambient cabin light, engine-idle framing.
3. **0:10–0:17** — Sequence of four macro valve-stem shots in a row (implying "check all four
   corners"), consistent studio lighting, static/locked pans between cuts, no full vehicle or
   wheel-well context needed.
4. **0:17–0:23** — Close-up of a handheld diagnostic scanner plugged into an OBD port beneath a
   dash, screen glow visible but soft-focus (no readable digits/text in frame), static camera, no
   hand or arm holding the device (device appears clipped/mounted in frame).
5. **0:23–0:27** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md`).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Beat 3 (the
four-valve-stem sequence, 7s) should be shot/cut as four visually distinct sub-clips as written above
— confirm the assembler actually cuts between all four rather than holding one static macro for the
full 7s, which would fail the motion-cadence check. Flagging this explicitly rather than presenting
the 5-beat table as render-ready.

### Assembly instructions (ffmpeg/CapCut)

1. Order clips exactly as beats 1→5 above (beat 3 cut into its four sub-shots per the note above).
2. Trim each sub-clip to its allotted window; hard-cut or short (≤0.2s) crossfade between beats — no
   `zoompan`/Ken-Burns stills filters (documented cause of the frozen-frame regression in
   `REEL-PIPELINE.md` "Render-integrity gate" section).
3. Burn in captions from `captions.srt` (below), bottom-third safe zone, high-contrast style
   matching the account's existing caption preset.
4. Composite the Nick's Tire & Auto logo and CTA text on beat 5 only, in post (not generated).
5. Mix voiceover (TTS, not produced this session — no TTS credential available) as the primary audio
   layer; add a 3s freeze-frame "SAVE" card after 0:27 per the storyboard contract used by the
   render-integrity gate (container duration = beats + 3s freeze ≈ 30s).
6. Export 9:16, 1080×1920, H.264, target ≥30fps throughout (render-integrity gate requires ≥80% of
   expected 30fps frame count).

### Posting specs

- Platform: Instagram Reels (primary), cross-post to Facebook Reels via the same asset.
- Dimensions: 1080×1920 (9:16), MP4, ≤30s target already met.
- Hashtags: `#TirePressure #TPMS #DashboardLights #CarMaintenance #TireCare #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🛞 Filled the tire but the light's still on? Most systems need a short drive
  above ~15 mph to recheck all four sensors before the light clears. Still lit after that? Worth a
  look — stop by and we'll check it out."

### Two ad-ready hook/caption/CTA variants

**Variant A — "why won't it clear" angle**
- Hook: "Why is my tire light still on after I aired it up?"
- Caption: "It's not broken — most systems need a short drive to recheck all four sensors before the
  light clears. Still on after that? Worth checking."
- CTA: "Stop by and we'll take a look."

**Variant B — "check all four" angle**
- Hook: "Fixed one tire and the light's still on? Check the other three."
- Caption: "The light covers all four corners, not just the one that looked low. If it's still lit
  after a real drive, it may be a sensor, not the pressure."
- CTA: "Worth checking. Stop by and we'll take a look."

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` -> **estimated generation cost if run today: $0.00** for
  ~8 sub-clips on the free ffmpeg lane. This is a doc-inherited estimate, not a live balance read.
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
| Publish-approvals migration (`0112_reel_publish_approvals.sql`) | **UNKNOWN** | Flagged unresolved by prior runs; no DB access this session either to check |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 6 | Gauge-needle macro hook is clean but quieter than a warning light or failure event |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook -> context -> value -> caveat -> safe action/CTA, all present |
| Length (5) | 5 | 27s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "TPMS," "tire pressure," "sensor" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **49/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete and
internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close. No
render was attempted, no generation spend occurred, no DB was read, and no publish call was made. An
operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Aired up the tire and the low-pressure light is
still on? Here's why it doesn't clear right away."}` to re-score, render, and move toward publish —
contingent on `0112_reel_publish_approvals.sql` (§1, §7) actually being applied, which remains
unconfirmed.

**Operator note:** the backlog previously flagged by prior sessions (11 open "reel pack" PRs as of
2026-09-05) is now fully cleared — 0 open PRs at the time of this run (commit `866c3b8` merged the
last stranded one). No escalation needed this run.
