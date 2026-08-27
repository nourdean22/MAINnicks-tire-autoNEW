# Reel pack — "A flashing check engine light is not the same warning as a steady one"

Produced by a **scheduled task** firing (2026-08-26), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 0. Correction to the last two status reports (read this first)

PR #1842 and PR #1874 (2026-08-25, 16:29 and 21:30 UTC) each reported "127 open PRs" and "132
open PRs" respectively and recommended withholding new packs because the backlog looked
unmanageable. This run re-ran that search **with an explicit `is:open` qualifier** and found the
real number:

| Query | Result |
|---|---|
| `is:pr "reel pack" in:title` (no state qualifier, what the prior two reports used) | **137** (all-time — open + closed + merged) |
| `is:pr is:open "reel pack" in:title` (correct query) | **11** (9 individual pack PRs + the 2 stale status PRs themselves) |
| `list_pull_requests(state=open)`, full repo | **12** total open PRs (9 packs + 2 status notes + 1 dependabot bump) |

The GitHub search API does not default to open-only when no `is:` qualifier is given — omitting
it returns every state ever matched. The prior two reports' "127" and "132" were the **all-time
total**, not the open backlog, and the recommendation built on that number ("pause the scheduled
task," "batch-review 132 PRs") was acting on a measurement error, not a real pileup. The actual
open backlog (9 unreviewed daily packs) is normal, healthy inventory for a task that fires
roughly hourly and gets batch-merged periodically — consistent with **~101 merged pack
directories** already in `apps/nickstire/docs/reel-packs/` spanning 2026-08-14 through
2026-08-25.

This run proceeds to produce a real pack, per the skill's normal SCHEDULED-mode process, because
the reason the last two runs stood down does not hold up. The two stale status PRs (#1842,
#1874) are left as-is — closing other sessions' PRs without operator authorization is outside
this run's scope — but the operator should know the "132 open" framing in their titles is wrong.

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack
  only, no render/publish, no `reel-canary` calls made).
- Timestamp: 2026-08-26 (session clock).
- Capability check this session: `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|
  OPENAI|ANTHROPIC|META_|INSTAGRAM|FACEBOOK|TTS|CAPCUT'` returned nothing — no Higgsfield
  credential, no `ADMIN_API_KEY`, no `DATABASE_URL`, no TTS provider key, no Meta/Instagram
  token. Local binaries checked: `node`, `pnpm`, `curl` present; `ffmpeg` and `gh` not on PATH.
  Result: **BLOCKED: NO MOTION ROUTE** this session → full pack produced per the skill's
  explicit fallback (§ "Producing a pack when the motion route is unavailable"), not a
  downgraded stills-only asset. `getHiggsfieldAccountHealth()` was **not called** — no running
  server, no credentials, no network path to it.
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, expected
  per-clip generation cost is **$0**, not the `$0.25` Seedance estimate. Inherited doc-truth,
  not a live read this session.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a prod-DB read is out of scope for an unattended run per `prod-db-guard`).
  Substituted offline checks instead (see §0 for the corrected PR count):
  - `ls apps/nickstire/docs/reel-packs/` — **~101 merged pack directories** plus 9 open pack PRs
    not yet merged, spanning tires, brakes, cooling, electrical, drivetrain, HVAC, exhaust, and
    emissions topics.
  - Checked this pack's topic (flashing vs. steady check engine light — urgency triage, not
    root-cause diagnosis) against all ~110 existing/pending topics — **no title or topic overlap
    found.** Nearest neighbors: `check-engine-light` (08-16, general "what the light means"),
    `gas-cap-check-engine-light` (08-21, one specific trigger), `misfire-shudder-coil-vs-plug`
    (08-25, diagnosing *which component* misfires) — none address the **blink pattern itself**
    as the signal, which is the angle here. The script below is written to stay on that angle
    (flash vs. steady = urgency) rather than re-explaining misfire root-cause, to keep the two
    distinguishable.

## 2. Candidate scores and selected concept

Single-concept run. Scored against the skill's rubric out of 5 per dimension, self-estimated (no
live critic panel — no DB/tournament access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 5/5 | Direct question hook tied to a light most drivers have seen and misjudged |
| Distinct symptom cluster | 5/5 | Blink-pattern-as-urgency-signal is mechanically specific and not covered by any existing pack |
| Claim safety | 5/5 | No price, no guarantee, no fearmongering beyond established general knowledge; uses approved soft-language bank |
| Novelty vs. existing ~110 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 5/5 | All beats are dashboard/engine-bay/exhaust B-roll or stock; no dealership-specific footage required |

Selected: **"A flashing check engine light is not the same warning as a steady one."** No
runner-up concept generated — single-topic run, consistent with sibling packs in this series.

## 3. Claim evidence

No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
available). The core claims below are **general automotive-repair knowledge** (standard OBD-II
diagnostic guidance, not shop-specific), not a sourced `businessFacts` row:

- A **flashing/blinking** check engine light generally indicates an active, severe engine misfire
  in progress — the engine is passing unburned fuel into the exhaust system, where it can
  overheat and damage the catalytic converter.
- A **steady** check engine light generally indicates a stored fault code without that same
  immediate risk — worth diagnosing, not an emergency.
- `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not `supported`. Do not present this
  as a shop-verified fact in the final caption; the approved soft-language bank in
  `client/src/lib/facelessReelStudio.ts` is used throughout (*can point to · may indicate · worth
  checking · one clue · do not guess · stop by and we'll take a look*).
- **No price, warranty, or timeline claim is made anywhere in the script** — converter cost is
  referenced only as "expensive," never a figure, per the repo's explicit no-prices-in-reel rule
  (`docs/operations/REEL-PIPELINE.md` § Creative quality floor, and this skill's claim-safety
  section).
- **Gap, not papered over:** `businessFacts.ts`'s `FactChannel` type has no `"reel"`/`"social"`
  channel yet, so even if DB access existed this session, no business fact here would be
  channel-cleared for public video use. Treated as `BLOCKED` for any shop-specific claim — none
  were used.
- No local/weather/event claim is made — none needed for this topic.

## 4. Production pack

### Script (word-for-word, timed to seconds — target ~30s, 7 beats)

| Beat | Time | Narration | Role |
|---|---|---|---|
| 1 | 0:00–0:03 | "Is your check engine light flashing... or just staying on?" | Hook |
| 2 | 0:03–0:07 | "That blink is not the same warning as a steady light." | Symptom/detail |
| 3 | 0:07–0:13 | "A flashing light usually means an active misfire — the engine is dumping unburned fuel into a red-hot catalytic converter." | Explanation/cutaway |
| 4 | 0:13–0:18 | "Keep driving on that, and you're not looking at a cheap fix anymore — a damaged converter is one of the most expensive parts under your car." | Consequence/proof |
| 5 | 0:18–0:23 | "If it's flashing: ease off the gas, avoid highway speed, and get it looked at today." | Safe action (flashing) |
| 6 | 0:23–0:27 | "A steady light is different — it's worth checking soon, but it's not an emergency." | Safe action (steady, contrast) |
| 7 | 0:27–0:31 | "One clue, two very different next steps. Not sure which you're looking at? Stop by and we'll take a look." | Branded CTA |

~31s total, 7 beats — within the 20–35s / 5–8 beat motion-first floor
(`docs/operations/REEL-PIPELINE.md` § Creative quality floor).

### Per-beat visual prompts (Higgsfield-style, motion-first)

Standing negative prompt for every beat (per this skill): `faces, hands, human figures,
on-screen text, logos, watermarks, subtitles`

1. **Beat 1** — Close-up dashboard instrument cluster at night, check engine light icon blinking
   on/off in a dark cabin, shallow depth of field, subtle camera drift in.
2. **Beat 2** — Same dashboard, check engine light now steady/solid (no blink), slow push-in,
   contrast lighting to visually separate from beat 1.
3. **Beat 3** — Engine bay, close macro shot of exhaust manifold glowing faint heat-shimmer,
   slow pan across metal surface, practical orange/red rim light.
4. **Beat 4** — Catalytic converter cutaway or exhaust underbody shot, camera tilts up from
   tailpipe along the exhaust line, muted industrial color grade.
5. **Beat 5** — Speedometer needle easing down from higher speed to lower speed, close macro,
   subtle motion blur on the needle only.
6. **Beat 6** — Wide shop bay establishing shot, vehicle on a lift or parked in a bay, calm even
   lighting, static-to-slow-dolly.
7. **Beat 7** — Nick's Tire & Auto branded shop-front or bay signage plate (existing brand
   asset — do not generate a new logo), gentle push-in, ends on a held frame for the 3s SAVE
   freeze the render-integrity gate requires.

### Caption timing / styling

See `captions.srt` in this directory — SRT format, one cue per beat, styled per the reel
template's default caption look (bold sans-serif, bottom-third safe area, high-contrast
white-on-black outline). No on-screen text is baked into the generated video itself (per the
standing negative prompt) — captions are composited in post only, matching the "captions and
logos are composited in post" rule.

### Editing / assembly instructions (ffmpeg/CapCut-equivalent)

1. Order clips exactly as beats 1→7 above; each beat is one distinct source clip (satisfies the
   "≥4 distinct video source clips" motion-floor requirement — 7 here).
2. Trim each clip to its beat duration from the table above (total ~31s before the freeze).
3. Cross-fade (`xfade`, ~0.2–0.3s) between beats 1↔2 and 5↔6 for the two "contrast cut" moments;
   hard cuts elsewhere for pacing.
4. Append a 3-second held freeze of the final frame (beat 7) at the end — required by the
   render-integrity gate's storyboard-duration contract (beats + 3s SAVE freeze).
5. Burn in captions per `captions.srt` timing, bottom-third safe area, one line per cue.
6. Composite the Nick's Tire & Auto brand plate/logo only on beat 7, not earlier beats.
7. Layer voiceover (TTS or human-recorded, matching the narration column word-for-word) as the
   primary audio track; add a low-level royalty-free bed under it **only if a cleared track is
   confirmed** — see § 6 below, this pack does not select one.
8. Output: MP4, H.264, 1080×1920 (9:16), ≥30fps, target ≤60s file, muted-first-safe (voiceover +
   captions both carry the message with sound off, per the quality score's "muted-first"
   dimension).

## 5. Credit-risk and fallback routing

Read from `generationLedger.ts` estimates and doc-truth (not a live policy-table read — no DB
access this session):

- `COST_ESTIMATES_USD`: `seedance_clip: $0.25` (labeled ASSUMPTION in source), `veo_second_720p:
  $0.10` (Google-published), `template_stock_clip: $0` (free local ffmpeg lane).
- Per `REEL-PIPELINE.md`, prod is currently pinned to `REEL_VIDEO_PROVIDER=template_stock`, so
  if this pack were fed into the real pipeline today, expected generation cost is **$0** against
  whatever `maxGenerationCostPerDayUsd` the live `autonomy_policy_versions` row currently sets —
  that live limit was **not read** this session (`UNKNOWN`, requires prod DB).
- `REEL_FALLBACK_TO_TEMPLATE_STOCK` is documented as prod-armed (2026-08-05) — if a paid
  provider were active and hit a `PAUSE_PROVIDER` verdict, this reel would degrade to the free
  lane rather than going dark. Not verified live this session.
- Reservation guardrails (`RESERVATION_FEED_CAP`, `RESERVATION_SPACING`, `REPEAT_CTA`,
  `REPEAT_TOPIC`) were not checked against a live `content_reservations` read — `UNKNOWN`.

## 6. Audio / music rights status

**Real gap, not papered over:** no rights ledger for background music exists in this repo. This
pack specifies voiceover as the primary audio layer and only suggests an *optional* low-level
music bed "if a cleared track is confirmed" — no specific track, asset ID, license scope,
territory, or expiry is asserted here, because none can be verified from this session. Treat any
music-rights field for this pack as `UNKNOWN`/`BLOCKED` until a human confirms a cleared track
against an actual license record.

## 7. QA matrix

Every gate below is `UNKNOWN` — no render exists, no job row exists, nothing was executed this
session. Listed per the skill's required gate table for completeness, not to imply any check ran:

| Gate | Module | Status |
|---|---|---|
| Quality score (≥70/75) | `calculateReelQualityScore` | `UNKNOWN` — not run against this pack; §2 self-scores above are a proxy, not the real 75-point rubric |
| Server re-score at enqueue | `content.enqueueReelJob` | `UNKNOWN` — no enqueue call made |
| Render-integrity gate (#800/#801) | `reelAssembly.ts` | `UNKNOWN` — no render exists |
| Rendered QA / vision critic | `renderedQa.ts` | `UNKNOWN` — no frames to score |
| Repair routing | `repairRouter.ts` | `UNKNOWN` — n/a, nothing rendered |
| 7-way decision | `qualityAutomation.ts` | `UNKNOWN` — n/a |
| Consolidated publish gate | `qualityGate.ts` | `UNKNOWN` — n/a, and would be `disabled`/`unavailable` by definition (no DB, no job) |
| Human-approval door | `instagramAdmin.publishPost` | `BLOCKED` — no asset exists to approve, and no live publish instruction was given for this scheduled run per the hard rule |

## 8. IG/FB copy + ad-ready variants

**Primary caption (organic feed):**
> Flashing check engine light or steady? They're not the same warning. 🚦 One means "ease off
> and get it checked today." The other means "worth checking soon." Not sure which one you're
> looking at? Stop by Nick's Tire & Auto and we'll take a look. 📍 Euclid Ave, Cleveland
> #CheckEngineLight #ClevelandAutoRepair #NicksTireAndAuto #CarMaintenanceTips #EuclidOhio

**Ad-ready variant A (hook/caption/CTA):**
- Hook: "Your check engine light is trying to tell you two different things."
- Caption: "A flashing light and a steady light mean different levels of urgency — know the
  difference before you keep driving."
- CTA: "Stop by and we'll take a look — no guessing required."

**Ad-ready variant B (hook/caption/CTA):**
- Hook: "Flashing vs. steady — one check engine light can wait, the other can't."
- Caption: "Most drivers treat every check engine light the same. They're not the same warning."
- CTA: "Not sure which one you have? Come by Nick's Tire & Auto and we'll check it for you."

## 9. Final status

**`READY FOR HUMAN APPROVAL`**

No render, no DB write, no publish action was made or attempted this session, consistent with
the skill's hard rule for an unattended scheduled firing. This is a complete production-ready
pack (script, per-beat prompts, captions, assembly instructions, posting copy) awaiting a human
to route it into `POST /api/admin/reel-canary {action:"start"}` or an equivalent production run,
under a live operator instruction.
