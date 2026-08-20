# Reel pack: Tailpipe condensation vs. coolant leak

**Date:** 2026-08-20 · **Mode:** SCHEDULED (automated firing, no live operator present this run)
**Status:** `BLOCKED: NO MOTION ROUTE` for an actual render — this session has no connected
TTS, Higgsfield, Meta-posting, or CapCut tool, and no `ADMIN_API_KEY` / Higgsfield / Meta
credential is present in this shell (checked, none found), so there is no path to call
`/api/admin/reel-canary` or any render/publish route. Per
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
| Shell/render (Bash) | Available, but no video assets or render pipeline wired here |
| `ADMIN_API_KEY` / `HIGGSFIELD_*` / `META_PAGE_*` in this shell's env | **Absent** (grepped, no matches) — confirms no live path to `/api/admin/reel-canary` |
| `getHiggsfieldAccountHealth()` live read | Not performed — no path to call it from this session |
| `REEL_VIDEO_PROVIDER` (prod pin, per `docs/operations/REEL-PIPELINE.md`, verified 2026-08-11) | `template_stock` — the free local-ffmpeg lane, not Higgsfield/Seedance, is what prod actually renders on today. Re-verify this doc before assuming it still holds. |
| `REEL_GENERATION_ENABLED` / `REEL_PUBLISH_ENABLED` live value | `UNKNOWN` — not read this session (no live path) |
| Repetition ledger (`getRecentReelSignals`, 21-day `reel_jobs` read) | `UNKNOWN` — no live DB path from this session (prod-db-guard: the repo's only `DATABASE_URL` is production TiDB; not queried). Substituted with a **filesystem + PR check** instead (below), which is the concrete anti-duplication mechanism this skill actually prescribes. |

**Duplication check performed** (per skill §"Where the pack goes"):
- `ls apps/nickstire/docs/reel-packs/` — 37 merged packs, most recent `2026-08-19-wont-start-battery-starter-alternator`. No existing pack on tailpipe condensation/coolant.
- `gh`-equivalent PR search (`is:open "reel pack" in:title`) — 10 open draft PRs (#1701, #1702, #1708, #1712, #1717, #1721, #1722, #1723, #1724, #1725) covering engine overheating, heat-shield rattle, timing belt, windshield chips, dashboard light colors, E-Check readiness, warped rotors, spongy brake pedal, in-cabin smell diagnosis, and bump clunks. None duplicate this topic.

## 2. Candidate concepts (0–5 per dimension) and selection

Dimensions: **Dup** = non-duplication vs. the 47 topics already merged/in-flight · **Motion** =
faceless motion-beat potential · **Safety** = ease of staying inside the approved-phrasing /
no-diagnosis-promise rules · **Evidence** = how groundable the core claim is · **Local** =
Cleveland/seasonal relevance.

| Concept | Dup | Motion | Safety | Evidence | Local | Total /25 |
|---|---|---|---|---|---|---|
| **Tailpipe condensation vs. coolant leak (selected)** | 5 | 4 | 5 | 4 | 4 | **22** |
| Manual-transmission clutch slipping (parked) | 4 | 3 | 4 | 3 | 2 | 16 |
| Battery terminal corrosion close-up (parked) | 2 — too close to the merged `wont-start-battery-starter-alternator` pack | 4 | 4 | 4 | 3 | 17 |

Selected: **tailpipe condensation vs. coolant leak.** It's a genuinely new angle (most of the
library skews "something's wrong"; this one opens on a reassurance — most drips are normal —
then earns its one caution beat), it's cold-morning-in-Cleveland relevant right now, and the
underlying physics claim (combustion produces water vapor that condenses in a cool muffler) is
general automotive-engineering knowledge, not a shop-specific pricing/warranty claim.

## 3. Claim evidence

| Claim | Status | Basis |
|---|---|---|
| "Water dripping from a cold exhaust is normal condensation" | `UNKNOWN` per this repo's evidence store — general automotive-engineering fact (combustion byproduct water vapor condensing in a cool muffler/tailpipe), not shop-specific. No `EvidenceRecord` in `evidenceRecords.ts` was read this session (no live DB path). Recommend an operator attach a sourced `EvidenceRecord` before this claim is treated as `"supported"` under `shared/claimEntailment.ts`. |
| "Persistent sweet-smelling white smoke can point to a coolant leak into the engine" | `UNKNOWN`, same basis — standard mechanic knowledge, phrased with the approved soft-language pattern ("can point to"), not asserted as a diagnosis. |
| Shop name / address / phone in the CTA card | Sourced: `SEED_FACTS` `legal.entity` — "Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112, (216) 862-0005" (`apps/nickstire/server/services/businessFacts.ts`). **Gap, not silently cleared:** `FactChannel` is `"sms" | "voice" | "web"` only — there is no `"reel"`/`"social"` channel yet, so this fact is not currently channel-scoped for Reels. Treat the CTA card's address/phone as needing a human eyeball-check against the current facts before publish, not as auto-cleared. |
| No price, warranty, or guarantee claim is made anywhere in this script | Verified by inspection against `businessFacts.ts` categories — nothing here touches pricing/warranty/policy, so no `BUSINESS` SSOT fact is invoked or at risk of drifting. |

## 4. Production pack — selected concept

**Title:** "That drip under your tailpipe — normal, or coolant leak?"
**Total run time:** 30s of motion beats + 3s branded freeze = **33s container** (render-integrity
contract: container/video-stream duration within 0.75s of this; ≥3 distinct frame MD5s among 5
sampled — i.e., it must actually move).
**Archetype:** reassurance-then-caution (hook flips expectation, mid-reel earns the one safety
beat, CTA is soft, not alarmist).
**Motion lens:** documentary/macro-realistic (operator should confirm the exact lens label and its
`lens.avoid` term in the live Studio wizard — that value is generated per-run in
`facelessReelStudio.ts` and isn't reproducible outside it).

### Script (word-for-word, timed)

| Beat | Time | Narration (word-for-word) |
|---|---|---|
| 1 — Hook | 0:00–0:03 (3s) | "That drip under your tailpipe — normal, or worth worrying about?" |
| 2 — Symptom | 0:03–0:07 (4s) | "On a cold Cleveland morning, water dripping from your exhaust is common." |
| 3 — Explanation | 0:07–0:13 (6s) | "Burning fuel creates water vapor. In a cool muffler, it condenses and drips out as your engine warms up." |
| 4 — Consequence/proof | 0:13–0:19 (6s) | "But sweet-smelling white smoke that keeps going after warm-up can point to a coolant leak into the engine." |
| 5 — Safe action | 0:19–0:25 (6s) | "One clue is not a diagnosis — worth checking your coolant level early, before it becomes a bigger repair." |
| 6 — Branded CTA | 0:25–0:30 (5s) | "Stop by and we'll take a look — Nick's Tire and Auto, on Euclid Avenue." |
| — SAVE freeze | 0:30–0:33 (3s) | (no new narration; end card holds, logo + address/phone card per §3 gap note) |

Approved-phrasing check (against `facelessReelStudio.ts` pattern bank): uses "can point to" (beat
4), "worth checking" and "one clue" (beat 5), "stop by and we'll take a look" (beat 6, verbatim
approved CTA). Avoids all banned patterns (`you need`, `this means your X is bad/shot/gone`, "you
definitely need") — confirmed by inspection, not by running the real validator (no live path).

### Per-beat generation prompts (Higgsfield/Seedance-style, faceless)

Standing negative prompt used on every beat, copied verbatim from
`client/src/lib/facelessReelStudio.ts`: `human face, person, hands, gloves, arms, talking head,
low-res, blurry, extra fingers, plastic glow, oversaturated AI look, warped engine parts` — plus a
per-lens `avoid` term the real wizard appends at generation time (not reproducible outside it; the
operator running this through Studio will get the live value automatically).

Every beat below satisfies the faceless rule: **no people, faces, hands, gloves, or arms — the
object moves on its own** (or via ambient forces: light, vapor, gravity, an unseen mechanism).

1. **Hook (0–3s).** *Prompt:* "Close-up on the chrome tip of a car's exhaust tailpipe, a single
   water droplet forming, hanging, and falling in soft cold-morning backlight; shallow depth of
   field; visible engine vibration in the pipe; steam breath drifting past frame." *Opening frame:*
   the droplet mid-fall, strongest possible first frame, unbranded, wordless. *Action complete by:*
   2.5s. *Physical action:* droplet formation and fall (motion-gate qualifying beat).
2. **Symptom (3–7s).** *Prompt:* "Wider shot, a car idling in a driveway on a frosty Cleveland
   morning, visible exhaust vapor plume drifting from the tailpipe into cold air, small puddle of
   drips forming and spreading on the pavement below." *Continues from beat 1's tailpipe.*
3. **Explanation cutaway (7–13s).** *Prompt:* "Object-only technical cutaway of a muffler's
   interior cross-section, animated water-vapor particles condensing on the cool metal walls into
   droplets that run down and out the pipe; clean diagrammatic lighting, slow camera push-in; no
   text or labels rendered in-scene." *Physical action:* particle-to-droplet condensation animation.
4. **Consequence/proof (13–19s).** *Prompt:* "Close-up on the same tailpipe now emitting a thicker,
   continuous white vapor plume that does not taper off as the engine idles longer, backlit to show
   density and persistence, contrast against beat 2's thinner intermittent puff." *Physical action:*
   smoke plume thickening/sustaining (visual contrast against the earlier normal-condensation beat).
5. **Safe action (19–25s).** *Prompt:* "A shop inspection light on a stand sweeps its beam across a
   translucent coolant reservoir tank on a workbench, fluid level line clearly visible against
   min/max markings, cap resting loosely beside it — no hands present, the light beam itself is the
   only motion besides a slow rack-focus." *Physical action:* light-beam sweep + rack-focus (object
   moves on its own).
6. **Branded CTA (25–30s), freeze to 33s.** *Prompt:* "Exterior establishing shot of Nick's Tire &
   Auto's shop bay, tire stack in foreground, late-afternoon light, logo signage visible and
   legible; camera holds steady for a clean end-card composite." *Then:* static hold from 30s–33s
   with logo + address/phone end-card composited in post (per §3 gap, human-verify the card text
   against current `legal.entity` fact before publish).

Every prompt keeps the top 12% / bottom 20% of frame clear for IG UI per the repo's safe-zone rule.

### Captions

See `captions.srt` in this pack — SRT, burned-in per the muted-first requirement (10/75 quality
points), split into short readable cues rather than one long line per beat.

### Assembly instructions (ffmpeg/CapCut, matches the render-integrity contract)

1. Trim each of the 6 generated clips to its beat duration above (2–6s each); no beat may be
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

From `generationLedger.ts`'s `COST_ESTIMATES_USD` (operator-tunable, not metered pricing):

- If rendered on the current prod-pinned lane (`REEL_VIDEO_PROVIDER=template_stock`, free local
  ffmpeg): **$0.00** — `template_stock_clip: 0`.
- If rendered on the paid Seedance/Higgsfield lane instead: 6 beats × `seedance_clip: 0.25`
  (labeled ASSUMPTION in source) ≈ **$1.50 estimated**, against a daily
  `maxGenerationCostPerDayUsd` cap reported elsewhere as $10 (not re-verified live this session).
- `REEL_FALLBACK_TO_TEMPLATE_STOCK` governs whether a paid-provider failure degrades to the free
  lane mid-render instead of terminal-failing — current default per docs is **off**.
- Guardrail order that a real enqueue would hit (not evaluated live): `RESERVATION_FEED_CAP`
  (2 posts/day) → `RESERVATION_SPACING` (3h) → `REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) →
  `BUDGET_DAILY_EXCEEDED`. Since the repetition ledger wasn't read live this session, an operator
  should re-check `getRecentReelSignals()` before enqueueing, in case another job posted today.

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
> That drip under your tailpipe isn't always trouble — but here's the one sign that is. 💧
> Most morning drips are just condensation. Persistent white smoke that doesn't quit? Worth a
> quick check before it becomes a bigger repair.
> 📍 Nick's Tire & Auto, 17625 Euclid Ave, Cleveland · (216) 862-0005
> #ClevelandMechanic #CarCare101 #EuclidOhio #TireShop #AutoRepairTips #CarMaintenance

**Ad-ready variant A** (hook-forward, curiosity):
- Hook: "Is that drip under your car normal — or a warning sign?"
- Caption: "90% of the time it's nothing. Here's the 1-in-10 sign that means it's worth a look."
- CTA: "Stop by and we'll take a look — no guessing, no pressure."

**Ad-ready variant B** (reassurance-forward, lower anxiety):
- Hook: "Water under your car after starting it? Totally normal — usually."
- Caption: "Condensation is normal. Persistent white smoke isn't. Know the difference in 30 seconds."
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
