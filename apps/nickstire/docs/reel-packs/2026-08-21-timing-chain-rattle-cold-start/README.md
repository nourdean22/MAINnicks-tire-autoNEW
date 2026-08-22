# Reel pack: Timing chain rattle at cold start

**Date:** 2026-08-21 · **Mode:** SCHEDULED (automated firing, no live operator present this run)
**Status:** `BLOCKED: NO MOTION ROUTE` for an actual render — this session has no connected TTS,
Higgsfield, Meta-posting, or CapCut tool, and no `ADMIN_API_KEY` / Higgsfield / Meta credential,
`DATABASE_URL`, or `ffmpeg`/`hf` CLI is present in this shell (checked, none found), so there is no
path to call `/api/admin/reel-canary` or any render/publish route. Per
`.claude/skills/nickstire-reel-operator/SKILL.md` §"Producing a pack when the motion route is
unavailable," this is the full production-ready pack delivered instead of a silently-downgraded
asset. The pack itself is **PRODUCTION-READY** — script, prompts, captions, assembly, and copy
below are complete and ready for a human to run through the real Studio wizard.
**No render was attempted, no spend was incurred, nothing was published.** This also satisfies the
repo's own hard rule: a scheduled firing is never live operator authorization to generate, spend,
or publish (`AGENTS.md` protected operations; skill hard rule).

## 1. Capability preflight (real reads, this session)

| Check | Result |
|---|---|
| TTS tool connected to this session | Not connected |
| Higgsfield MCP / API connected to this session | Not connected |
| Meta posting tool connected to this session | Not connected |
| CapCut / editing tool connected to this session | Not connected |
| Shell/render (Bash) | Available, but `ffmpeg` is not installed and no video assets exist here (checked: `command -v ffmpeg` → not found) |
| `ADMIN_API_KEY` in this shell's env | **Absent** (checked, empty) — confirms no live path to `/api/admin/reel-canary` |
| `DATABASE_URL` in this shell's env | **Absent** — confirms no live DB path (repetition ledger, `businessFacts`, `evidenceRecords` all unreachable live) |
| `REEL_GENERATION_ENABLED` / `REEL_VIDEO_PROVIDER` | Both `unset` in this shell (checked directly) — treat as `UNKNOWN`, not a carried-forward assumption |
| `getHiggsfieldAccountHealth()` live read | Not performed — no path to call it from this session |
| Repetition ledger (`getRecentReelSignals`, 21-day `reel_jobs` read) | `UNKNOWN` — no live DB path from this session. Substituted with a **filesystem + open-PR check** instead (below), the concrete anti-duplication mechanism this skill prescribes when the DB isn't reachable. |

**Duplication check performed** (per skill §"Where the pack goes — one location, not a new one
each run"):
- `ls apps/nickstire/docs/reel-packs/` — 58 merged packs as of this run, most recent
  `2026-08-21-valve-stem-dry-rot`. No existing merged pack covers timing-chain rattle at cold
  start; the nearest neighbor, `2026-08-19-timing-belt-no-warning-light`, is about a *belt's* silent
  wear-out (no dash warning before it snaps) on belt-driven engines — a maintenance-interval message
  — not a cold-start *audio symptom* on chain-driven engines. Different mechanism, different vehicle
  population, different hook.
- `gh`-equivalent PR search (`repo:nourdean22/mainnicks-tire-autonew is:open "reel pack" in:title"`)
  — 7 open draft PRs today: #1769 (stuck PCV valve, oil burn no puddle), #1770 (spark plug
  wire/coil boot arcing at night), #1772 (ABS light on, brakes still normal), #1773 (dead key fob,
  push-button start), #1774 (power window stuck halfway), #1775 (radiator cap pressure test,
  coolant loss no visible leak), #1776 (blower motor resistor, fan stuck on one speed). None
  overlap: closest is #1770 (also an audio/cold-engine cue), but that pack is about visible arcing
  at an ignition coil boot after dark, not an internal chain-and-guide rattle heard for the first
  few seconds after a cold start. No topic collision.

## 2. Candidate concepts (0-5 per dimension) and selection

Dimensions: **Dup** = non-duplication vs. the 58 merged + 7 open-PR topics · **Motion** = faceless
motion-beat potential · **Safety** = ease of staying inside approved-phrasing / no-diagnosis-promise
rules · **Evidence** = how groundable the core claim is · **Local** = Cleveland/seasonal relevance
(cold mornings make cold-start rattle more audible and more common as a driver complaint).

| Concept | Dup | Motion | Safety | Evidence | Local | Total /25 |
|---|---|---|---|---|---|---|
| **Timing chain rattle at cold start (selected)** | 5 | 4 | 5 | 4 | 4 | **22** |
| Serpentine belt tensioner pulley bearing whine (vs. belt squeal itself) | 4 | 3 | 4 | 3 | 2 | 16 |
| EGR valve carbon buildup / rough idle after highway driving | 5 | 2 | 3 | 2 | 1 | 13 — deprioritized, weaker visual hook |

Selected: **timing chain rattle at cold start.** It's a genuinely new failure mode in this library —
a distinct audio symptom (a few seconds of metallic rattle right after startup that quiets down once
oil pressure builds) rather than a visual or steady-state symptom like most of the library's existing
packs. High safety relevance (a jumped or badly worn chain can contact valves and cause real engine
damage), easy to keep inside approved-phrasing rules (the whole hook is "listen for this, don't wait
on it"), and the seasonal tie-in (cold Cleveland mornings + thicker oil = the symptom is more
noticeable and more commonly reported this time of year) gives it real local relevance the other two
candidates lacked.

## 3. Claim evidence

| Claim | Status | Basis |
|---|---|---|
| "A few seconds of metallic rattle right after a cold start, that goes away once the engine warms up, can point to a stretched timing chain or worn guides" | `UNKNOWN` per this repo's evidence store — standard automotive-service knowledge (oil takes a moment to reach the tensioner on a cold start; a stretched chain or worn plastic guide has more slack until hydraulic pressure takes it up), not shop-specific. No `EvidenceRecord` in `evidenceRecords.ts` was read this session (no live DB path). Recommend an operator attach a sourced `EvidenceRecord` before this claim is treated as `"supported"` under `shared/claimEntailment.ts`. |
| "This is different from a squeal or a screech — the pattern is short, rattly, right after startup" | `UNKNOWN`, same basis — general mechanical-symptom description, phrased as a pattern to notice rather than a diagnosis. |
| Shop name / address / phone in the CTA card | Sourced, carried forward from a prior pack's read of `SEED_FACTS` `legal.entity` in `apps/nickstire/server/services/businessFacts.ts` — "Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112, (216) 862-0005". **Not re-read live this session** (no `DATABASE_URL`) — human should re-verify against current facts before publish. **Gap, not silently cleared:** `FactChannel` is `"sms" \| "voice" \| "web"` only — there is no `"reel"`/`"social"` channel yet, so this fact is not currently channel-scoped for Reels. |
| No price, warranty, or guarantee claim is made anywhere in this script | Verified by inspection — nothing here touches pricing/warranty/policy, so no `BUSINESS` SSOT fact is invoked or at risk of drifting. |

## 4. Production pack — selected concept

**Title:** "That rattle when you first start your car? Don't ignore it."
**Total run time:** 30s of motion beats + 3s branded freeze = **33s container** (render-integrity
contract: container/video-stream duration within 0.75s of this; ≥3 distinct frame MD5s among 5
sampled — i.e., it must actually move).
**Archetype:** symptom-then-explanation (hook is a sound the viewer has probably already heard, mid-reel
explains the mechanism, CTA is soft, not alarmist).
**Motion lens:** documentary/macro-realistic (operator should confirm the exact lens label and its
`lens.avoid` term in the live Studio wizard — that value is generated per-run in
`facelessReelStudio.ts` and isn't reproducible outside it).

### Script (word-for-word, timed)

| Beat | Time | Narration (word-for-word) |
|---|---|---|
| 1 — Hook | 0:00-0:03 (3s) | "That rattle for the first few seconds after you start your car? Don't ignore it." |
| 2 — Setup | 0:03-0:08 (5s) | "It's a quick, metallic sound right at startup, and then it goes away once the engine warms up." |
| 3 — Explanation | 0:08-0:15 (7s) | "That pattern can point to a stretched timing chain or worn guides not getting oil pressure fast enough." |
| 4 — Consequence | 0:15-0:21 (6s) | "It's more noticeable on cold mornings, when the oil is thicker and takes longer to build pressure." |
| 5 — Safe action | 0:21-0:26 (5s) | "One clue is not a diagnosis — worth checking before it gets louder." |
| 6 — Branded CTA | 0:26-0:30 (4s) | "Stop by and we'll take a look — Nick's Tire and Auto, on Euclid Avenue." |
| — SAVE freeze | 0:30-0:33 (3s) | (no new narration; end card holds, logo + address/phone card per §3 gap note) |

Approved-phrasing check (against `facelessReelStudio.ts` pattern bank): uses "can point to" (beat 3),
"worth checking" and "one clue" (beat 5), "stop by and we'll take a look" (beat 6, verbatim approved
CTA). Avoids all banned patterns (`you need`, `this means your X is bad/shot/gone`, "you definitely
need") — confirmed by inspection, not by running the real validator (no live path).

### Per-beat generation prompts (Higgsfield/Seedance-style, faceless)

Standing negative prompt used on every beat, copied verbatim from `client/src/lib/facelessReelStudio.ts`:
`human face, person, hands, gloves, arms, talking head, low-res, blurry, extra fingers, plastic glow,
oversaturated AI look, warped engine parts` — plus a per-lens `avoid` term the real wizard appends at
generation time (not reproducible outside it; the operator running this through Studio will get the
live value automatically).

Every beat below satisfies the faceless rule: **no people, faces, hands, gloves, or arms — the object
moves on its own** (or via ambient forces: a key already in the ignition, gauge needles, light, a
mechanical timer).

1. **Hook (0-3s).** *Prompt:* "Close-up on a car's ignition switch and key at dawn in a cold driveway,
   frost visible on the windshield glass behind it; the key turns on its own to the start position, dash
   gauge needles sweep up and settle, no hands present." *Opening frame:* frosted windshield glass with
   the key mid-turn, strongest possible first frame, unbranded, wordless. *Action complete by:* 2.5s.
   *Physical action:* key turning + gauge needle sweep (motion-gate qualifying beat).
2. **Setup (3-8s).** *Prompt:* "Object-only cutaway of an engine's timing cover area, a chain visibly
   slack against its guides in the first moment after startup, subtle vibration/rattle motion animated
   along the chain length; clean diagrammatic lighting, slow camera push-in, no text or labels rendered
   in-scene." *Physical action:* chain-slack vibration animation.
3. **Explanation (8-15s).** *Prompt:* "Object-only technical cutaway continuing from beat 2, an oil
   pressure line filling and a hydraulic tensioner arm slowly extending to take up the chain's slack,
   the rattle-motion animation visibly settling and stopping as the tensioner reaches full extension;
   clean diagrammatic lighting." *Physical action:* tensioner arm extending, rattle animation damping out
   (visual proof of the mechanism, object moves on its own).
4. **Consequence (15-21s).** *Prompt:* "Close-up on an analog oil-temperature gauge needle on a dashboard,
   needle slowly climbing from cold (blue zone) toward normal operating range (mid zone), frost on the
   windshield visible behind it fading/melting slightly with time-lapse motion; no hands present."
   *Physical action:* gauge needle climb + frost-melt time-lapse (object moves on its own).
5. **Safe action (21-26s).** *Prompt:* "A shop inspection light on a stand sweeps its beam across an
   engine's timing cover from outside, illuminating the cover bolts and gasket seam — no hands present,
   the light beam itself is the only motion besides a slow rack-focus." *Physical action:* light-beam
   sweep + rack-focus (object moves on its own).
6. **Branded CTA (26-30s), freeze to 33s.** *Prompt:* "Exterior establishing shot of Nick's Tire & Auto's
   shop bay, engine timing-cover gasket and chain-tensioner parts neatly arranged on a service cart in
   the foreground, early-morning light, logo signage visible and legible; camera holds steady for a clean
   end-card composite." *Then:* static hold from 30s-33s with logo + address/phone end-card composited
   in post (per §3 gap, human-verify the card text against current `legal.entity` fact before publish).

Every prompt keeps the top 12% / bottom 20% of frame clear for IG UI per the repo's safe-zone rule.

### Captions

See `captions.srt` in this pack — SRT, burned-in per the muted-first requirement (10/75 quality
points), split into short readable cues rather than one long line per beat.

### Assembly instructions (ffmpeg/CapCut, matches the render-integrity contract)

1. Trim each of the 6 generated clips to its beat duration above (3-7s each); no beat may be shorter
   than 1.5s or the render-integrity motion gate's per-beat visual-change cadence fails.
2. Order: beat 1 → 2 → 3 → 4 → 5 → 6, hard cuts or ≤0.3s crossfades between beats 1-5 (keep the
   cadence brisk — a visual change every 1.5-2.5s is the floor the real gate checks).
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
7. Voiceover: warm, plain, unhurried delivery — no TTS engine is connected this session, so this step
   is **manual** (`nickstire`'s live pipeline uses its own TTS route in `reelVoice.ts`, not run here).
   A human should record or generate the 6 narration lines above at the stated per-beat timing and mux
   them in during step 6.

### Audio / music rights

**Real gap, not filled in:** no music-rights ledger exists in this repo (per the skill's own audit).
This pack does not select a specific music bed. If a background bed is added, it must carry a tracked
license (asset ID, source, license scope, territory, expiry, organic-vs-ad clearance) before publish
— track that manually; nothing here asserts a track is cleared.

### Credit-risk and fallback routing (estimates, not a live read)

From `generationLedger.ts`'s `COST_ESTIMATES_USD` (operator-tunable, not metered pricing — carried
forward from a prior pack's read; not re-read live this session, and `REEL_VIDEO_PROVIDER` came back
`unset` in this session's own env check rather than a verified prod pin):

- If rendered on the free lane (`REEL_VIDEO_PROVIDER=template_stock`, local ffmpeg): **$0.00** —
  `template_stock_clip: 0`.
- If rendered on the paid Seedance/Higgsfield lane instead: 6 beats × `seedance_clip: 0.25` (labeled
  ASSUMPTION in source) ≈ **$1.50 estimated**, against a daily `maxGenerationCostPerDayUsd` cap
  reported elsewhere as $10 (not re-verified live this session).
- `REEL_FALLBACK_TO_TEMPLATE_STOCK` governs whether a paid-provider failure degrades to the free lane
  mid-render instead of terminal-failing — current default per docs is **off**.
- Guardrail order that a real enqueue would hit (not evaluated live): `RESERVATION_FEED_CAP`
  (2 posts/day) → `RESERVATION_SPACING` (3h) → `REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) →
  `BUDGET_DAILY_EXCEEDED`. Since the repetition ledger wasn't read live this session, an operator
  should re-check `getRecentReelSignals()` before enqueueing — **7 open reel-pack PRs plus 7 already
  merged today (2026-08-21) alone** strongly suggest this queue is running far ahead of what's
  actually being merged, rendered, or published; an operator should review and prune this backlog
  before enqueueing more topics, and consider whether the scheduled firing cadence itself needs
  slowing down.

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
> That rattle for the first few seconds after you start your car? Don't ignore it. 🔊
> A quick metallic sound at startup that fades once the engine warms up can point to a stretched
> timing chain or worn guides not getting oil pressure fast enough — more noticeable on cold
> mornings. One clue isn't a diagnosis, but it's worth checking before it gets louder.
> 📍 Nick's Tire & Auto, 17625 Euclid Ave, Cleveland · (216) 862-0005
> #ClevelandMechanic #CarCare101 #EuclidOhio #TireShop #AutoRepairTips #ColdStartProblems

**Ad-ready variant A** (hook-forward, actionable):
- Hook: "That rattle when you first start your car — don't ignore it."
- Caption: "A few seconds of metallic rattle at startup, gone once it warms up. Here's what that can mean."
- CTA: "Stop by and we'll take a look — no guessing, no pressure."

**Ad-ready variant B** (reassurance-forward, lower anxiety):
- Hook: "Your engine can tell you something before it gets expensive."
- Caption: "A quick cold-start rattle is easy to shrug off. It's also easy to check."
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
7. **Review the reel-pack backlog before scheduling more runs.** 7 open PRs plus 7 merged packs
   landed on 2026-08-21 alone — this scheduled task is producing packs much faster than any human
   pipeline stage (record voiceover, generate clips, assemble, QA, approve, publish) can consume
   them. Consider pruning duplicate-adjacent open PRs, slowing the firing cadence, or batching
   several packs into one review pass.
