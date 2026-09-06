# Reel pack — "That grease smear inside your wheel isn't dirt — it's a torn CV boot"

Produced by a **scheduled task** firing (2026-09-04), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read. This
session made none of those calls. Deliverable is a full production-ready **pack**, not a claimed
render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-09-04 (session clock).
- Capability check this session:
  `env | grep -ioE '^[A-Z_]+=' | grep -iE 'higgsfield|reel|admin_api|instagram|meta|database_url|openai|anthropic|elevenlabs|tts'`
  returned only `ANTHROPIC_BASE_URL` (empty value) — no Higgsfield credential, no `ADMIN_API_KEY`, no
  `DATABASE_URL`, no TTS provider key, no Meta/Instagram token. Local binaries checked directly:
  `ffmpeg` — **missing**, `hf`/`higgsfield` CLI — **missing**. Result: **BLOCKED: NO MOTION ROUTE**
  this session -> full pack produced per the skill's explicit fallback, not a downgraded stills-only
  asset. `getHiggsfieldAccountHealth()` was **not called** (no running server, no credentials, no
  network path to it). No ChatGPT, TTS, Higgsfield, Meta-posting, or CapCut tool exists in this
  session's toolset either — confirmed by tool search, not assumed.
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Treat this as inherited
  doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check instead:
  - `ls apps/nickstire/docs/reel-packs/2026-*/` — **145 merged pack directories** at the time of
    this run (up from 136 recorded by the prior scheduled run), spanning tires, brakes, cooling,
    electrical, drivetrain, HVAC, and emissions.
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack"
    in:title)` — **1 open PR** at time of this run: #2114 ("blind spot monitor light"). This is a
    sharp drop from the 9 open PRs the prior scheduled run recorded, and from the ~141-item backlog
    PR #2076 flagged on 2026-09-02 — meaning a review/merge pass evidently happened between that run
    and this one. Recording this plainly because the prior two packs' operator notes escalated the
    backlog concern and it is now worth confirming the trend reversed, not just repeating the alarm.
  - Checked this pack's topic (a torn CV axle boot slinging grease, caught before the joint itself
    fails) against all 145 merged topics and the 1 open-PR title — **no direct overlap found.**
    Nearest neighbor is `cv-joint-click` (2026-08-18), but that pack is about the **audible click on
    turns once the joint has already lost lubrication and dirt has gotten in** — a later failure
    stage. This script is framed explicitly around the **earlier, silent, visual-only warning sign**
    (a torn boot flinging grease, no sound yet) so a viewer who has already seen the click-symptom
    pack still gets new information, not a repeat.
  - Separately unresolved from the prior two runs, and still unresolved here (no DB access this
    session either): whether migration `0112_reel_publish_approvals.sql` has been applied to
    production TiDB. Until it has, per the prior runs' own posture, no reel — this one included —
    can move past `PUBLISH` even if fully rendered. Treating the publish door as still shut absent
    explicit operator confirmation.

## 2. Candidate scores and selected concept

Single-concept run (topic backlog is not the binding constraint this run — see §1). Scored against
the skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "That's not dirt" on a visibly grease-flecked wheel well is a concrete, unusual-looking visual hook |
| Distinct symptom cluster | 5/5 | No existing pack covers the *pre-failure* torn-boot warning sign; nearest neighbor (`cv-joint-click`) covers the later audible-failure stage |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only |
| Novelty vs. existing 145+1 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 5/5 | All beats are static macro/cutaway/wide shots; no dealership-specific footage or moving-hand shots required |

Selected: **"That grease smear inside your wheel isn't dirt — it's a torn CV boot"** No runner-up
concept was generated — single-topic run, consistent with sibling packs in this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). The torn-boot/grease-sling/dry-joint claim below is **general automotive knowledge**
  (a CV axle boot is a flexible rubber/thermoplastic bellows that retains grease around the
  constant-velocity joint; once it splits, centrifugal force flings grease outward onto nearby
  suspension and wheel surfaces, and the joint itself runs dry and admits grit — a mechanically
  well-established failure chain, not a shop-specific claim), not a sourced fact. `entailment`
  status: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no warranty claim.
- No seasonal/weather/local-event claim is made in this script — nothing to flag as `UNKNOWN` on
  that front, unlike some prior packs in this series.
- **UNKNOWN, explicitly:** live entailment status of the torn-boot/grease-sling/dry-joint claim;
  whether Nick's Tire & Auto specifically inspects CV boots during a routine tire rotation (near-
  certain for a general tire/repair shop, but not confirmed against a live `business_facts` row this
  session); whether `0112_reel_publish_approvals.sql` has run against production (see §1).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "See grease flung inside your wheel? That's not dirt." |
| 0:04–0:09 | SYMPTOM | "A torn CV boot slings grease everywhere it can reach — and doesn't make a sound yet." |
| 0:09–0:15 | EXPLANATION | "One clue: no clicking yet doesn't mean it's fine — the joint fails once the grease is gone and dirt gets in." |
| 0:15–0:21 | CONSEQUENCE / DIFFERENTIATOR | "By the time you hear a click on turns, the joint itself may already be damaged — the boot was the warning." |
| 0:21–0:26 | SAFE ACTION | "Worth checking during a routine rotation, before it turns into a full axle replacement." |
| 0:26–0:30 | BRANDED CTA | "Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*one clue · can · worth checking · stop by and we'll take a look.* No prices, no guarantees, no
invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Macro/cutaway shot: inside a vehicle wheel well with the wheel removed, fine
   dark-grease flecks visible flung across the inner wheel barrel and nearby suspension components,
   static camera, dim garage lighting.
2. **0:04–0:09** — Close-up on a torn accordion-fold rubber CV boot, a visible split along one fold
   with dark grease coating the surrounding area, static mounted camera, slow push-in.
3. **0:09–0:15** — Macro/cutaway shot: a clean, intact CV boot on a comparable axle for contrast —
   taped/clamped seams visible, no tears, no grease residue nearby, static camera, dim garage
   lighting.
4. **0:15–0:21** — Close-up on an exposed CV joint with grease visibly missing/dry and fine grit
   caught in the joint grooves, static mounted camera.
5. **0:21–0:26** — Wide shot: a vehicle raised on a shop lift with one wheel removed, a service cart
   with hand tools resting nearby (no hands or human figures in frame), static camera, workshop
   lighting.
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 1, 2, and
4 into two sub-shots each (angle change or push-in) to reach ~10–12 sub-clips at ~2.5–3s apiece
before this pack is fed to real generation. Flagging this explicitly rather than presenting the
6-beat table as render-ready.

### Assembly instructions (ffmpeg/CapCut)

1. Order clips exactly as beats 1→6 above (after the sub-shot split noted above).
2. Trim each sub-clip to its allotted window; hard-cut or short (≤0.2s) crossfade between beats — no
   `zoompan`/Ken-Burns stills filters (documented cause of the frozen-frame regression in
   `REEL-PIPELINE.md` §"Render-integrity gate").
3. Burn in captions from `captions.srt` (below), bottom-third safe zone, high-contrast style
   matching the account's existing caption preset.
4. Composite the Nick's Tire & Auto logo and CTA text on beat 6 only, in post (not generated).
5. Mix voiceover (TTS, not produced this session — no TTS credential available) as the primary audio
   layer; add a 3s freeze-frame "SAVE" card after 0:30 per the storyboard contract used by the
   render-integrity gate (container duration = beats + 3s freeze ≈ 33s).
6. Export 9:16, 1080×1920, H.264, target ≥30fps throughout (render-integrity gate requires ≥80% of
   expected 30fps frame count).

### Posting specs

- Platform: Instagram Reels (primary), cross-post to Facebook Reels via the same asset.
- Dimensions: 1080×1920 (9:16), MP4, ≤30s target already met.
- Hashtags: `#CarMaintenance #CVJoint #AxleCare #CarTips #AutoRepair #ClevelandAuto #NicksTireAndAuto #CarProblems`
- Caption (feed): "🔧 That grease inside your wheel isn't dirt — it's a torn CV boot flinging grease
  before the joint ever makes a sound. Worth checking during a routine rotation. Stop by and we'll
  take a look."

### Two ad-ready hook/caption/CTA variants

**Variant A — curiosity angle**
- Hook: "That grease inside your wheel isn't dirt."
- Caption: "A torn CV boot slings grease long before the joint ever clicks. One quick look during a
  rotation can catch it early."
- CTA: "Stop by and we'll take a look."

**Variant B — cost-avoidance angle**
- Hook: "Don't wait for the click — the boot warns you first."
- Caption: "A torn CV boot means the joint is running dry right now, even if it's silent. Catching it
  early is a boot replacement, not a full axle."
- CTA: "Worth checking first. Stop by and we'll take a look."

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` -> **estimated generation cost if run today: $0.00** for
  ~10–12 sub-clips on the free ffmpeg lane. This is a doc-inherited estimate, not a live balance
  read.
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
| Publish-approvals migration (`0112_reel_publish_approvals.sql`) | **UNKNOWN** | Flagged unresolved by two prior runs; no DB access this session either to check |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 7 | Grease flung across a wheel barrel is a concrete, slightly unsettling visual — stronger hook than a plain dark dashboard |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook -> symptom -> explanation -> consequence -> safe action -> CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "CV boot," "grease," "joint," "axle" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **50/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete and
internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close. No
render was attempted, no generation spend occurred, no DB was read, and no publish call was made. An
operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"That grease smear inside your wheel isn't dirt —
it's a torn CV boot"}` to re-score, render, and move toward publish — contingent on
`0112_reel_publish_approvals.sql` (§1, §7) actually being applied, which remains unconfirmed.

**Operator note:** open `reel pack` PR backlog dropped from 9 (prior run) to **1** (#2114, blind spot
monitor light) at time of this run, and merged pack count rose from 136 to 145 — the review/merge
pass the last two runs asked for evidently happened. No fresh escalation needed this run; flagging
the improvement so it's visible without having to diff two READMEs. The one open item worth a human
decision, unrelated to backlog volume: whether `0112_reel_publish_approvals.sql` has been applied to
production TiDB remains unconfirmed across three consecutive scheduled runs now — that gate blocks
every pack in this series (145 merged + this one) from ever reaching `PUBLISH`, not just this topic.
