# Reel pack — "Paid extra for nitrogen in your tires? Here's what it actually does."

Produced by a **scheduled task** firing (2026-09-06), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read. This
session made none of those calls. Deliverable is a full production-ready **pack**, not a claimed
render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE`/`PRODUCTION` per the skill's mode table —
  research/score/pack only, no render, no publish).
- Timestamp: 2026-09-06 (session clock).
- Capability check this session: `which ffmpeg` — missing; `which capcut` — missing; `env | grep -iE
  'openai|higgsfield|meta|facebook|instagram|elevenlabs|tts|graph_api|admin_api_key|database_url'` —
  no matches. No ChatGPT, TTS, Higgsfield, Meta-posting, or CapCut tool exists in this session's
  toolset either. Result: **BLOCKED: NO MOTION ROUTE** this session -> full pack produced per the
  skill's explicit fallback, not a downgraded stills-only asset. `getHiggsfieldAccountHealth()` was
  **not called** (no running server, no credentials, no network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — treated as inherited doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check instead:
  - `ls apps/nickstire/docs/reel-packs/2026-*/` — **150 merged pack directories**
    (`2026-08-14` through `2026-09-06`, this pack's own topic already checked against all of them).
  - `search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel pack"
    in:title)` — **1 open PR** at time of this run (#2136, a "backlog status — no new pack" note,
    not a content pack). The 11-open-PR backlog flagged by the 2026-09-05 session has since been
    substantially cleared (merged commits #2134, #2135, #2108, #2107, #2106, #2104 and others
    visible in `git log`) — good sign the standing operator note is being acted on.
  - Checked this pack's topic (nitrogen vs. regular air tire fill) against all merged topics and the
    one open PR title — **no overlap found.** `grep -ril nitrogen` across all pack READMEs hit only
    incidental unrelated mentions (gas struts, an AWD/leak pack) — the tire-inflation angle itself
    has not been used.
  - Still unresolved from prior runs (no DB access this session either): whether migration
    `0112_reel_publish_approvals.sql` has been applied to production TiDB. Treating the publish
    door as still shut absent explicit operator confirmation.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this backlog window. Scored against the
skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 3/5 | A myth-check/money-question hook ("paid extra for this?") is a proven angle (same shape as the existing AC-recharge-myth pack) but not a novel hook format |
| Distinct symptom cluster | 5/5 | No existing pack covers tire nitrogen fill (see §1) |
| Claim safety | 5/5 | No price, no guarantee, no invented timeline — soft language only |
| Novelty vs. existing 150+1 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 5/5 | All beats are static macro/valve/gauge shots; no moving-hand or dealership-specific footage required |

Selected: **"Paid extra for nitrogen in your tires? Here's what it actually does."** No runner-up
concept was generated — single-topic run.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). The claims below are **general automotive knowledge**, not shop-specific sourced
  facts:
  - "Regular air is ~78% nitrogen already" — standard atmospheric composition fact, not automotive-
    specific.
  - "Nitrogen molecules are larger and permeate rubber more slowly than oxygen, giving somewhat
    slower pressure loss over time" — a widely documented physical/tire-industry claim, hedged in
    the script as "a little slower," not quantified.
  - "Nitrogen-filled tires still lose pressure in cold weather" — standard gas-law fact (pressure
    drops with temperature regardless of fill gas), stated plainly, not hedged as uncertain because
    it is not in dispute.
  - `entailment` status for all three: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Script deliberately contains **zero** shop-specific
  facts: no price for nitrogen fill or refill, no hours, no phone number, no warranty claim —
  sidesteps the documented `FactChannel` gap (no `"reel"`/`"social"` scope exists yet).
- No weather/seasonal/local-event claim beyond the generic "cold weather drops pressure" physics
  fact, which is stated as a general mechanism, not a Cleveland-specific forecast claim.
- **UNKNOWN, explicitly:** live entailment status of the three claims above; whether Nick's Tire &
  Auto specifically offers a nitrogen-fill service (near-certain for a full-service tire shop, but
  not confirmed against a live `business_facts` row this session — the script avoids asserting the
  shop offers or recommends the service, only that pressure is worth checking either way); whether
  `0112_reel_publish_approvals.sql` has been applied to production (see §1).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Paid extra for nitrogen in your tires? Here's what it actually does." |
| 0:04–0:10 | CONTEXT | "Regular air is already about 78 percent nitrogen. The fill just pushes that closer to 95 percent or more." |
| 0:10–0:17 | VALUE | "The real benefit: nitrogen molecules are bigger, so they leak through the rubber a little slower, meaning slightly steadier pressure over time." |
| 0:17–0:23 | CAVEAT | "But it's not a substitute for checking your pressure. Even nitrogen-filled tires still lose pressure with cold weather." |
| 0:23–0:27 | SAFE ACTION / BRANDED CTA | "Worth checking your pressure monthly either way. Stop by and we'll take a look." |

Total runtime: 27s (within the 20–35s creative-quality-floor window). Approved soft language used:
*worth checking · stop by and we'll take a look.* No prices, no guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Macro shot of a tire valve stem with a green metal valve cap (the common
   nitrogen-fill marker color), dark tire sidewall background, static camera, soft studio-style
   side light.
2. **0:04–0:10** — Two near-identical macro tire-valve compositions in sequence (or a subtle
   crossfade), color-graded a hair differently, conveying "same thing, different ratio" without any
   on-screen text or graphic.
3. **0:10–0:17** — Extreme macro of tire sidewall rubber texture, slow push-in, ambient shop
   lighting, emphasizing surface porosity/texture.
4. **0:17–0:23** — Close-up of an analog or digital tire pressure gauge pressed to a valve stem,
   gauge face/digits in focus, static mounted camera, no hand or arm in frame (gauge appears
   self-supported/clamped).
5. **0:23–0:27** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md`).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Five ~5s
beats as scripted above are borderline — recommend the assembler split beat 3 (rubber texture,
7s) into two sub-shots (different macro angle or push-in depth) to comfortably clear the ≥4-distinct-
clip / motion-cadence requirement before this pack is fed to real generation. Flagging this
explicitly rather than presenting the 5-beat table as render-ready.

### Assembly instructions (ffmpeg/CapCut)

1. Order clips exactly as beats 1→5 above (after the sub-shot split noted above).
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
- Hashtags: `#TirePressure #NitrogenTires #TireCare #CarMaintenance #TireMyths #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🟢 Nitrogen in your tires — worth it, or just upsell? Regular air is already
  ~78% nitrogen; the fill mostly means slightly slower pressure loss over time. Either way, check
  your pressure monthly. Stop by and we'll take a look."

### Two ad-ready hook/caption/CTA variants

**Variant A — myth-check angle**
- Hook: "Nitrogen tire fill — worth the upcharge, or just upsell?"
- Caption: "Regular air is already ~78% nitrogen. The real benefit is slightly slower pressure loss
  over time — not a substitute for checking your pressure."
- CTA: "Stop by and we'll take a look."

**Variant B — cold-weather angle**
- Hook: "Nitrogen won't save you from a cold-weather pressure drop."
- Caption: "Even nitrogen-filled tires lose pressure when temps drop. Worth checking monthly either
  way, whichever gas is in there."
- CTA: "Worth checking first. Stop by and we'll take a look."

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` -> **estimated generation cost if run today: $0.00** for
  ~6 sub-clips on the free ffmpeg lane. This is a doc-inherited estimate, not a live balance read.
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
| First-frame scroll-stop (10) | 6 | Valve-cap macro hook is clean but quieter than a warning light or failure event |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook -> context -> value -> caveat -> safe action/CTA, all present |
| Length (5) | 5 | 27s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "nitrogen," "tire pressure," "psi"-adjacent language present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **49/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete and
internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close. No
render was attempted, no generation spend occurred, no DB was read, and no publish call was made. An
operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Paid extra for nitrogen in your tires? Here's
what it actually does."}` to re-score, render, and move toward publish — contingent on
`0112_reel_publish_approvals.sql` (§1, §7) actually being applied, which remains unconfirmed.

**Operator note:** the backlog previously flagged (11 open "reel pack" PRs as of 2026-09-05) has
been substantially cleared — only 1 open PR remains at the time of this run, and it is a status note,
not unmerged content. No escalation needed this run; the standing recommendation (review/merge cadence
matching or exceeding the trigger's firing cadence) appears to be holding. If that changes, a future
run should re-raise it.
