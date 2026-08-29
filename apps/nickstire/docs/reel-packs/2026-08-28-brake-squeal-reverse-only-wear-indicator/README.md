# Reel pack — "That squeal only when you back out isn't your imagination"

Produced by a **scheduled task** firing (2026-08-28), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-28 (session clock).
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
  - `ls apps/nickstire/docs/reel-packs/` — **117 merged pack directories** (`2026-08-14` through
    `2026-08-27`), spanning tires, brakes, cooling, electrical, drivetrain, HVAC, exhaust, and
    emissions. Nine merged directories already cover brakes specifically: `squealing-vs-grinding-brakes`,
    `warped-rotor-brake-shake`, `caliper-sticking-hot-wheel`, `brake-fluid-moisture-test`,
    `spongy-brake-pedal`, `brake-pedal-sinks-overnight`, `hard-brake-pedal-vacuum-booster`,
    `brake-light-switch-cruise-shifter`, and `road-salt-brake-lines` — none of them turn on
    direction (forward vs. reverse) as the diagnostic trigger.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack"
    in:title)` — **14 open reel-pack PRs** (plus one non-pack backlog-status PR, #1948). Four are
    brake-related: #1941 "grinding brakes on first stop of the day" (cold/rust, not direction),
    #1952 "excessive brake dust, normal vs. check-pads" (dust volume, not direction), #1956 "new
    brakes squeaking, bed-in glaze vs. bad pads" (post-install bedding, not direction). None
    mentions reverse, backing up, or wear-indicator geometry.
  - Checked this pack's topic (squeal that is audible specifically backing out of a driveway/in
    reverse, tied to wear-indicator-tab contact geometry, not a general "brakes are squeaking"
    topic) against all 117 merged + 14 open topics — **no overlap found.** The nearest neighbors
    (`squealing-vs-grinding-brakes`, `new-brakes-squeaking-bed-in-glaze-vs-bad-pads`,
    `grinding-brakes-first-stop-of-day`) all key on noise *type* or *time-of-day/temperature*, not
    on directionality. The script below names "backing out" and "one side" explicitly to stay
    distinguishable from all three.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this series. Scored against the skill's
rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament access this
session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "That squeal only when you're backing out isn't your imagination" — a specific, relatable, curiosity-driven claim |
| Distinct symptom cluster | 5/5 | Direction-dependent squeal (reverse only, or louder one side) tied to wear-indicator tab contact — mechanically specific, not a generic "brakes squeak" topic |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 117 merged + 14 open topics | 5/5 | No overlap found (see §1); nine merged brake topics and three open brake PRs all key on a different trigger (noise type, temperature, bedding) |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll/underbody-and-wheel shots; no dealership-specific footage required |

Selected: **"That squeal only when you're backing out isn't your imagination."** No runner-up
concept was generated — single-topic run, consistent with sibling packs in this series.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-repair knowledge** (disc-brake
  pads carry a small metal wear-indicator tab that contacts the rotor once the friction material
  wears down to minimum thickness, producing a metallic squeal; the tab's mounting position and
  any pre-existing uneven pad wear can make that contact — and the resulting squeal — more audible
  in one rotation direction or on one side of the vehicle than the other), not a shop-specific
  sourced fact. `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the wear-indicator/directional-squeal claim;
  whether Nick's Tire & Auto's actual customer-facing brake-inspection process specifically calls
  out wear-indicator contact as a diagnostic step (near-certain for any brake-service shop, but not
  confirmed against a live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "That squeal only when you're backing out isn't your imagination." |
| 0:04–0:09 | SYMPTOM | "One side, one direction — quiet the rest of the day, loud in reverse." |
| 0:09–0:15 | EXPLANATION / CUTAWAY | "One clue: a small wear-indicator tab that only touches the rotor going one way." |
| 0:15–0:21 | CONSEQUENCE / PROOF | "Ignore it long enough and that tab wears through — that's when a squeal can turn into a grind." |
| 0:21–0:26 | SAFE ACTION | "Don't guess which side, or how much pad you've got left." |
| 0:26–0:30 | BRANDED CTA | "Worth checking before a squeal becomes a bigger repair. Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · don't guess · stop by and we'll take a look.* No prices, no
guarantees, no invented timelines. "That's when a squeal can turn into a grind" alludes to a real
progression (worn indicator tab → exposed backing plate/rotor contact → grinding) without naming a
specific outcome or timeline as fact.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Rear three-quarter shot of a sedan backing out of a driveway, static-mounted
   camera, overcast daylight, slight handheld-style micro-shake for tension.
2. **0:04–0:09** — Close-up on a single front wheel/rim through the spokes, static mount, subtle
   focus pull; cut to a reverse-gear indicator glowing on a dash cluster.
3. **0:09–0:15** — Macro/cutaway shot: a brake pad removed from a caliper, resting on a workbench,
   the small metal wear-indicator tab visible at the pad's edge, slow push-in on the tab.
4. **0:15–0:21** — Close-up on a worn brake rotor surface with light scoring, dim shop-bay
   lighting, static hold, subtle grain to suggest wear.
5. **0:21–0:26** — Underbody/wheel-off inspection shot: an inspection light and a pad-thickness
   gauge positioned near a caliper (tool visible, mounted/clipped — no hand in frame), shop bay
   softly blurred behind.
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
- Hashtags: `#CarMaintenance #BrakeCare #CarNoises #BrakeSqueal #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🔧 Only hear a squeal backing out of the driveway? One clue mechanics check: a
  wear-indicator tab that only touches the rotor going one direction. Don't guess how much pad you
  have left — stop by and we'll take a look. 🚗"

Ad-ready variant A (hook/caption/CTA): Hook — "Backing out and you hear a squeal — but it's silent
the rest of the day?" Caption — "That's not random. A wear-indicator tab can make brake squeal
direction-dependent. Worth checking before it becomes a grind." CTA — "Stop by Nick's Tire & Auto —
we'll take a look."

Ad-ready variant B (hook/caption/CTA): Hook — "One side squealing, the other silent? Direction
matters." Caption — "A small metal tab on your brake pad is designed to squeal before your pads run
out — but it doesn't always squeal in every direction the same way. Don't guess which side needs
attention." CTA — "Nick's Tire & Auto — worth checking, no pressure."

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
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Directory scan (117 merged) + open-PR title search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 7 | Backing-out-of-driveway + squeal hook is relatable and specific |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → symptom → explanation → consequence → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "squeal," "wear indicator," "brake pad" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **50/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"That squeal only when you're backing out
isn't your imagination"}` to re-score, render, and move toward publish.
