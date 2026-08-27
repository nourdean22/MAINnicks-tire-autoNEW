# Reel pack — "Your car dies at stoplights — and it's not the battery"

Produced by a **scheduled task** firing (2026-08-27), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-27 (session clock).
- Capability check this session:
  `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC|META_|INSTAGRAM|FACEBOOK|TTS|CAPCUT'`
  returned **nothing** — no Higgsfield credential, no `ADMIN_API_KEY`, no `DATABASE_URL`, no TTS
  provider key, no Meta/Instagram token. Also checked local binaries: `which ffmpeg ffprobe hf` —
  **all missing**. Only `apps/nickstire/.env.example` exists (placeholder values, not a real
  `.env`). Result: **BLOCKED: NO MOTION ROUTE** this session → full pack produced per the skill's
  explicit fallback, not a downgraded stills-only asset. `getHiggsfieldAccountHealth()` was **not
  called** (no running server, no credentials, no network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Treat this as inherited
  doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check instead:
  - `ls apps/nickstire/docs/reel-packs/` — **99 merged pack directories** (`2026-08-14` through
    `2026-08-25`), plus 2 `BACKLOG-STATUS-*.md` notes, spanning tires, brakes, cooling, electrical,
    drivetrain, HVAC, and emissions topics.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr "reel pack" in:title,
    state:open)` — **18 open PRs**, of which **13 are unreviewed content packs** and **5 are prior
    `BACKLOG-STATUS-*` notes** (#1842, #1874, #1885, #1908, #1909 — the fifth landed 2026-08-26T20:30Z,
    reporting the *fifth consecutive* scheduled firing to hit this same finding). Per #1909's own
    text, the last batch-merge of any reel-pack PR was 2026-08-25T14:44Z — **now over 30 hours with
    zero merges**, and the queue has stopped growing but nothing has been reviewed either.
  - **Judgment call, made explicit rather than silently repeated:** a sixth consecutive
    status-only PR saying "no new pack, please batch-review" adds no information #1909 didn't
    already state — #1909 itself flagged that repeating the recommendation a third time "is not
    useful by itself," and this would be the sixth. Producing yet another *content* pack instead
    doesn't fix the review backlog either, but it does deliver what this session's task actually
    asked for (a complete, non-duplicate production-ready pack) without pretending the backlog
    problem doesn't exist. This pack therefore does both: real content below, and the backlog
    state stated once, plainly, in this section and in §9 — not filed as a separate PR.
  - Checked this pack's topic (idle air control valve — rough/unstable idle, stalling at stops)
    against all 117 merged-or-pending topics — **no overlap found.** Nearest neighbors, and how
    this one differs: `egr-valve-clogged-rough-idle` (different component — a clogged EGR exhaust
    passage, not an airflow-control valve), `o2-sensor-rough-idle-poor-mpg` (different symptom
    chain — MPG/fuel-trim, not stalling), `idle-shake-spark-plug-motor-mount` (idle *vibration*
    felt through the cabin, not RPM hunting or stalling), `misfire-shudder-coil-vs-plug` (shudder
    under load/acceleration, not at idle), and the open-PR `throttle-hesitation-dirty-MAF`
    (hesitation during acceleration, not idle instability at a stop). The script below names the
    idle air control valve and the "RPM bounces, then stalls at a stop" symptom specifically to
    keep this distinguishable from all five.

## 2. Candidate scores and selected concept

Single-concept run (topic backlog is not the binding constraint this run — see §1). Scored against
the skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "Your car dies at stoplights — and it's not the battery" contradicts the viewer's default assumption, a proven hook shape in this pack series |
| Distinct symptom cluster | 5/5 | RPM hunting + stalling specifically at idle/stops, not under load, not on acceleration |
| Claim safety | 5/5 | No price, no guarantee, no invented timeline — soft language only |
| Novelty vs. existing 117 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll; no dealership-specific footage required |

Selected: **"Your car dies at stoplights — and it's not the battery."** No runner-up concept was
generated — single-topic run, consistent with sibling packs in this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (a
  carbon-fouled idle air control valve, or a carbon-fouled throttle body on a drive-by-wire car,
  can't meter idle airflow accurately, producing an unstable or "hunting" idle and occasional
  stalling at a stop — especially with accessory loads like A/C running), not a shop-specific
  sourced fact. `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the IAC-valve/idle-instability claim; whether
  Nick's Tire & Auto specifically stocks/services idle-air-control diagnosis and cleaning/replacement
  (near-certain for a general repair shop, but not confirmed against a live `business_facts` row
  this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Your car dies at stoplights — and it's not the battery." |
| 0:04–0:09 | SYMPTOM | "Idle feels rough, or the RPM bounces up and down while you're stopped." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: a dirty idle air control valve. It manages airflow when your foot's off the gas." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "When it gets clogged with carbon, idle gets unstable — sometimes enough to stall." |
| 0:21–0:26 | SAFE ACTION | "Don't just replace the battery and hope. Get the idle system checked." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before it strands you at a light. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't just · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Static wide shot of a car stopped at a red light at dusk, brake lights glowing,
   engine bay implied but not open; subtle idle vibration visible in the frame, static-mounted
   camera (no hand holding a phone).
2. **0:04–0:09** — Close-up on a tachometer needle oscillating/hunting between roughly 500–1500
   RPM; cut to a low-angle idling-engine-bay shot with visible micro-vibration.
3. **0:09–0:15** — Macro/cutaway shot: an idle air control valve (small solenoid-style part)
   removed from a throttle body, resting on a workbench, visible carbon/soot buildup on the
   plunger tip, slow push-in.
4. **0:15–0:21** — Close-up on a throttle body bore with visible carbon deposits ringing the
   opening, shop-light glare, static hold; cut to the tachometer needle dropping toward stall.
5. **0:21–0:26** — Scan tool connected via cable under the dash, idle-RPM data scrolling on-screen,
   shop bay softly blurred in the background (no hand in shot).
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 2, 3, and
4 into two sub-shots each (quick punch-in or angle change) to reach ~10–12 sub-clips at ~2.5–3s
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
- Hashtags: `#CarMaintenance #StalledCar #IdleControlValve #CheckEngineLight #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🚦 Car idle feeling rough, or dying at stoplights? It might not be the battery —
  one clue mechanics check is a carbon-clogged idle air control valve. Don't just guess and swap
  parts. Stop by and we'll take a look. 🔧"

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
| First-frame scroll-stop (10) | 8 | "Dies at a stoplight, not the battery" contradicts the viewer's default assumption |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "idle," "stall," "idle air control valve," "check" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **51/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Your car dies at stoplights — and it's not
the battery"}` to re-score, render, and move toward publish.

**Operator note — backlog, stated once:** 18 open `reel pack` PRs exist right now — 13 unreviewed
content packs plus 5 prior `BACKLOG-STATUS-*` notes (#1842, #1874, #1885, #1908, #1909). Zero have
been merged in over 30 hours as of this run. Five consecutive scheduled firings before this one
already reported this same finding; a sixth identical status-only note was judged to add nothing
#1909 didn't already say (see §1), so this run instead delivers one more genuinely non-duplicate
pack and states the backlog plainly here, once. The two actionable recommendations from #1909
still stand and are not repeated as a new PR: (1) batch-review the pending content-pack PRs —
merge, close as duplicate, or reject; (2) the firing cadence itself can only be changed at the
account/trigger level, not from inside a firing.
