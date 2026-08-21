# Reel pack: Catalytic converter theft — the roar, the risk, the etching fix

**Date:** 2026-08-21 · **Mode:** SCHEDULED (automated firing, no live operator present this run)
**Status:** `BLOCKED: NO MOTION ROUTE` for an actual render — this session has no connected
TTS, Higgsfield, Meta-posting, or CapCut tool, and no `ADMIN_API_KEY` / Higgsfield / Meta /
TTS credential is present in this shell (grepped by name, none found), and `ffmpeg` is not on
this shell's `PATH` either — so there is no path to call `/api/admin/reel-canary` or to render
locally. Per `.claude/skills/nickstire-reel-operator/SKILL.md` §"Producing a pack when the motion
route is unavailable," this is the full production-ready pack delivered instead of a silently
downgraded asset. The pack itself is **PRODUCTION-READY** — script, prompts, captions, assembly,
and copy below are complete and ready for a human to run through the real Studio wizard.
**No render was attempted, no spend was incurred, nothing was published.** This also satisfies the
repo's own hard rule: a scheduled firing is never live operator authorization to generate, spend,
or publish (`AGENTS.md` protected operations; skill hard rule).

## 1. Capability preflight (real reads, this session)

| Check | Result |
|---|---|
| ChatGPT / LLM scripting tool | This session (Claude) wrote the script/prompts directly — no separate ChatGPT tool connected or needed |
| TTS tool connected to this session | Not connected |
| Higgsfield MCP / API connected to this session | Not connected |
| Meta posting tool connected to this session | Not connected |
| CapCut / editing tool connected to this session | Not connected |
| Shell/render (Bash + ffmpeg) | Bash available; `ffmpeg` checked with `which`/`command -v` — **not found** on `PATH` |
| `ADMIN_API_KEY` / `HIGGSFIELD_*` / `META_PAGE_*` / `DATABASE_URL` / TTS/ElevenLabs/OpenAI keys in this shell's env | **Absent** (grepped by name, no matches) — confirms no live path to `/api/admin/reel-canary` |
| `getHiggsfieldAccountHealth()` live read | Not performed — no path to call it from this session |
| `REEL_VIDEO_PROVIDER` (prod pin, per `docs/operations/REEL-PIPELINE.md`, last verified 2026-08-11) | `template_stock` — the free local-ffmpeg lane, not Higgsfield/Seedance, is what prod actually renders on today. Re-verify this doc before assuming it still holds. |
| `REEL_GENERATION_ENABLED` / `REEL_PUBLISH_ENABLED` live value | `UNKNOWN` — not read this session (no live path) |
| Repetition ledger (`getRecentReelSignals`, 21-day `reel_jobs` read) | `UNKNOWN` — no live DB path from this session (prod-db-guard: the repo's only `DATABASE_URL` is production TiDB; not queried). Substituted with a **filesystem + PR check** instead (below), the concrete anti-duplication mechanism this skill actually prescribes. |

**Duplication check performed** (per skill §"Where the pack goes"):
- `ls apps/nickstire/docs/reel-packs/` — **66 merged packs**, four already landed today
  (2026-08-21: `ac-recharge-myth-sealed-system`, `brake-pedal-sinks-overnight`,
  `differential-whine-on-turns`, `valve-stem-dry-rot`). Every existing pack is a
  symptom-diagnosis format (a noise/smell/light → what it points to → a checkup CTA). None covers
  vehicle security / theft prevention — this pack is a different content *type*, not just a
  different symptom, which is itself a repetition-ledger benefit (the daily feed isn't only
  diagnosis reels).
- Open PR search (`is:open "reel pack" in:title` via `mcp__github__search_pull_requests`) —
  **zero open reel-pack PRs** at the time of this run. No in-flight duplicate risk.

## 2. Candidate concepts (0–5 per dimension) and selection

Dimensions: **Dup** = non-duplication vs. the 66 topics already merged/in-flight · **Motion** =
faceless motion-beat potential · **Safety** = ease of staying inside the approved-phrasing /
no-diagnosis-promise / no-fearmongering rules · **Evidence** = how groundable the core claim is ·
**Local** = Cleveland/Euclid-Ave relevance.

| Concept | Dup | Motion | Safety | Evidence | Local | Total /25 |
|---|---|---|---|---|---|---|
| **Catalytic converter theft — etching/shield prevention (selected)** | 5 | 4 | 4 | 3 | 4 | **20** |
| Driveshaft U-joint clunk (RWD/4x4 only) | 5 | 3 | 4 | 3 | 2 | 17 |
| Morning brake-rotor rust squeal (reassurance angle) | 4 — adjacent to `warped-rotor-brake-shake` but a distinct, harmless phenomenon | 3 | 5 | 3 | 2 | 17 |

Selected: **catalytic converter theft prevention.** Every existing pack in the library is a
diagnostic "here's a symptom, here's what it points to" format; this is a genuinely different
content type (a prevention/security tip), which is good for feed variety, not just topic
variety. The core factual claim (converters contain small amounts of precious metal and are a
common theft target; etching/shields are a standard deterrent) is broad, well-documented
automotive/insurance-industry knowledge rather than a shop-specific diagnostic call, which keeps
it easy to phrase safely — no symptom is being told to a driver as "this means your car is
broken," which sidesteps the diagnosis-promise risk entirely. Rejected a specific "Cleveland
crime rate" claim (see §3) as unverifiable from this session; the script below stays at the
national-trend level, which is the well-documented layer.

## 3. Claim evidence

| Claim | Status | Basis |
|---|---|---|
| "Catalytic converters contain small amounts of precious metal, which makes them a common theft target" | `UNKNOWN` per this repo's evidence store — broad, widely reported automotive/insurance-industry fact (e.g. National Insurance Crime Bureau reporting), not shop-specific. No `EvidenceRecord` in `evidenceRecords.ts` was read this session (no live DB path). Recommend an operator attach a sourced `EvidenceRecord` before this is treated as `"supported"` under `shared/claimEntailment.ts`. |
| "It's become one of the most common theft claims nationwide" | `UNKNOWN`, same basis — kept at the **national** level deliberately; a specific Cleveland/Euclid-Ave local crime-rate figure was considered and rejected for this script because this session has no way to verify a local statistic, and an unverifiable specific local claim is a higher-risk failure mode than a general, well-documented national trend. |
| "An etched VIN or a welded shield can make a vehicle a harder target and may help police trace it if stolen" | `UNKNOWN`, same basis — standard, widely recommended (many police departments and insurers publish this) prevention measure, phrased with approved soft language ("can... may help"), not asserted as a guarantee against theft. |
| Shop name / address / phone in the CTA card | Sourced: `SEED_FACTS` `legal.entity` — "Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112, (216) 862-0005" (`apps/nickstire/server/services/businessFacts.ts`). **Gap, not silently cleared:** `FactChannel` today is `"sms" | "voice" | "web"` only — there is no `"reel"`/`"social"` channel yet, so this fact is not currently channel-scoped for Reels. Treat the CTA card's address/phone as needing a human eyeball-check against the current facts before publish, not as auto-cleared. |
| No price, warranty, or guarantee claim is made anywhere in this script | Verified by inspection against `businessFacts.ts` categories — nothing here touches pricing/warranty/policy, so no `BUSINESS` SSOT fact is invoked or at risk of drifting. Note: the script does not promise etching/shielding prevents theft, only that it "can" deter and "may" help trace — avoids an absolute-guarantee claim. |

## 4. Production pack — selected concept

**Title:** "That sudden roar under your car? Someone might be after your catalytic converter."
**Total run time:** 31s of motion beats + 3s branded freeze = **34s container** (render-integrity
contract: container/video-stream duration within 0.75s of this; ≥3 distinct frame MD5s among 5
sampled — i.e., it must actually move).
**Archetype:** awareness-then-prevention (hook is a jarring but true scenario, mid-reel earns the
one factual beat, CTA is a low-pressure prevention offer, not alarmist).
**Motion lens:** documentary/macro-realistic (operator should confirm the exact lens label and its
`lens.avoid` term in the live Studio wizard — that value is generated per-run in
`facelessReelStudio.ts` and isn't reproducible outside it).

### Script (word-for-word, timed)

| Beat | Time | Narration (word-for-word) |
|---|---|---|
| 1 — Hook | 0:00–0:03 (3s) | "That sudden loud roar when you start your car? It might not be your muffler." |
| 2 — Symptom | 0:03–0:08 (5s) | "A jarring, deep rumble the second the engine turns over — especially if it wasn't there the night before." |
| 3 — Explanation | 0:08–0:14 (6s) | "Catalytic converters hold small amounts of precious metal, which makes them a common target for thieves working fast, underneath the car." |
| 4 — Consequence | 0:14–0:20 (6s) | "It's become one of the most common theft claims nationwide — and a stolen converter usually means a full exhaust repair, not a quick patch." |
| 5 — Safe action | 0:20–0:26 (6s) | "One clue: an etched VIN or a welded shield can make your vehicle a harder target, and may help police trace it if it's ever stolen." |
| 6 — Branded CTA | 0:26–0:31 (5s) | "Stop by and we'll take a look — Nick's Tire and Auto, on Euclid Avenue." |
| — SAVE freeze | 0:31–0:34 (3s) | (no new narration; end card holds, logo + address/phone card per §3 gap note) |

Approved-phrasing check (against `facelessReelStudio.ts` pattern bank): uses "can... may help"
(beat 5, analogous to approved "can point to" soft-certainty pattern), "one clue" (beat 5), "stop
by and we'll take a look" (beat 6, verbatim approved CTA). Avoids all banned patterns (`you need`,
`this means your X is bad/shot/gone`, "you definitely need", any guarantee that etching prevents
theft). Confirmed by inspection, not by running the real validator (no live path).

### Per-beat generation prompts (Higgsfield/Seedance-style, faceless)

Standing negative prompt used on every beat, copied verbatim from
`client/src/lib/facelessReelStudio.ts`: `human face, person, hands, gloves, arms, talking head,
low-res, blurry, extra fingers, plastic glow, oversaturated AI look, warped engine parts` — plus a
per-lens `avoid` term the real wizard appends at generation time (not reproducible outside it; the
operator running this through Studio will get the live value automatically).

Every beat below satisfies the faceless rule: **no people, faces, hands, gloves, or arms — the
object moves on its own** (or via ambient forces: light, camera motion, vapor, an unseen
mechanism). No theft act itself is depicted — the visuals stay on parts and prevention, never a
dramatized crime.

1. **Hook (0–3s).** *Prompt:* "Close-up on the underside of a parked car at night, catalytic
   converter visibly bolted into the exhaust pipe, a security floodlight sweeping slowly across the
   metal casing; shallow depth of field, quiet empty parking lot in the background." *Opening
   frame:* the converter sharply lit and centered, strongest possible first frame, unbranded,
   wordless. *Action complete by:* 2.5s. *Physical action:* floodlight sweep (motion-gate
   qualifying beat).
2. **Symptom (3–8s).** *Prompt:* "Static low-angle shot of a car's exhaust tailpipe at engine
   start-up, dawn parking-lot light, a visible heat-shimmer and vapor pulsing from the pipe in time
   with the idle." *Physical action:* heat-shimmer/vapor pulse.
3. **Explanation cutaway (8–14s).** *Prompt:* "Object-only technical cutaway of a catalytic
   converter's internal honeycomb ceramic substrate, a faint metallic sheen along the coated
   surface, slow orbiting macro camera move; clean diagrammatic lighting, no text or labels
   rendered in-scene." *Physical action:* orbiting camera reveal.
4. **Consequence (14–20s).** *Prompt:* "Overhead shot of a car raised on a shop lift, the exhaust
   pipe hanging with an empty gap where a converter used to be, a shop inspection light on a stand
   sweeping across the cut pipe ends; no hands present." *Physical action:* light sweep + slow
   push-in.
5. **Safe action (20–26s).** *Prompt:* "Macro close-up on a catalytic converter shell showing a
   freshly etched VIN number and a welded anti-theft shield cage around it, an inspection light
   sweeping across the etched digits to make them legible, slow rack-focus." *Physical action:*
   light sweep + rack-focus (object moves on its own).
6. **Branded CTA (26–31s), freeze to 34s.** *Prompt:* "Exterior establishing shot of Nick's Tire &
   Auto's shop bay, tire stack in foreground, late-afternoon light, logo signage visible and
   legible; camera holds steady for a clean end-card composite." *Then:* static hold from 31s–34s
   with logo + address/phone end-card composited in post (per §3 gap, human-verify the card text
   against current `legal.entity` fact before publish).

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
   34s runtime (render-integrity floor), audio track (voiceover) muxed in, container duration and
   video-stream duration both within 0.75s of 34.0s.
7. Voiceover: warm, plain, unhurried delivery — steady, not alarmed, especially through beats 1–4
   (this is a prevention tip, not a scare piece). No TTS engine is connected this session, so this
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
  `BUDGET_DAILY_EXCEEDED`. **Four packs already merged today (2026-08-21)** — an operator enqueuing
  this pack for a real post should re-check `getRecentReelSignals()` and the day's feed-post count
  against `RESERVATION_FEED_CAP` (2/day) before assuming a slot is open; this pack is written as an
  addition to the library/backlog, not a claim that today has room left on the live feed.

## 5. QA matrix

| Gate | Result | Basis |
|---|---|---|
| Brief-time quality score (`calculateReelQualityScore`, min 70/75) | `UNKNOWN` | Not run — no live path to the scorer this session; script self-checked against the approved-phrasing/faceless rules by inspection only, not the real validator |
| Server re-score at enqueue | `UNKNOWN` | No enqueue attempted |
| Render-integrity gate (#800/#801: duration match, frame count, ≥3 distinct MD5s) | `BLOCKED` | No render attempted — nothing exists to check |
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED` | No render attempted |
| Consolidated publish gate (`evaluateReelPublishGate`) | `BLOCKED` | No job exists to evaluate |
| Human approval / hash-checked approval integrity | `BLOCKED` | Nothing to approve yet — this pack is the input to that step, not past it |
| Evidence entailment (`shared/claimEntailment.ts`) on the theft/prevention claims | `UNKNOWN` | See §3 — general, well-documented industry knowledge, not read against `evidenceRecords.ts` live |

No `PASS` is claimed anywhere in this matrix — a `jobId` or "the command exited 0" is explicitly
not evidence of a finished Reel in this repo's own runbooks, and nothing here got that far.

## 6. IG/FB copy + two ad-ready variants

**Primary caption (organic feed post):**
> That sudden loud roar when you start your car? It might not be your muffler. 🔧
> Catalytic converters hold small amounts of precious metal, which makes them a common theft
> target — and it's one of the most common theft claims nationwide. An etched VIN or a welded
> shield can make your car a harder target, and may help police trace it if it's ever stolen.
> 📍 Nick's Tire & Auto, 17625 Euclid Ave, Cleveland · (216) 862-0005
> #ClevelandMechanic #CarCare101 #EuclidOhio #TireShop #AutoRepairTips #CatalyticConverter

**Ad-ready variant A** (awareness-forward, curiosity):
- Hook: "If your car suddenly sounds like a race car, it's not an upgrade."
- Caption: "Catalytic converter theft takes minutes and leaves your exhaust roaring. Here's the
  low-cost fix that makes your car a harder target."
- CTA: "Stop by and we'll take a look — no pressure, just protection."

**Ad-ready variant B** (reassurance-forward, lower anxiety):
- Hook: "You can't stop every thief, but you can make your car a harder target."
- Caption: "An etched VIN or a welded shield takes minutes and may help police trace a stolen
  converter — cheap insurance against an expensive repair."
- CTA: "Free look, honest answer — stop by Nick's Tire & Auto on Euclid."

## 7. Final status

**`BLOCKED: NO MOTION ROUTE`** — no TTS/Higgsfield/Meta-posting/CapCut tool and no live
credential is reachable from this session, and per the skill's hard rule a scheduled/automated
firing is never live authorization to spend, render, or publish even if a route existed. The pack
itself (script, prompts, captions, assembly, copy) is **PRODUCTION-READY** and waiting on a human
to run it through the live Studio wizard (`admin → Growth → Instagram → Studio`), record/generate
the voiceover, and carry it through the real quality/render-integrity/approval gates end to end.
Nothing was rendered. Nothing was published. No spend occurred.

**Still requires manual work:**
1. Record or TTS-generate the 6 voiceover lines at the stated timings (steady, unhurried delivery
   — not alarmed).
2. Run the brief through the real Studio wizard to get a live quality score and repetition-ledger
   check (this pack's checks were done by filesystem/PR search, not the live DB).
3. Generate the 6 motion clips (Higgsfield/Seedance or the prod-pinned `template_stock` lane) and
   assemble per §4's ffmpeg/CapCut instructions.
4. Select and clear a music bed if one is wanted (real rights gap — see §4).
5. Human-verify the end-card address/phone text against current `legal.entity` fact before publish.
6. Before enqueueing for a real post, re-check `getRecentReelSignals()` and today's feed-post count
   against `RESERVATION_FEED_CAP` — four packs already merged today (2026-08-21).
7. Run it through the real render-integrity gate, rendered QA, and human-approval door before any
   publish action — publish only ever on an explicit, live, in-the-moment operator instruction.
