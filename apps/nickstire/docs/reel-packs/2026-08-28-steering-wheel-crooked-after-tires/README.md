# Reel pack — "Steering wheel crooked after new tires? That's an alignment clue, not a bad tire."

Produced by a **scheduled task** firing (2026-08-28), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

**Operator note — read this before the pack.** The reel-pack PR queue is **not** clean this run.
16 open draft PRs were found (`#1927` through `#1963`, created roughly one per hour over the prior
~24h), against **118 already-merged pack directories** (`2026-08-14` through `2026-08-27`) covering
tires, brakes, cooling, electrical, drivetrain, HVAC, suspension, and emissions. At the documented
publish cap of 2 feed posts/day, that is **75+ days of banked, unreviewed content** already sitting
in this repo, still growing hourly. A prior run in this same series records that an operator once
batch-merged 23 open reel-pack PRs to zero (see `2026-08-27-u-joint-clunk-drive-reverse-shift/README.md`
§9) — since then the queue has re-grown to 16 without another clearing. This pack completes the
assigned task, but the scheduling cadence itself is now the bottleneck, not topic supply: continuing
to fire this task roughly hourly with no review/merge step produces diminishing-to-negative value
(topic exhaustion risk rises, PR review debt compounds, CI minutes are spent per PR). Recommend the
operator either slow the schedule interval or set up a review/merge cadence before the topic well
runs dry and near-duplicate topics start appearing.

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-28 (session clock).
- Capability check this session:
  `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC|META_|INSTAGRAM|FACEBOOK|TTS|CAPCUT'`
  returned **nothing** relevant — no Higgsfield credential, no `ADMIN_API_KEY`, no `DATABASE_URL`,
  no TTS provider key, no Meta/Instagram token. Also checked local binaries: `ffmpeg` — **missing**,
  `gh` — **missing** (GitHub access this session goes through the connected GitHub MCP tools
  instead). Result: **BLOCKED: NO MOTION ROUTE** this session -> full pack produced per the skill's
  explicit fallback, not a downgraded stills-only asset. `getHiggsfieldAccountHealth()` was **not
  called** (no running server, no credentials, no network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Treat this as inherited
  doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended run per `prod-db-guard`).
  Substituted the best available offline check instead:
  - `git ls-tree -d origin/main -- apps/nickstire/docs/reel-packs/` — **118 merged pack
    directories** (`2026-08-14` through `2026-08-27`).
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack" in:title)`
    — **16 open draft PRs** (`#1927`, `#1932`, `#1941`, `#1942`, `#1945`, `#1948`, `#1952`–`#1957`,
    `#1959`, `#1960`, `#1962`, `#1963`), none of them this topic. Flagged above as an operator note,
    not silently absorbed.
  - A second targeted search — `steering OR alignment OR crooked OR "off-center" in:title` — matched
    5 PRs total: `#1927` (open, "steering wheel vibration at highway speed" — a highway-speed
    **vibration**, not an at-rest **off-center** wheel), `#1708` (closed, "steering wheel shakes when
    you brake" — brake-induced shake from warped rotors), `#1675` (closed, power-steering-whine
    repack — a pump noise, not alignment), `#1616` (closed, "balance vs. alignment" — explains the
    *difference* between the two services generically, never the specific off-center-after-tires
    symptom), and `#197` (unrelated feature PR, string match on "steering" in a co-pilot feature
    name). None overlap this pack's topic.
  - Checked this pack's topic (steering wheel sitting off-center/crooked at rest specifically *after*
    a tire installation) against all 118 merged directories by name — **no overlap found.** Nearest
    neighbors: `balance-vs-alignment` (general service-difference explainer, not this specific
    symptom), `power-steering-whine` (a pump noise), `tie-rod-steering-wobble-test` (a wobble
    diagnostic procedure while driving), `why-car-pulls` (drift *while driving*, not wheel position
    *at rest*). The script below names the "crooked after new tires" trigger explicitly to stay
    distinguishable from all four.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this series. Scored against the skill's
rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament access this
session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 5/5 | "New tires but your steering wheel sits crooked?" — a very common, slightly alarming post-service question; strong curiosity/relevance for anyone who just got tires |
| Distinct symptom cluster | 5/5 | An at-rest, off-center steering wheel noticed specifically after tire work — mechanically distinct from vibration, whine, wobble, or drift-while-driving topics already covered |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 118 + 16 topics | 5/5 | No overlap found (see §1); live PR-title search also came back clean |
| Producibility (faceless, no live footage needed) | 5/5 | All beats are plausible AI-gen or stock B-roll (steering wheel, alignment rack, tire shop bay); no dealership-specific footage required |

Selected: **"Steering wheel crooked after new tires? That's an alignment clue, not a bad tire."**
No runner-up concept was generated — single-topic run, consistent with sibling packs in this series.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (tire removal
  and reinstallation does not by itself change alignment geometry, but the front end's toe/camber
  settings can already be off before the visit — new tires simply remove tread-wear masking that was
  hiding a pull or an off-center wheel, and a shop performing a proper installation checks/corrects
  centering on the steering wheel as part of an alignment, not a tire swap alone), not a
  shop-specific sourced fact. `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not
  `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the "new-tires-reveal-alignment-issue" claim;
  whether Nick's Tire & Auto includes a steering-wheel-centering check as a standard part of its
  tire-installation service (near-certain for a shop performing alignments, but not confirmed
  against a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "New tires but your steering wheel sits crooked?" |
| 0:04–0:09 | SYMPTOM | "That's not a bad tire — it's the wheel that's off, not the tread." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: the alignment was already off — new tread just made it easier to notice." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "Left off-center, that pull can wear brand-new tread unevenly." |
| 0:21–0:26 | SAFE ACTION | "Don't guess. An alignment check can find what's actually off." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before new tread wears down crooked. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Interior dash-cam-style shot of a steering wheel sitting visibly off-center while
   the vehicle drives straight down a quiet road, static-mounted camera, daylight, slight zoom-in on
   the wheel logo/spoke position to sell "crooked."
2. **0:04–0:09** — Cut to an exterior shot of a fresh tire being lowered onto a wheel hub in a shop
   bay, then a close-up on new tread grooves — contrasts "new tire" against the wheel-position
   symptom from beat 1.
3. **0:09–0:15** — Overhead/top-down shot of an alignment rack's laser/camera targets mounted on all
   four wheels of a vehicle on a lift, subtle indicator lights implying a reading is in progress.
4. **0:15–0:21** — Macro shot of a tire's tread face showing a feathered/uneven wear edge (one side
   worn more than the other), slow push-in to sell the "uneven wear" consequence.
5. **0:21–0:26** — Alignment rack display/monitor showing toe/camber value graphics (generic
   abstract gauge-style UI, no real brand/software chrome), static mount, shop-bay ambient lighting.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 1, 3, and
5 into two sub-shots each (quick punch-in or angle change) to reach ~10–12 sub-clips at ~2.5–3s
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
- Hashtags: `#CarMaintenance #WheelAlignment #TireTips #CarNoises #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🔧 Got new tires but the steering wheel sits crooked? That's an alignment clue,
  not a bad tire — new tread just made it easier to notice. Left off-center, that pull can wear
  brand-new tread unevenly. Don't guess — stop by and we'll take a look. 🚗"

### Ad-ready hook/caption/CTA variants

1. **Hook:** "Steering wheel crooked after new tires?" · **Caption:** "New tread doesn't cause an
   off-center wheel — it just reveals an alignment that was already off." · **CTA:** "Stop by and
   we'll take a look."
2. **Hook:** "Just got new tires and the wheel isn't straight?" · **Caption:** "One clue mechanics
   check first: alignment. Worth checking before new tread wears down crooked." · **CTA:** "Bring it
   in — we'll check the alignment."

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` -> **estimated generation cost if run today: $0.00** for
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
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated 53/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
| Server re-score at enqueue | **BLOCKED** | No `/api/admin/reel-canary {action:"start"}` call made — no credentials/route |
| Render-integrity gate (#800/#801) | **N/A — not rendered** | No MP4 exists this session |
| Rendered QA / vision critic (`renderedQa.ts`) | **N/A — not rendered** | Same |
| Repair routing / 7-way decision | **N/A** | No job exists to route |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED (by absence of a job)** | Cannot evaluate a gate against a nonexistent render — this is the gate's own `unavailable` state, not a silent pass |
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Directory scan (118 topics) + live PR-title search (16 open + 5 targeted) per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 8 | Visibly crooked wheel while driving straight is an immediately legible, slightly alarming hook |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 5 | "crooked," "steering wheel," "alignment," "new tires" all present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **52/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Steering wheel crooked after new tires? That's
an alignment clue, not a bad tire."}` to re-score, render, and move toward publish.

**Operator note (repeated from the top, so it isn't missed on a skim):** 16 reel-pack PRs are
currently open and unreviewed, growing roughly hourly, against 118 already-merged packs and a
2-posts/day publish cap. This run did not add to that backlog problem beyond its own one PR, but the
backlog itself is the thing that needs an operator decision now — not another pack.
