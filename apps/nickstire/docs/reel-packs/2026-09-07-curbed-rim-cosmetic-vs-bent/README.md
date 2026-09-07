# Reel pack — "Scraped your rim on a curb? Here's how to tell cosmetic damage from a bent wheel."

Produced by a **scheduled task** firing (2026-09-07), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call, a live production-DB read, or any
ChatGPT/TTS/Higgsfield/Meta-posting/CapCut action. This session made none of those calls. Deliverable
is a full production-ready **pack**, not a claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE`/`PRODUCTION` per the skill's mode table —
  research/score/pack only, no render, no publish; the incoming task's own step 5 says the same:
  "do not claim a finished file exists unless you have rendered it").
- Timestamp: 2026-09-07 (session clock).
- Capability check this session: `which ffmpeg` — not found; `which capcut` — not found; `env | grep
  -iE 'openai|higgsfield|meta|facebook|instagram|elevenlabs|tts|graph_api|admin_api_key|
  database_url'` — no matches. No ChatGPT, TTS, Higgsfield, Meta-posting, or CapCut tool exists in
  this session's toolset either. Result: **BLOCKED: NO MOTION ROUTE** this session -> full pack
  produced per the skill's explicit fallback, not a downgraded stills-only asset.
  `getHiggsfieldAccountHealth()` was **not called** (no running server, no credentials, no network
  path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — treated as inherited doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check instead:
  - `ls apps/nickstire/docs/reel-packs/2026-*/` — **153 merged pack directories**
    (`2026-08-14` through `2026-09-07`, this topic checked against all of them; three other packs
    already merged today alone — `steering-wheel-locked-key-wont-turn`,
    `tpms-light-wont-clear-after-refill`, `wheel-stud-snapped`).
  - `list_pull_requests(state:open)` on this repo — **2 open PRs** at time of this run: #2154
    (`reel pack — automatic headlights won't turn on at dusk`, a same-day sibling, different topic)
    and #2153 (a backlog-status note, not a content pack). No overlap with this pack's topic.
  - `grep -ril -E "trailer|resonator|rotor.*(ridge|lip)|rim.*curb|curb.*rash|wheel.*curb"` across
    every merged pack README — no hits for a curb-rash/bent-rim topic specifically (matches on other
    files were incidental OR-clause hits — rotor shake, brake pedal, spark plug wire, gas cap — none
    about wheel/rim curb damage). Also checked "wheel alignment/camber/caster/toe" and "load
    index/speed rating" as adjacent candidate topics first; both are already touched incidentally
    inside `tire-sidewall-numbers` and `balance-vs-alignment`, so this pack deliberately picked the
    cleaner, unused curb-rash/bent-wheel angle instead of risking a near-duplicate.
  - Four scheduled runs have now fired on 2026-09-07 alone (3 merged + this one). **Operator note
    carried forward:** at this cadence, review/merge needs to keep pace with firing frequency or the
    open-PR backlog regrows — matches the standing recommendation from the 2026-09-06 pack.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this backlog window. Scored against the
skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | Nearly every driver has curbed a wheel at least once — high personal-relevance hook |
| Distinct symptom cluster | 5/5 | No existing pack covers curb-rash vs. bent-wheel diagnosis (see §1) |
| Claim safety | 5/5 | No price, no guarantee, no invented timeline — soft language only |
| Novelty vs. existing 153+2 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 5/5 | All beats are static macro rim/tire shots; no moving-hand or dealership-specific footage required |

Selected: **"Scraped your rim on a curb? Here's how to tell cosmetic damage from a bent wheel."** No
runner-up concept was generated — single-topic run.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). The claims below are **general automotive knowledge**, not shop-specific sourced
  facts:
  - "A shallow outer-edge scuff is usually cosmetic" — standard tire-industry distinction between
    curb rash (cosmetic, doesn't affect the bead seal or roundness) and a bent/dented rim (structural).
  - "Warning signs of a bent wheel: steering-wheel wobble, a rhythmic vibration at speed, or slow air
    loss near the rim edge" — standard diagnostic signs cited across tire-industry consumer guidance;
    hedged as general signs, not a diagnosis of any specific vehicle.
  - "A bent wheel can still hold air for a while before it fails" — general mechanical fact (a small
    bend can still seal against the bead even while out-of-round), stated plainly, not quantified with
    a specific timeframe.
  - `entailment` status for all three: **`not_evaluated`** — mark `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Script deliberately contains **zero** shop-specific
  facts: no price for wheel repair/replacement, no hours, no phone number, no warranty claim —
  sidesteps the documented `FactChannel` gap (no `"reel"`/`"social"` scope exists yet).
- No weather/seasonal/local-event claim in this script at all (curb strikes aren't seasonal).
- **UNKNOWN, explicitly:** live entailment status of the three claims above; whether Nick's Tire &
  Auto specifically offers wheel-straightening or wheel-replacement services (near-certain for a
  full-service tire shop, but not confirmed against a live `business_facts` row this session — the
  script avoids asserting the shop offers any specific repair, only that a check is worth it);
  whether `0112_reel_publish_approvals.sql` has been applied to production (unresolved from prior
  runs, no DB access this session either to check).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Scraped your rim on a curb? Here's how to tell if it's just cosmetic — or something worse." |
| 0:04–0:10 | CONTEXT | "A shallow scuff on the outer edge is usually cosmetic — it doesn't affect how the wheel holds air or spins true." |
| 0:10–0:17 | DIAGNOSTIC | "The real warning signs are a wobble in the steering wheel, a rhythmic vibration at speed, or the tire slowly losing air near the rim edge." |
| 0:17–0:23 | CAVEAT | "A bent wheel can still hold air for weeks before it fails — don't wait for a blowout to find out." |
| 0:23–0:27 | SAFE ACTION / BRANDED CTA | "Worth a quick look if you felt or heard anything. Stop by and we'll take a look." |

Total runtime: 27s (within the 20–35s creative-quality-floor window). Approved soft language used:
*worth a quick look · stop by and we'll take a look.* No prices, no guarantees, no invented timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Macro shot of an alloy wheel rim outer edge with a shallow curb scuff, static
   camera, soft studio-style side light, dark tire sidewall in background.
2. **0:04–0:10** — Two macro rim-edge compositions in sequence (or a subtle crossfade): a shallow
   cosmetic scuff next to a deeper gouge, color-graded consistently, conveying "not all damage is the
   same" without any on-screen text or graphic.
3. **0:10–0:17** — Extreme macro, slow push-in on the tire-to-rim bead seal area, ambient shop
   lighting, emphasizing the seal line where a bend would leak.
4. **0:17–0:23** — Close-up of a tire pressure gauge pressed to a valve stem near the rim, gauge
   face/digits in focus, static mounted camera, no hand or arm in frame (gauge appears
   self-supported/clamped).
5. **0:23–0:27** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md`).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Five ~5s
beats as scripted above are borderline — recommend the assembler split beat 3 (bead-seal push-in, 7s)
into two sub-shots (different macro angle or push-in depth) to comfortably clear the ≥4-distinct-clip
/ motion-cadence requirement before this pack is fed to real generation. Flagging this explicitly
rather than presenting the 5-beat table as render-ready.

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
- Hashtags: `#CurbRash #BentWheel #WheelRepair #TireCare #CarMaintenance #AutoRepair #ClevelandAuto #NicksTireAndAuto`
- Caption (feed): "🛞 Curbed your rim? A shallow scuff is usually just cosmetic. Watch for a
  steering-wheel wobble, vibration at speed, or slow air loss near the rim — those mean it's worth a
  closer look. Stop by and we'll take a look."

### Two ad-ready hook/caption/CTA variants

**Variant A — "cosmetic or not" angle**
- Hook: "Curbed your rim? Here's the difference between a scuff and a real problem."
- Caption: "A shallow outer-edge scuff usually doesn't affect how the wheel holds air or spins true.
  A wobble, vibration, or slow leak is a different story."
- CTA: "Stop by and we'll take a look."

**Variant B — "don't wait for a blowout" angle**
- Hook: "A bent wheel can still hold air for weeks before it fails."
- Caption: "Feel a wobble or vibration after curbing a wheel? Don't wait for a blowout to find out
  what's going on."
- CTA: "Worth a quick look. Stop by and we'll take a look."

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` -> **estimated generation cost if run today: $0.00** for
  ~6 sub-clips on the free ffmpeg lane. This is a doc-inherited estimate, not a live balance read.
- `getHiggsfieldAccountHealth().balanceCredits`: **UNKNOWN** — not called this session (no
  credentials, no server).
- Day's `autonomy_policy_versions.limits.maxGenerationCostPerDayUsd` (documented default $10): **not
  read live this session** — treat as UNKNOWN, not assumed available. Also unknown: how much of
  today's cap the three already-merged same-day packs plus PR #2154 may have consumed if any of them
  were separately fed into the real pipeline by a live-authorized session — this pack cannot see that.
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
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
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
| First-frame scroll-stop (10) | 7 | Curb-rash macro is a relatable, high-personal-relevance hook |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook -> context -> diagnostic -> caveat -> safe action/CTA, all present |
| Length (5) | 5 | 27s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "curb," "rim," "wheel," "vibration" language present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **50/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete and
internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close. No
render was attempted, no generation spend occurred, no DB was read, and no publish call was made. An
operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Scraped your rim on a curb? Here's how to tell
cosmetic damage from a bent wheel."}` to re-score, render, and move toward publish — contingent on
`0112_reel_publish_approvals.sql` (§1, §7) actually being applied, which remains unconfirmed.

**Operator note:** four scheduled runs have now fired on 2026-09-07 alone (three merged, this one
pending). Review/merge cadence should match or exceed the trigger's firing cadence to avoid the
open-PR backlog regrowing — same standing recommendation carried from the 2026-09-06 pack, restated
because the pattern is repeating rather than resolving on its own.
