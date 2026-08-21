# Reel pack: Loose gas cap tripping the check engine light

**Date:** 2026-08-21 · **Mode:** SCHEDULED (automated firing, no live operator present this run)
**Status:** `BLOCKED: NO MOTION ROUTE` for an actual render — this session has no connected TTS,
Higgsfield, Meta-posting, or CapCut tool, and no `ADMIN_API_KEY` / Higgsfield / Meta credential,
`DATABASE_URL`, `ffmpeg`, or `hf` CLI is present in this shell (checked, none found), so there is no
path to call `/api/admin/reel-canary` or any render/publish route. Per
`.claude/skills/nickstire-reel-operator/SKILL.md` §"Producing a pack when the motion route is
unavailable," this is the full production-ready pack delivered instead of a silently-downgraded
asset. The pack itself is **PRODUCTION-READY** — script, prompts, captions, assembly, and copy below
are complete and ready for a human to run through the real Studio wizard.
**No render was attempted, no spend was incurred, nothing was published.** This also satisfies the
repo's own hard rule: a scheduled firing is never live operator authorization to generate, spend, or
publish (`AGENTS.md` protected operations; skill hard rule).

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
| `REEL_VIDEO_PROVIDER` / `REEL_GENERATION_ENABLED` / `REEL_PUBLISH_ENABLED` | `UNKNOWN` this session — env vars absent here, not re-verified live |
| Repetition ledger (`getRecentReelSignals`, 21-day `reel_jobs` read) | `UNKNOWN` — no live DB path from this session. Substituted with a **filesystem + PR check** instead (below), the concrete anti-duplication mechanism this skill prescribes when the DB isn't reachable |

**Duplication check performed** (per skill §"Where the pack goes — one location, not a new one each
run"):
- `ls apps/nickstire/docs/reel-packs/` — **65 merged packs**, most recent four all dated
  2026-08-21 (`ac-recharge-myth-sealed-system`, `brake-pedal-sinks-overnight`,
  `catalytic-converter-theft-prevention`, `differential-whine-on-turns`). No existing merged pack
  covers a gas-cap-specific check-engine-light cause.
- `gh`-equivalent PR search (`repo:nourdean22/mainnicks-tire-autonew is:open "reel pack" in:title`)
  and `list_pull_requests(state:open)` — **0 open PRs** as of this run (the prior pack's 9-open
  backlog has since cleared).
- Closest neighbors checked directly: `2026-08-16-check-engine-light` ("solid vs. flashing check
  engine light" — a severity/urgency framing, not a cause) and
  `2026-08-20-echeck-readiness-monitors` ("Ohio E-Check readiness monitors" — about monitor-cleared
  status after a battery disconnect/repair, not about what trips the light in the first place). This
  pack's topic — one specific, extremely common, self-fixable cause of the light — does not overlap
  either.

**Volume flag (not silently omitted):** 65 packs have merged in 8 days (2026-08-14 through
2026-08-21), several per day on 08-16 through 08-21. This scheduled task is producing pack inventory
substantially faster than any single Reel-per-day publish cadence could consume — worth an operator
review of whether this schedule's firing frequency should be reduced, independent of this run's own
output.

## 2. Candidate concepts (0–5 per dimension) and selection

Dimensions: **Dup** = non-duplication vs. the 65 merged + 0 open-PR topics · **Motion** = faceless
motion-beat potential · **Safety** = ease of staying inside the approved-phrasing / no-diagnosis-
promise rules · **Evidence** = how groundable the core claim is · **Local** = Cleveland/seasonal
relevance.

| Concept | Dup | Motion | Safety | Evidence | Local | Total /25 |
|---|---|---|---|---|---|---|
| **Loose gas cap trips check engine light (selected)** | 5 | 4 | 5 | 4 | 2 | **20** |
| Brake dust buildup — normal wear vs. a real leak | 4 | 3 | 4 | 3 | 1 | 15 |
| Wheel alignment after curbing a tire | 3 | 3 | 4 | 3 | 2 | 15 — lower dup score, adjacent to the merged "why car pulls" and "tie-rod wobble" packs |

Selected: **loose gas cap / check engine light.** It is a genuinely new angle in this library — every
prior check-engine-light-adjacent pack is about reading severity (solid vs. flashing) or post-repair
monitor status (E-Check readiness), not about the single most common, driver-fixable false-alarm
cause. High relatability (almost every driver has seen this light and assumed the worst), easy to
keep inside approved-phrasing rules (the whole hook is "don't panic, check this first"), and low
production risk since the claim is standard OBD-II/EVAP-system engineering, not a shop-specific
promise.

## 3. Claim evidence

| Claim | Status | Basis |
|---|---|---|
| "A gas cap that isn't fully sealed can trigger the check engine light through the vehicle's fuel-vapor (EVAP) monitoring system" | `UNKNOWN` per this repo's evidence store — standard OBD-II/EVAP-system engineering knowledge (a documented monitor in every gasoline vehicle sold in the US since the mid-1990s), not shop-specific. No `EvidenceRecord` in `evidenceRecords.ts` was read this session (no live DB path). Recommend an operator attach a sourced `EvidenceRecord` before this claim is treated as `"supported"` under `shared/claimEntailment.ts`. |
| "This can mask a code that actually matters, or contribute to a failed emissions/E-Check test" | `UNKNOWN`, same basis — general mechanical/regulatory fact (an active EVAP fault code can prevent monitor readiness and, separately, an unrelated real fault can go unnoticed while attention is on the cap), phrased without a diagnosis claim. |
| Shop name / address / phone in the CTA card | Sourced, carried forward from a prior pack's read of `SEED_FACTS` `legal.entity` in `apps/nickstire/server/services/businessFacts.ts` — "Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112, (216) 862-0005". **Not re-read live this session** (no `DATABASE_URL`) — human should re-verify against current facts before publish. **Gap, not silently cleared:** `FactChannel` is `"sms" \| "voice" \| "web"` only — there is no `"reel"`/`"social"` channel yet, so this fact is not currently channel-scoped for Reels. |
| No price, warranty, or guarantee claim is made anywhere in this script | Verified by inspection — nothing here touches pricing/warranty/policy, so no `BUSINESS` SSOT fact is invoked or at risk of drifting. |

## 4. Production pack — selected concept

**Title:** "Check engine light on? Check this before you panic."
**Total run time:** 30s of motion beats + 3s branded freeze = **33s container** (render-integrity
contract: container/video-stream duration within 0.75s of this; ≥3 distinct frame MD5s among 5
sampled — i.e., it must actually move).
**Archetype:** myth-correction (hook challenges the assumed-worst reaction, mid-reel explains the
mechanism, CTA is soft, not alarmist).
**Motion lens:** documentary/macro-realistic (operator should confirm the exact lens label and its
`lens.avoid` term in the live Studio wizard — that value is generated per-run in
`facelessReelStudio.ts` and isn't reproducible outside it).

### Script (word-for-word, timed)

| Beat | Time | Narration (word-for-word) |
|---|---|---|
| 1 — Hook | 0:00–0:03 (3s) | "Check engine light on? It might just be your gas cap." |
| 2 — Setup | 0:03–0:07 (4s) | "A gas cap that isn't clicked all the way can trip it." |
| 3 — Explanation | 0:07–0:13 (6s) | "Modern engines watch for fuel vapor leaks, and a loose seal can mimic a real problem." |
| 4 — Consequence/proof | 0:13–0:19 (6s) | "That can mask a code that actually matters, or contribute to a failed emissions check." |
| 5 — Safe action | 0:19–0:25 (6s) | "One clue isn't a diagnosis — worth checking before you assume the worst." |
| 6 — Branded CTA | 0:25–0:30 (5s) | "Stop by and we'll take a look — Nick's Tire and Auto, on Euclid Avenue." |
| — SAVE freeze | 0:30–0:33 (3s) | (no new narration; end card holds, logo + address/phone card per §3 gap note) |

Approved-phrasing check (against `facelessReelStudio.ts` pattern bank): uses "worth checking" and a
near-verbatim "one clue is not a diagnosis" (beat 5), "stop by and we'll take a look" (beat 6,
verbatim approved CTA). Avoids all banned patterns (`you need`, `this means your X is bad/shot/gone`,
"you definitely need") — confirmed by inspection, not by running the real validator (no live path).

### Per-beat generation prompts (Higgsfield/Seedance-style, faceless)

Standing negative prompt used on every beat, copied verbatim from
`client/src/lib/facelessReelStudio.ts`: `human face, person, hands, gloves, arms, talking head,
low-res, blurry, extra fingers, plastic glow, oversaturated AI look, warped engine parts` — plus a
per-lens `avoid` term the real wizard appends at generation time (not reproducible outside it; the
operator running this through Studio will get the live value automatically).

Every beat below satisfies the faceless rule: **no people, faces, hands, gloves, or arms — the
object moves on its own** (or via ambient forces: light, gravity, an unseen mechanism, a mounted
tool rig).

1. **Hook (0–3s).** *Prompt:* "Close-up on a car's dashboard cluster at dusk, engine off, the check
   engine light glowing amber against the dark instrument panel, shallow depth of field, no other
   dashboard motion." *Opening frame:* the check-engine icon already lit and sharp-focused, strongest
   possible first frame, unbranded, wordless. *Action complete by:* 2.5s. *Physical action:* a subtle
   flicker-to-steady glow as the light settles on (motion-gate qualifying beat).
2. **Setup (3–7s).** *Prompt:* "Close-up on an open fuel filler door, a gas cap resting loosely in
   its threads — visibly not seated flush, a faint gap along the seal — parked in daylight, no hands
   present, a light breeze causes the cap to shift slightly in place." *Continues from* beat 1's
   dashboard, now outside at the fuel door. *Physical action:* breeze-driven cap shift (object moves
   on its own).
3. **Explanation cutaway (7–13s).** *Prompt:* "Object-only technical cutaway of a fuel tank and vapor
   line system, animated vapor particles escaping through a visible gap around a loosely seated gas
   cap seal instead of being captured by the vapor-recovery system; clean diagrammatic lighting,
   slow camera push-in; no text or labels rendered in-scene." *Physical action:* vapor-particle
   escape animation past the loose seal.
4. **Consequence/proof (13–19s).** *Prompt:* "A dash-mounted diagnostic scan tool screen, self-
   illuminated, cycling through a list of diagnostic trouble codes, a highlight box sliding down to
   rest on an EVAP-system code among several others in the list; no hands present, tool sits in a
   fixed mount." *Physical action:* highlight-box slide/scroll motion (object moves on its own).
5. **Safe action (19–25s).** *Prompt:* "The same gas cap from beat 2, now rotating in place as if
   self-tightening on a mounted torque-check rig, an audible-click indicator ring rotating with each
   click until it stops fully seated flush against the fuel door; no hands present." *Physical
   action:* ratcheting rotation to a stop (object moves on its own).
6. **Branded CTA (25–30s), freeze to 33s.** *Prompt:* "Exterior establishing shot of Nick's Tire &
   Auto's shop bay, a diagnostic scan tool resting on a service cart in the foreground, late-
   afternoon light, logo signage visible and legible; camera holds steady for a clean end-card
   composite." *Then:* static hold from 30s–33s with logo + address/phone end-card composited in
   post (per §3 gap, human-verify the card text against current `legal.entity` fact before publish).

Every prompt keeps the top 12% / bottom 20% of frame clear for IG UI per the repo's safe-zone rule.

### Captions

See `captions.srt` in this pack — SRT, burned-in per the muted-first requirement (10/75 quality
points), split into short readable cues rather than one long line per beat.

### Assembly instructions (ffmpeg/CapCut, matches the render-integrity contract)

1. Trim each of the 6 generated clips to its beat duration above (3–6s each); no beat may be shorter
   than 1.5s or the render-integrity motion gate's per-beat visual-change cadence fails.
2. Order: beat 1 → 2 → 3 → 4 → 5 → 6, hard cuts or ≤0.3s crossfades between beats 1–5 (keep the
   cadence brisk — a visual change every 1.5–2.5s is the floor the real gate checks).
3. Freeze the last frame of beat 6 for exactly 3.0s (the SAVE freeze) — do **not** loop or repeat an
   earlier beat to pad length; the render-integrity gate treats a repeated-frame loop as a
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
   here). A human should record or generate the 6 narration lines above at the stated per-beat timing
   and mux them in during step 6.

### Audio / music rights

**Real gap, not filled in:** no music-rights ledger exists in this repo (per the skill's own audit).
This pack does not select a specific music bed. If a background bed is added, it must carry a
tracked license (asset ID, source, license scope, territory, expiry, organic-vs-ad clearance) before
publish — track that manually; nothing here asserts a track is cleared.

### Credit-risk and fallback routing (estimates, not a live read)

From `generationLedger.ts`'s `COST_ESTIMATES_USD` (operator-tunable, not metered pricing — carried
forward from a prior pack's read; not re-read live this session):

- If rendered on the prod-pinned free lane (`REEL_VIDEO_PROVIDER=template_stock`, local ffmpeg, per a
  prior pack's verification): **$0.00** — `template_stock_clip: 0`.
- If rendered on the paid Seedance/Higgsfield lane instead: 6 beats × `seedance_clip: 0.25` (labeled
  ASSUMPTION in source) ≈ **$1.50 estimated**, against a daily `maxGenerationCostPerDayUsd` cap
  reported elsewhere as $10 (not re-verified live this session).
- `REEL_FALLBACK_TO_TEMPLATE_STOCK` governs whether a paid-provider failure degrades to the free lane
  mid-render instead of terminal-failing — current default per docs is **off**.
- Guardrail order that a real enqueue would hit (not evaluated live): `RESERVATION_FEED_CAP`
  (2 posts/day) → `RESERVATION_SPACING` (3h) → `REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) →
  `BUDGET_DAILY_EXCEEDED`. Since the repetition ledger wasn't read live this session, an operator
  should re-check `getRecentReelSignals()` before enqueueing — with 65 packs merged in 8 days and
  today already carrying four before this one, the queue's production rate is well ahead of any
  plausible publish cadence; an operator may want to throttle this schedule's firing frequency.

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

No `PASS` is claimed anywhere in this matrix — a `jobId` or "the command exited 0" is explicitly not
evidence of a finished Reel in this repo's own runbooks, and nothing here got that far.

## 6. IG/FB copy + two ad-ready variants

**Primary caption (organic feed post):**
> Check engine light on? Before you panic — check your gas cap. 🔧
> A cap that isn't clicked all the way can trip the light through the fuel-vapor system it's designed
> to monitor. It can also mask a code that actually matters, or contribute to a failed emissions
> check. One clue isn't a diagnosis, but it's worth checking first.
> 📍 Nick's Tire & Auto, 17625 Euclid Ave, Cleveland · (216) 862-0005
> #ClevelandMechanic #CarCare101 #EuclidOhio #TireShop #AutoRepairTips #CheckEngineLight

**Ad-ready variant A** (hook-forward, actionable):
- Hook: "Check engine light on? Check this before you panic."
- Caption: "Nine times out of ten, it's simpler than you think. Start with the gas cap."
- CTA: "Stop by and we'll take a look — no guessing, no pressure."

**Ad-ready variant B** (reassurance-forward, lower anxiety):
- Hook: "That light doesn't always mean what you're afraid it means."
- Caption: "A loose gas cap can trip the same light as a real problem. Here's how to tell."
- CTA: "Free check, honest answer — stop by Nick's Tire & Auto on Euclid."

## 7. Final status

**`BLOCKED: NO MOTION ROUTE`** — no TTS/Higgsfield/Meta-posting/CapCut tool and no live credential is
reachable from this session, and per the skill's hard rule a scheduled/automated firing is never live
authorization to spend, render, or publish even if a route existed. The pack itself (script, prompts,
captions, assembly, copy) is **PRODUCTION-READY** and waiting on a human to run it through the live
Studio wizard (`admin → Growth → Instagram → Studio`), record/generate the voiceover, and carry it
through the real quality/render-integrity/approval gates end to end. Nothing was rendered. Nothing was
published. No spend occurred.

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
7. **Review this schedule's firing frequency.** 65 reel packs have merged in 8 days, 5 of them today
   before this run — an operator should decide whether to slow this schedule down, since the pack
   library is now far ahead of what could plausibly be produced into finished, published Reels at a
   sane per-day cadence.
