# Reel pack: Brake pedal sinks overnight (master-cylinder bypass test)

**Date:** 2026-08-21 · **Mode:** SCHEDULED (automated firing, no live operator present this run)
**Status:** `BLOCKED: NO MOTION ROUTE` for an actual render — this session has no connected
TTS, Higgsfield, Meta-posting, or CapCut tool, and no `ADMIN_API_KEY` / Higgsfield / Meta
credential, `DATABASE_URL`, `ffmpeg`, or `hf` CLI is present in this shell (checked, none found),
so there is no path to call `/api/admin/reel-canary` or any render/publish route. Per
`.claude/skills/nickstire-reel-operator/SKILL.md` §"Producing a pack when the motion route is
unavailable," this is the full production-ready pack delivered instead of a silently-downgraded
asset. The pack itself is **PRODUCTION-READY** — script, prompts, captions, assembly, and copy
below are complete and ready for a human to run through the real Studio wizard.
**No render was attempted, no spend was incurred, nothing was published.** This also satisfies
the repo's own hard rule: a scheduled firing is never live operator authorization to generate,
spend, or publish (`AGENTS.md` protected operations; skill hard rule).

## 1. Capability preflight (real reads, this session)

| Check | Result |
|---|---|
| TTS tool connected to this session | Not connected |
| Higgsfield MCP / API connected to this session | Not connected |
| Meta posting tool connected to this session | Not connected |
| CapCut / editing tool connected to this session | Not connected |
| Shell/render (Bash) | Available, but `ffmpeg` is not installed and no video assets exist here |
| `ADMIN_API_KEY` / `HIGGSFIELD_*` / `META_PAGE_*` in this shell's env | **Absent** (checked, no matches) — confirms no live path to `/api/admin/reel-canary` |
| `DATABASE_URL` in this shell's env | **Absent** — confirms no live DB path (repetition ledger, `businessFacts`, `evidenceRecords` all unreachable live) |
| `getHiggsfieldAccountHealth()` live read | Not performed — no path to call it from this session |
| `REEL_VIDEO_PROVIDER` (prod pin, per `docs/operations/REEL-PIPELINE.md`, last verified 2026-08-11 by a prior pack) | `UNKNOWN` this session — env var absent here; treat as `template_stock` only as an unverified carry-forward, re-check before assuming |
| `REEL_GENERATION_ENABLED` / `REEL_PUBLISH_ENABLED` live value | `UNKNOWN` — not read this session (no live path) |
| Repetition ledger (`getRecentReelSignals`, 21-day `reel_jobs` read) | `UNKNOWN` — no live DB path from this session. Substituted with a **filesystem + PR check** instead (below), the concrete anti-duplication mechanism this skill actually prescribes when the DB isn't reachable. |

**Duplication check performed** (per skill §"Where the pack goes — one location, not a new one
each run"):
- `ls apps/nickstire/docs/reel-packs/` — 51 merged packs, most recent
  `2026-08-20-tailpipe-condensation-vs-coolant-leak`. No existing merged pack on a static
  parked-car brake-pedal test or master-cylinder internal bypass.
- `gh`-equivalent PR search (`repo:nourdean22/mainnicks-tire-autonew is:open "reel pack" in:title`)
  — 9 open draft PRs: #1738 (wheel wobble / tie rod vs. bearing), #1739 (musty AC smell), #1741
  (lug-nut re-torque), #1742 (one new tire on AWD), #1744 (sticking brake caliper, one wheel hot),
  #1745 (tire losing air / soapy-water leak test), #1746 (reading a tire sidewall), #1748 (radiator
  fan not spinning at idle), #1749 (tire valve stem dry rot). None duplicate this topic. #1744
  (sticking caliper) and the merged `spongy-brake-pedal` / `brake-fluid-moisture-test` packs are
  the closest neighbors — all three are about braking, but each covers a distinct, non-overlapping
  failure mode and test (a hot wheel from a dragging caliper; pedal sponginess from air/moisture in
  the lines while driving; boiling-point fluid testing) versus this pack's static, engine-off,
  overnight pedal-travel test for an *internal* master-cylinder bypass — a different mechanism, a
  different test, and a different "do this before you drive" framing.

## 2. Candidate concepts (0–5 per dimension) and selection

Dimensions: **Dup** = non-duplication vs. the 51 merged + 9 open-PR topics · **Motion** =
faceless motion-beat potential · **Safety** = ease of staying inside the approved-phrasing /
no-diagnosis-promise rules · **Evidence** = how groundable the core claim is · **Local** =
Cleveland/seasonal relevance.

| Concept | Dup | Motion | Safety | Evidence | Local | Total /25 |
|---|---|---|---|---|---|---|
| **Brake pedal sinks overnight — master-cylinder bypass test (selected)** | 5 | 4 | 5 | 4 | 2 | **20** |
| Differential whine on turns (drivetrain) | 5 | 3 | 4 | 3 | 1 | 16 |
| Power window motor slowing down | 4 | 3 | 4 | 2 | 1 | 14 — lower safety/urgency value, deprioritized |

Selected: **brake pedal sinks overnight.** It's a genuinely new failure mode and test method in
this library — a static, parked, engine-off check anyone can run themselves before ever starting
the car, which is a distinct hook from every other brake-content pack (all of which are about
symptoms *while driving*). It's high safety relevance (a bypassing master cylinder can fail
without warning) and easy to keep inside the approved-phrasing rules since the whole point of the
script is "do this simple check, don't self-diagnose."

## 3. Claim evidence

| Claim | Status | Basis |
|---|---|---|
| "A brake pedal that slowly sinks toward the floor when held with the engine off can point to fluid bypassing worn seals inside the master cylinder" | `UNKNOWN` per this repo's evidence store — standard automotive-engineering/service knowledge (a classic parked-car brake test taught in basic auto-repair references), not shop-specific. No `EvidenceRecord` in `evidenceRecords.ts` was read this session (no live DB path). Recommend an operator attach a sourced `EvidenceRecord` before this claim is treated as `"supported"` under `shared/claimEntailment.ts`. |
| "This kind of leak can happen without a visible puddle on the ground" | `UNKNOWN`, same basis — describes an internal bypass past the master cylinder's piston seals versus an external hydraulic-line leak; general mechanical fact, phrased without a diagnosis claim. |
| Shop name / address / phone in the CTA card | Sourced, carried forward from the prior pack's read of `SEED_FACTS` `legal.entity` in `apps/nickstire/server/services/businessFacts.ts` — "Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112, (216) 862-0005". **Not re-read live this session** (no `DATABASE_URL`) — human should re-verify against current facts before publish. **Gap, not silently cleared:** `FactChannel` is `"sms" \| "voice" \| "web"` only — there is no `"reel"`/`"social"` channel yet, so this fact is not currently channel-scoped for Reels. |
| No price, warranty, or guarantee claim is made anywhere in this script | Verified by inspection — nothing here touches pricing/warranty/policy, so no `BUSINESS` SSOT fact is invoked or at risk of drifting. |

## 4. Production pack — selected concept

**Title:** "Try this 30-second brake test before you drive tomorrow"
**Total run time:** 30s of motion beats + 3s branded freeze = **33s container** (render-integrity
contract: container/video-stream duration within 0.75s of this; ≥3 distinct frame MD5s among 5
sampled — i.e., it must actually move).
**Archetype:** actionable-test-then-explanation (hook is a concrete thing to try tonight, mid-reel
explains the mechanism, CTA is soft, not alarmist).
**Motion lens:** documentary/macro-realistic (operator should confirm the exact lens label and its
`lens.avoid` term in the live Studio wizard — that value is generated per-run in
`facelessReelStudio.ts` and isn't reproducible outside it).

### Script (word-for-word, timed)

| Beat | Time | Narration (word-for-word) |
|---|---|---|
| 1 — Hook | 0:00–0:03 (3s) | "Before you start your car tomorrow morning — try this 30-second test." |
| 2 — Setup | 0:03–0:07 (4s) | "With the engine off, press the brake pedal firmly and hold it." |
| 3 — Explanation | 0:07–0:13 (6s) | "A pedal that slowly sinks toward the floor can point to fluid bypassing worn seals inside the master cylinder." |
| 4 — Consequence/proof | 0:13–0:19 (6s) | "That's an internal leak — no puddle on the ground, but less stopping power when you need it most." |
| 5 — Safe action | 0:19–0:25 (6s) | "One clue is not a diagnosis — worth checking before you're back on the road." |
| 6 — Branded CTA | 0:25–0:30 (5s) | "Stop by and we'll take a look — Nick's Tire and Auto, on Euclid Avenue." |
| — SAVE freeze | 0:30–0:33 (3s) | (no new narration; end card holds, logo + address/phone card per §3 gap note) |

Approved-phrasing check (against `facelessReelStudio.ts` pattern bank): uses "can point to" (beat
3), "worth checking" and "one clue" (beat 5), "stop by and we'll take a look" (beat 6, verbatim
approved CTA). Avoids all banned patterns (`you need`, `this means your X is bad/shot/gone`, "you
definitely need") — confirmed by inspection, not by running the real validator (no live path).

### Per-beat generation prompts (Higgsfield/Seedance-style, faceless)

Standing negative prompt used on every beat, copied verbatim from
`client/src/lib/facelessReelStudio.ts`: `human face, person, hands, gloves, arms, talking head,
low-res, blurry, extra fingers, plastic glow, oversaturated AI look, warped engine parts` — plus a
per-lens `avoid` term the real wizard appends at generation time (not reproducible outside it; the
operator running this through Studio will get the live value automatically).

Every beat below satisfies the faceless rule: **no people, faces, hands, gloves, or arms — the
object moves on its own** (or via ambient forces: a mechanical tool, light, gravity, an unseen
mechanism). The pedal-press action specifically uses a real diagnostic tool (a spring-loaded brake
pedal depressor) rather than a hand, so the "press and hold" action stays faceless.

1. **Hook (0–3s).** *Prompt:* "Close-up inside a parked car at dawn, dim interior light through
   the windshield, engine off; a spring-loaded brake pedal depressor tool — a metal rod braced
   between the seat and the pedal, no hands present — locks the brake pedal down firmly against
   the floor mat." *Opening frame:* the depressor tool mid-extension, pedal already held down,
   strongest possible first frame, unbranded, wordless. *Action complete by:* 2.5s. *Physical
   action:* tool arm extending and locking (motion-gate qualifying beat).
2. **Setup/hold (3–7s).** *Prompt:* "Close-up on a wristwatch resting on the dashboard, second
   hand sweeping steadily, soft focus on the held brake pedal and depressor tool visible in the
   background, marking time passing while the pedal stays locked down." *Continues from beat 1's
   held pedal.* *Physical action:* watch second-hand sweep (object moves on its own).
3. **Explanation cutaway (7–13s).** *Prompt:* "Object-only technical cutaway of a brake master
   cylinder's interior cross-section, animated hydraulic fluid particles slipping past a visibly
   worn piston seal and bypassing internally instead of building pressure; clean diagrammatic
   lighting, slow camera push-in; no text or labels rendered in-scene." *Physical action:*
   fluid-bypass particle animation past the worn seal.
4. **Consequence/proof (13–19s).** *Prompt:* "Return to the held brake pedal and depressor tool
   from beat 1, now visibly lower against the floor mat than its starting position, a faint
   measuring tape or ruler mounted beside the pedal shows the travel distance increasing; contrast
   against beat 1's higher starting position, no puddle or fluid visible anywhere on the floor."
   *Physical action:* pedal continuing its slow downward travel (visual contrast against the
   earlier locked-high position).
5. **Safe action (19–25s).** *Prompt:* "A shop inspection light on a stand sweeps its beam across
   a brake master cylinder reservoir cap under the hood, fluid level line clearly visible through
   the translucent housing against min/max markings — no hands present, the light beam itself is
   the only motion besides a slow rack-focus." *Physical action:* light-beam sweep + rack-focus
   (object moves on its own).
6. **Branded CTA (25–30s), freeze to 33s.** *Prompt:* "Exterior establishing shot of Nick's Tire &
   Auto's shop bay, brake rotor and caliper parts neatly arranged on a service cart in the
   foreground, late-afternoon light, logo signage visible and legible; camera holds steady for a
   clean end-card composite." *Then:* static hold from 30s–33s with logo + address/phone end-card
   composited in post (per §3 gap, human-verify the card text against current `legal.entity` fact
   before publish).

Every prompt keeps the top 12% / bottom 20% of frame clear for IG UI per the repo's safe-zone rule.

### Captions

See `captions.srt` in this pack — SRT, burned-in per the muted-first requirement (10/75 quality
points), split into short readable cues rather than one long line per beat.

### Assembly instructions (ffmpeg/CapCut, matches the render-integrity contract)

1. Trim each of the 6 generated clips to its beat duration above (3–6s each); no beat may be
   shorter than 1.5s or the render-integrity motion gate's per-beat visual-change cadence fails.
2. Order: beat 1 → 2 → 3 → 4 → 5 → 6, hard cuts or ≤0.3s crossfades between beats 1–5 (keep the
   cadence brisk — a visual change every 1.5–2.5s is the floor the real gate checks).
3. Freeze the last frame of beat 6 for exactly 3.0s (the SAVE freeze) — do **not** loop or repeat
   an earlier beat to pad length; the render-integrity gate treats a repeated-frame loop as a
   motion-floor violation, not a valid freeze.
4. Burn in captions per `captions.srt`, bottom-safe-zone, high-contrast caption style (white text,
   dark outline/box) — reel plays muted-first, captions are not optional.
5. Composite the logo + address/phone end-card onto the frozen final 3s only, not earlier — keep
   branding off the motion beats per the faceless/no-logo-in-scene generation rule.
6. Export: MP4, H.264, 1080×1920 (9:16), ≥30fps, target ≥80% of expected 30fps frame count over the
   33s runtime (render-integrity floor), audio track (voiceover) muxed in, container duration and
   video-stream duration both within 0.75s of 33.0s.
7. Voiceover: warm, plain, unhurried delivery — no TTS engine is connected this session, so this
   step is **manual** (`nickstire`'s live pipeline uses its own TTS route in `reelVoice.ts`, not run
   here). A human should record or generate the 6 narration lines above at the stated per-beat
   timing and mux them in during step 6.

### Audio / music rights

**Real gap, not filled in:** no music-rights ledger exists in this repo (per the skill's own audit).
This pack does not select a specific music bed. If a background bed is added, it must carry a
tracked license (asset ID, source, license scope, territory, expiry, organic-vs-ad clearance) before
publish — track that manually; nothing here asserts a track is cleared.

### Credit-risk and fallback routing (estimates, not a live read)

From `generationLedger.ts`'s `COST_ESTIMATES_USD` (operator-tunable, not metered pricing — carried
forward from a prior pack's read; not re-read live this session):

- If rendered on the prod-pinned free lane (`REEL_VIDEO_PROVIDER=template_stock`, local ffmpeg,
  per the most recent prior pack's verification): **$0.00** — `template_stock_clip: 0`.
- If rendered on the paid Seedance/Higgsfield lane instead: 6 beats × `seedance_clip: 0.25`
  (labeled ASSUMPTION in source) ≈ **$1.50 estimated**, against a daily
  `maxGenerationCostPerDayUsd` cap reported elsewhere as $10 (not re-verified live this session).
- `REEL_FALLBACK_TO_TEMPLATE_STOCK` governs whether a paid-provider failure degrades to the free
  lane mid-render instead of terminal-failing — current default per docs is **off**.
- Guardrail order that a real enqueue would hit (not evaluated live): `RESERVATION_FEED_CAP`
  (2 posts/day) → `RESERVATION_SPACING` (3h) → `REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) →
  `BUDGET_DAILY_EXCEEDED`. Since the repetition ledger wasn't read live this session, an operator
  should re-check `getRecentReelSignals()` before enqueueing, in case another job posted today —
  9 open reel-pack PRs from the last two days suggest this queue is running well ahead of what's
  actually being merged/published; an operator may want to review the backlog before enqueueing
  more topics.

## 5. QA matrix

| Gate | Result | Basis |
|---|---|---|
| Brief-time quality score (`calculateReelQualityScore`, min 70/75) | `UNKNOWN` | Not run — no live path to the scorer this session; script self-checked against the approved-phrasing/faceless rules by inspection only, not the real validator |
| Server re-score at enqueue | `UNKNOWN` | No enqueue attempted |
| Render-integrity gate (#800/#801: duration match, frame count, ≥3 distinct MD5s) | `BLOCKED` | No render attempted — nothing exists to check |
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED` | No render attempted |
| Consolidated publish gate (`evaluateReelPublishGate`) | `BLOCKED` | No job exists to evaluate |
| Human approval / hash-checked approval integrity | `BLOCKED` | Nothing to approve yet — this pack is the input to that step, not past it |
| Evidence entailment (`shared/claimEntailment.ts`) on the two automotive claims | `UNKNOWN` | See §3 — general knowledge, not read against `evidenceRecords.ts` live |

No `PASS` is claimed anywhere in this matrix — a `jobId` or "the command exited 0" is explicitly
not evidence of a finished Reel in this repo's own runbooks, and nothing here got that far.

## 6. IG/FB copy + two ad-ready variants

**Primary caption (organic feed post):**
> Try this before you drive tomorrow: engine off, press the brake pedal, hold it. 🛑
> If it slowly sinks toward the floor, that can point to an internal leak in the master cylinder —
> no puddle on the ground, just less stopping power. One clue isn't a diagnosis, but it's worth 30
> seconds tonight.
> 📍 Nick's Tire & Auto, 17625 Euclid Ave, Cleveland · (216) 862-0005
> #ClevelandMechanic #CarCare101 #EuclidOhio #TireShop #AutoRepairTips #BrakeSafety

**Ad-ready variant A** (hook-forward, actionable):
- Hook: "Try this 30-second brake test before you drive tomorrow."
- Caption: "Engine off, pedal held down. Does it sink? Here's what that can mean."
- CTA: "Stop by and we'll take a look — no guessing, no pressure."

**Ad-ready variant B** (reassurance-forward, lower anxiety):
- Hook: "Your brake pedal can tell you something — if you know how to ask."
- Caption: "A simple parked-car test catches a leak you'd never see on the ground."
- CTA: "Free check, honest answer — stop by Nick's Tire & Auto on Euclid."

## 7. Final status

**`BLOCKED: NO MOTION ROUTE`** — no TTS/Higgsfield/Meta-posting/CapCut tool and no live
credential is reachable from this session, and per the skill's hard rule a scheduled/automated
firing is never live authorization to spend, render, or publish even if a route existed. The pack
itself (script, prompts, captions, assembly, copy) is **PRODUCTION-READY** and waiting on a human
to run it through the live Studio wizard (`admin → Growth → Instagram → Studio`), record/generate
the voiceover, and carry it through the real quality/render-integrity/approval gates end to end.
Nothing was rendered. Nothing was published. No spend occurred.

**Still requires manual work:**
1. Record or TTS-generate the 6 voiceover lines at the stated timings.
2. Run the brief through the real Studio wizard to get a live quality score and repetition-ledger
   check (this pack's checks were done by filesystem/PR search, not the live DB).
3. Generate the 6 motion clips (Higgsfield/Seedance or the prod-pinned `template_stock` lane) and
   assemble per §4's ffmpeg/CapCut instructions.
4. Select and clear a music bed if one is wanted (real rights gap — see §4).
5. Human-verify the end-card address/phone text against current `legal.entity` fact before publish.
6. Run it through the real render-integrity gate, rendered QA, and human-approval door before any
   publish action — publish only ever on an explicit, live, in-the-moment operator instruction.
7. Consider reviewing the open reel-pack PR backlog (9 open as of this run) — several scheduled
   firings a day are producing packs faster than they're being merged or acted on.
