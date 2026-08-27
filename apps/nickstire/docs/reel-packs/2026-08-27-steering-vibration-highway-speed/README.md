# Reel pack — "Steering wheel shakes only at highway speed? That's a clue"

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
  returned **nothing** relevant — no Higgsfield credential, no `ADMIN_API_KEY`, no `DATABASE_URL`,
  no TTS provider key, no Meta/Instagram token. Also checked local binaries: `ffmpeg` — **missing**,
  `gh` — **missing** (GitHub access this session goes through the connected GitHub MCP tools
  instead). Result: **BLOCKED: NO MOTION ROUTE** this session → full pack produced per the skill's
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
  - `ls apps/nickstire/docs/reel-packs/` — **118 merged pack directories** at the start of this run
    (`2026-08-14` through `2026-08-27`, including 4 already produced today), spanning tires, brakes,
    cooling, electrical, drivetrain, HVAC, and emissions.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack" in:title)`
    — **0 open PRs.** The prior pack's own README records that the entire 23-PR backlog was cleared
    earlier by a live operator instruction; this run independently confirmed the queue is still
    clean (0 open PRs total in the repo except one unrelated `statenour` fix, #1926).
  - A second targeted search — `"steering" OR "wheel vibration" OR "bent rim" OR "wheel balance"
    in:title` — returned 3 results, all **closed**: #1708 "steering wheel shakes when you brake
    (warped rotors)" (a **braking-triggered** shake, already covered in this pack series as
    `warped-rotor-brake-shake`), #1675 "power-steering-whine" (a noise/whine complaint, not
    vibration), and #197 (an unrelated Meta-publishing feature PR, not a reel pack). No open or
    merged pack addresses a **speed-correlated, brake-independent** steering vibration.
  - Checked this topic against the directory listing's closest neighbors — `warped-rotor-brake-shake`
    (shake triggered **by pressing the brake pedal**, from a warped rotor) and `balance-vs-alignment`
    (the car **pulls to one side**, not a vibration) — both use a different trigger and different
    root-cause tree than "shakes at a specific highway speed regardless of braking, worse the faster
    you go." The script below names the speed-correlation and brake-independence explicitly to stay
    distinguishable from both.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this series. Scored against the skill's
rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament access this
session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "If your steering wheel only shakes at highway speed" — specific, curiosity-driven, invites self-diagnosis |
| Distinct symptom cluster | 5/5 | Speed-correlated, brake-independent vibration — mechanically distinct decision tree from the existing brake-shake and pulling-to-one-side packs |
| Claim safety | 5/5 | No price, no guarantee, no invented timeline — soft language only |
| Novelty vs. existing 118 topics | 5/5 | No overlap found (see §1); live PR-title search returned only closed, off-topic or already-covered results |
| Producibility (faceless, no live footage needed) | 5/5 | All beats are plausible AI-gen or stock B-roll shots (steering wheel, wheel/tire spin, balancing machine); no dealership-specific footage required |

Selected: **"Steering wheel shakes only at highway speed? That's a clue."** No runner-up concept
was generated — single-topic run, consistent with sibling packs in this series.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (a wheel/tire
  assembly that is out of balance, or a rim with impact-induced bend/runout, produces a vibration
  that scales with rotational speed and is present regardless of brake application — distinct from a
  warped brake rotor, which vibrates only under brake-pedal pressure), not a shop-specific sourced
  fact. `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the balance-vs-bent-rim vibration claim;
  whether Nick's Tire & Auto specifically offers wheel balancing on-site (near-certain for a tire
  shop, but not confirmed against a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "If your steering wheel only shakes at highway speed, that's not random." |
| 0:04–0:09 | SYMPTOM | "Smooth around town, then a vibration kicks in around 55 to 65 — and gets worse the faster you go." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: it's the wheel and tire, not the brakes — an out-of-balance tire or a bent rim." |
| 0:15–0:21 | DIFFERENTIATION / PROOF | "Only shakes when you brake? Different problem — a warped rotor. Shakes at speed no matter what? This is it." |
| 0:21–0:26 | SAFE ACTION | "Don't guess. A quick balance check on the machine can find it fast." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before it wears on your suspension. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines. "Wears on your suspension" alludes to a real, well-known
consequence of sustained unbalanced-wheel vibration (accelerated wear on suspension/steering
components) without naming a specific outcome or timeline as fact.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Interior POV shot from the driver's seat looking at the steering wheel on an open
   highway, subtle vibration blur cue on the wheel rim, daylight, static-mounted camera.
2. **0:04–0:09** — Exterior side-tracking shot of a sedan accelerating on a highway on-ramp, speed
   blur on the wheel/tire only (rest of frame sharp) to visually imply the vibration source; cut to
   a speedometer needle climbing past 55.
3. **0:09–0:15** — Macro/cutaway shot: a wheel and tire assembly on a balancing machine in a shop
   bay, small clip-on weights visible along the rim edge, slow push-in, no hands in frame (weights
   already attached, static mount).
4. **0:15–0:21** — Split-style comparison cutaway: left side a brake rotor with visible warp/heat
   discoloration (labelled implicitly by context, no on-screen text), right side a wheel/tire
   spinning smoothly on a balancer — visually contrasting the two failure modes without text.
5. **0:21–0:26** — Shop-bay wide shot: a wheel balancing machine mid-cycle, digital readout glowing
   (numbers illegible/blurred, no readable on-screen text per negative prompt), tech tools visible
   but no hands/figures in frame.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md`).

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
- Hashtags: `#CarMaintenance #WheelBalance #SteeringWheel #CarVibration #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🚗 Steering wheel shakes only on the highway? One clue mechanics check: an
  out-of-balance tire or a bent rim — not the brakes. Don't guess, it only gets worse. Stop by and
  we'll check it on the balancer. 🔧"

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
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated ~50/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
| Server re-score at enqueue | **BLOCKED** | No `/api/admin/reel-canary {action:"start"}` call made — no credentials/route |
| Render-integrity gate (#800/#801) | **N/A — not rendered** | No MP4 exists this session |
| Rendered QA / vision critic (`renderedQa.ts`) | **N/A — not rendered** | Same |
| Repair routing / 7-way decision | **N/A** | No job exists to route |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED (by absence of a job)** | Cannot evaluate a gate against a nonexistent render — this is the gate's own `unavailable` state, not a silent pass |
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Directory scan (118 topics) + live PR-title search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 7 | Driver-POV steering-wheel hook is relatable and specific to a common highway complaint |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → differentiation → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "steering wheel," "balance," "vibration" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **50/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Steering wheel shakes only at highway speed?
That's a clue"}` to re-score, render, and move toward publish.

**Operator note on cadence:** this is the **5th** scheduled reel-pack run to land on 2026-08-27.
The PR queue is currently clean (0 open reel-pack PRs, confirmed independently this run), so this
pack does not repeat the stuck-backlog finding from six prior runs (#1842 through #1921). If this
scheduled task continues firing multiple times per day, the queue will refill at the same rate
observed 2026-08-23 through 2026-08-27 unless review cadence or trigger frequency changes — worth a
look at the trigger interval if daily output volume (5+ packs/day) exceeds what gets reviewed.
