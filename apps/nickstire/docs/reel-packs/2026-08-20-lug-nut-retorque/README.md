# Reel pack: Lug-nut re-torque after any wheel service

**Date:** 2026-08-20 · **Mode:** SCHEDULED (automated firing, no live operator present this run)
**Status:** `BLOCKED: NO MOTION ROUTE` for an actual render. The pack itself is
**PRODUCTION-READY** — script, prompts, captions, assembly, and copy below are complete and
ready for a human to run through the real Studio wizard.
**No render was attempted, no spend was incurred, nothing was published.** A scheduled firing is
never live operator authorization to generate, spend, or publish
(root `AGENTS.md` protected operations; `nickstire-reel-operator` hard rule).

## 1. Capability preflight (real reads, this session)

Every row below was checked in this session, not assumed from a prior run.

| Check | Result |
|---|---|
| TTS / voiceover generation, any connected server | **Not available.** Searched all connected MCP servers. The only speech tool is Adobe `media_enhance_speech`, which *separates* speech from an existing audio file — it does not synthesize narration. Gamma generates decks and still images, not narrated audio. |
| Higgsfield MCP / CLI | Not connected. `which hf higgsfield` → not found. |
| Meta / Instagram posting tool | Not connected. |
| CapCut or equivalent editor | Not connected. |
| Shell / local render | Bash available, but **`which ffmpeg` → not found**, so there is no local encode path either. |
| Adobe `video_render` / `video_create_quick_cut` | Present, but both require **pre-existing Walnut asset IDs** for source media. There is no source footage and no narration track to feed them, and licensing Adobe Stock clips is a spend action — not permitted on an automated firing. |
| `ADMIN_API_KEY` / `HIGGSFIELD_*` / `META_*` / `REEL_*` / `DATABASE_URL` in this shell | **Absent** (`env` grepped, zero matches) — confirms no live path to `/api/admin/reel-canary`. |
| `getHiggsfieldAccountHealth()` live read | Not performed — no path to call it from this session. |
| `REEL_VIDEO_PROVIDER` (prod pin, per `docs/operations/REEL-PIPELINE.md`, verified 2026-08-11) | `template_stock` — the free local-ffmpeg lane. Re-verify that doc before assuming it still holds. |
| `REEL_GENERATION_ENABLED` / `REEL_PUBLISH_ENABLED` live value | `UNKNOWN` — not read this session. |
| Repetition ledger (`getRecentReelSignals`, 21-day `reel_jobs` read) | `UNKNOWN` — no live DB path, and `prod-db-guard` applies (the repo's only `DATABASE_URL` is production TiDB). Substituted with the filesystem + open-PR check below. |

**Bottom line on the render question:** the blocker is not just the video lane — there is **no way
to produce a voiceover track at all** from this session. A "finished MP4 with voiceover" is
unreachable here by construction, so the correct deliverable is this pack.

**Duplication check performed** (per skill §"Where the pack goes" — both halves, not just `ls`):
- `ls apps/nickstire/docs/reel-packs/` → **54 merged packs**, `2026-08-14` through `2026-08-20`.
  No existing pack covers lug-nut torque or post-service re-torque.
- `list_pull_requests(state=open)` → **only 2 open reel-pack PRs**: #1738 (wheel wobble — tie rod
  vs. wheel bearing) and #1739 (musty AC smell — evaporator drain vs. cabin filter). Neither
  duplicates this topic. Note #1738 is the nearest neighbor: it is about *diagnosing an existing
  wobble by its symptom*, while this pack is about *a maintenance step after wheel service* — the
  scripts share no beat, claim, or CTA.
- **Backlog context:** the previous scheduled run
  (`BACKLOG-STATUS-2026-08-20-0900.md`, same directory) declined to author a pack because 17
  unreviewed drafts were open. That backlog has since cleared to 2, so authoring resumed this run.

## 2. Candidate concepts (0–5 per dimension) and selection

Dimensions: **Dup** = non-duplication vs. the 56 topics merged or in flight · **Motion** = faceless
motion-beat potential · **Safety** = ease of staying inside approved phrasing / no diagnosis promise ·
**Evidence** = how groundable the core claim is · **Local** = Cleveland/seasonal relevance.

| Concept | Dup | Motion | Safety | Evidence | Local | Total /25 |
|---|---|---|---|---|---|---|
| **Lug-nut re-torque after any wheel service (selected)** | 5 | 5 | 4 | 4 | 4 | **22** |
| Surface rust on rotors after an overnight rain (parked) | 3 — adjacent to the merged `warped-rotor-brake-shake` pack | 4 | 5 | 4 | 4 | 20 |
| Off-season tire storage: stacking, pressure, sunlight (parked) | 4 | 2 — static objects, weak motion beats | 5 | 3 | 3 | 17 |

Selected: **lug-nut re-torque.** It is the single most tire-shop-native topic still missing from a
54-pack library that skews toward diagnosing noises. It is a *maintenance* message rather than a
*symptom* message, which diversifies the feed. Motion scores 5 because torque wrenches, spinning
sockets, and a wheel seating against a hub are inherently kinetic and inherently faceless — the
tools move, no hands needed. Safety scores 4 rather than 5 because the topic sits close to a
safety-consequence claim, so the script deliberately stops at "worth checking" and never states
what happens if you ignore it.

## 3. Claim evidence

| Claim | Status | Basis |
|---|---|---|
| "Lug nuts can settle over the first few drives after a wheel comes off" | `UNKNOWN` per this repo's evidence store — standard wheel-service practice, not shop-specific. No `EvidenceRecord` in `evidenceRecords.ts` was read this session (no live DB path). Recommend an operator attach a sourced record (a wheel or fastener manufacturer's re-torque guidance) before this is treated as `"supported"` under `shared/claimEntailment.ts`. |
| "As the wheel seats against the hub, clamping force can drop" | `UNKNOWN`, same basis — general fastener mechanics, phrased with the approved soft-language pattern ("can"), not asserted as a diagnosis. |
| **A specific re-torque mileage figure (e.g. "50–100 miles")** | **Deliberately omitted from the script.** Industry guidance publishes such a range, but no `EvidenceRecord` was read this session and the figure varies by vehicle and wheel type. Rather than narrate an unverified number, the script says "over the first few drives." If an operator attaches a sourced record, the tighter number is a stronger beat — but it must not be added on this session's authority. |
| "They need a torque wrench set to your vehicle's spec" | `UNKNOWN` per this repo's store; standard practice. Phrased as what the shop does ("we'll take a look with a torque wrench, set to spec"), not as an instruction the viewer must follow at home — this also keeps the reel from encouraging a DIY attempt on a safety-critical fastener. |
| Shop name / address / phone in the CTA card | **Sourced:** `SEED_FACTS` `legal.entity` — "Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112, (216) 862-0005" (`apps/nickstire/server/services/businessFacts.ts:130`, read this session). **Gap, not silently cleared:** `FactChannel` is `"sms" \| "voice" \| "web"` only (`businessFacts.ts:31`) — there is no `"reel"`/`"social"` channel, so this fact is not channel-scoped for Reels. Human-verify the end-card text before publish. |
| No price, warranty, guarantee, or turnaround-time claim anywhere in the script | Verified by inspection. An earlier draft of beat 6 read "free, takes five minutes" — **cut**, because both halves are business-policy claims with no cleared `businessFacts` row behind them. |

## 4. Production pack — selected concept

**Title:** "Got new tires? The one step most people skip."
**Total run time:** 30s of motion beats + 3s branded freeze = **33s container** (render-integrity
contract: container duration AND video-stream duration each within 0.75s of 33.0s; ≥80% of expected
30fps frame count; ≥3 distinct MD5s among 5 sampled frames — it must actually move).
**Archetype:** maintenance-reminder (hook names a recent action the viewer took, not a symptom they
fear; the reel's job is a five-minute follow-up visit, not alarm).
**Motion lens:** documentary/macro-realistic (confirm the exact lens label and its `lens.avoid` term
in the live Studio wizard — that value is generated per-run in `facelessReelStudio.ts` and is not
reproducible outside it).

### Script (word-for-word, timed)

| Beat | Time | Narration (word-for-word) |
|---|---|---|
| 1 — Hook | 0:00–0:03 (3s) | "Got new tires this week? There's one step most people skip." |
| 2 — Symptom | 0:03–0:08 (5s) | "Any time a wheel comes off your car, the lug nuts can settle over the first few drives." |
| 3 — Explanation | 0:08–0:14 (6s) | "As the wheel seats fully against the hub, the clamping force holding it can drop." |
| 4 — Consequence/proof | 0:14–0:20 (6s) | "A nut that felt tight on day one may not read tight on day three." |
| 5 — Safe action | 0:20–0:26 (6s) | "One clue is a click or shudder that shows up after new tires — do not guess." |
| 6 — Branded CTA | 0:26–0:30 (4s) | "Stop by and we'll take a look with a torque wrench, set to spec." |
| — SAVE freeze | 0:30–0:33 (3s) | (no new narration; end card holds — logo + address/phone per §3 gap note) |

Approved-phrasing check against the `facelessReelStudio.ts` pattern bank: uses "can" (beats 2–3),
"one clue" and "do not guess" (beat 5), and "stop by and we'll take a look" (beat 6, verbatim
approved CTA). Avoids every banned pattern (`you need`, `this means your X is bad/shot/gone`,
"you definitely need") — confirmed by inspection, **not** by running the real validator, since
there is no live path to it from this session.

### Per-beat generation prompts (Higgsfield/Seedance-style, faceless)

Standing negative prompt on every beat, copied verbatim from
`client/src/lib/facelessReelStudio.ts`: `human face, person, hands, gloves, arms, talking head,
low-res, blurry, extra fingers, plastic glow, oversaturated AI look, warped engine parts` — plus a
per-lens `avoid` term the live wizard appends at generation time.

Every beat satisfies the faceless rule: **no people, faces, hands, gloves, or arms.** This topic
normally implies a person holding a wrench, so each prompt below is written so the tool, the wheel,
or the light is the thing that moves — an unseen mechanism, a motorized rig, or gravity.

1. **Hook (0–3s).** *Prompt:* "Extreme close-up on a chrome lug nut on a clean alloy wheel, a
   six-point socket descending onto it and seating with a precise quarter-turn, driven by an unseen
   rig; shallow depth of field, cool shop lighting, faint metallic ring on contact." *Opening
   frame:* the socket a few millimetres above the nut, about to seat — strongest first frame,
   unbranded, wordless. *Action complete by:* 2.5s. *Physical action:* socket descent + quarter-turn.
2. **Symptom (3–8s).** *Prompt:* "Wider shot of a freshly mounted wheel on a lift, the tire slowly
   rotating to a stop, all five lug nuts passing through frame in sequence, light sweeping across
   each one; garage bay background softly out of focus." *Continues from beat 1's wheel.*
   *Physical action:* wheel rotation decelerating to rest.
3. **Explanation cutaway (8–14s).** *Prompt:* "Object-only technical cutaway of a wheel hub and one
   lug stud in cross-section, the wheel face drawing a fraction of a millimetre closer to the hub as
   a seating gap closes, an animated clamping-force indicator easing back as it does; clean
   diagrammatic lighting, slow camera push-in; no text or labels rendered in-scene." *Physical
   action:* gap closing + indicator easing (the core mechanism, shown not stated).
4. **Consequence/proof (14–20s).** *Prompt:* "Split-depth macro: the same lug nut shown twice in one
   continuous camera move — the near half crisp and freshly torqued, the far half after miles of
   driving with faint brake dust and road film settled into its seat; slow dolly connects the two
   states." *Physical action:* continuous dolly move revealing the changed state.
5. **Safe action (20–26s).** *Prompt:* "A calibrated torque wrench resting on a workbench, its scale
   and setting collar in sharp focus, a shop light sweeping across the graduations; the wrench head
   clicks once and settles — no hands present, the light sweep and the click are the only motion
   besides a slow rack-focus." *Physical action:* light sweep + audible/visible click + rack-focus.
6. **Branded CTA (26–30s), freeze to 33s.** *Prompt:* "Exterior establishing shot of Nick's Tire &
   Auto's shop bay, tire stack in foreground, late-afternoon light, logo signage visible and
   legible; camera holds steady for a clean end-card composite." *Then:* static hold 30s–33s with
   logo + address/phone end-card composited **in post** (per §3, human-verify the card text against
   the current `legal.entity` fact before publish).

Every prompt keeps the top 12% and bottom 20% of frame clear for IG UI, per the repo's safe-zone rule.

### Captions

See `captions.srt` in this pack — 13 cues, burned in per the muted-first requirement (10/75 quality
points), split into short readable lines rather than one long line per beat.

### Assembly instructions (ffmpeg/CapCut, matches the render-integrity contract)

1. Trim each of the 6 generated clips to its beat duration above (3–6s each). No beat may run
   shorter than 1.5s or the per-beat visual-change cadence the render-integrity gate checks fails.
2. Order beats 1 → 6. Hard cuts or ≤0.3s crossfades between beats 1–5; keep a visual change every
   1.5–2.5s.
3. Freeze the final frame of beat 6 for exactly 3.0s. **Do not** loop or repeat an earlier beat to
   pad length — the render-integrity gate treats a repeated-frame loop as a motion-floor violation,
   not a valid freeze.
4. Burn in captions per `captions.srt`, bottom safe zone, white text with a dark outline or box.
   The reel plays muted-first; captions are not optional.
5. Composite the logo + address/phone end card onto the frozen final 3s **only** — keep branding off
   the motion beats, per the faceless / no-logo-in-scene generation rule.
6. Export: MP4, H.264, 1080×1920 (9:16), ≥30fps, ≥80% of expected 30fps frame count across the 33s
   runtime, voiceover muxed in, container duration and video-stream duration each within 0.75s of
   33.0s.
7. **Voiceover is manual.** No TTS engine is reachable from this session (see §1) — nickstire's live
   pipeline uses its own route in `reelVoice.ts`, which was not run here. A human records or
   generates the 6 narration lines at the stated per-beat timings and muxes them in at step 6.

### Audio / music rights

**Real gap, not filled in:** no music-rights ledger exists in this repo. This pack selects no
specific music bed. If one is added, it must carry a tracked license (asset ID, source, license
scope, territory, expiry, organic-vs-ad clearance) before publish. Nothing here asserts any track is
cleared. Note that beats 1 and 5 are built around distinct mechanical sounds (a socket seating, a
torque wrench clicking) — this reel is stronger with a quiet bed or none at all.

### Credit-risk and fallback routing (estimates, not a live read)

From `generationLedger.ts` `COST_ESTIMATES_USD` (operator-tunable estimates, not metered pricing):

- Current prod-pinned lane (`REEL_VIDEO_PROVIDER=template_stock`, free local ffmpeg):
  **$0.00** — `template_stock_clip: 0`.
- Paid Seedance/Higgsfield lane instead: 6 beats × `seedance_clip: 0.25` (labeled ASSUMPTION in
  source) ≈ **$1.50 estimated**, against the daily `maxGenerationCostPerDayUsd` cap (reported
  elsewhere as $10; not re-verified live this session).
- `REEL_FALLBACK_TO_TEMPLATE_STOCK` governs whether a paid-provider failure degrades to the free
  lane instead of terminal-failing; current default per docs is **off**.
- Guardrail order a real enqueue would hit (not evaluated live): `RESERVATION_FEED_CAP` (2/day) →
  `RESERVATION_SPACING` (3h) → `REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) →
  `BUDGET_DAILY_EXCEEDED`. Because the repetition ledger was not read live, an operator should
  re-check `getRecentReelSignals()` before enqueueing, in case another job already posted today.
- **`REPEAT_CTA` note:** beat 6 uses the standard "stop by and we'll take a look" CTA, which recent
  packs also use. If another pack from this library posted within 72 hours, this one will trip the
  CTA guardrail — that is the system working, not a defect in this pack. Reword the CTA's opening
  clause or wait out the window.

## 5. QA matrix

| Gate | Result | Basis |
|---|---|---|
| Brief-time quality score (`calculateReelQualityScore`, min 70/75) | `UNKNOWN` | Not run — no live path to the scorer. Script self-checked against approved-phrasing and faceless rules by inspection only. |
| Server re-score at enqueue | `UNKNOWN` | No enqueue attempted. |
| Render-integrity gate (#800/#801: duration match, frame count, ≥3 distinct frame MD5s) | `BLOCKED` | No render attempted — nothing exists to check. |
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED` | No render attempted. |
| Repair routing (`repairRouter.ts`) | `BLOCKED` | No render, no critic verdict to route. |
| Consolidated publish gate (`evaluateReelPublishGate`) | `BLOCKED` | No job exists to evaluate. |
| Human approval / hash-checked approval integrity | `BLOCKED` | Nothing to approve yet — this pack is the input to that step, not past it. |
| Evidence entailment (`shared/claimEntailment.ts`) on the mechanical claims | `UNKNOWN` | See §3 — general knowledge, not read against `evidenceRecords.ts` live. |
| Duplication vs. merged packs and open PRs | **`PASS`** | The one gate genuinely checked this session: `ls` over 54 merged pack directories plus `list_pull_requests(state=open)` returning exactly 2 open reel-pack PRs (#1738, #1739). Neither overlaps. |

Only the duplication row claims `PASS`, and it names the exact read behind it. No other `PASS` is
claimed — per this repo's own runbooks, a `jobId` or "the command exited 0" is not evidence of a
finished Reel, and nothing here got that far.

## 6. IG/FB copy + two ad-ready variants

**Primary caption (organic feed post):**
> New tires or a wheel off for any repair? There's one five-minute follow-up most drivers never
> hear about. 🔧
> Lug nuts can settle over the first few drives as the wheel seats against the hub. A quick
> torque-wrench check catches it.
> 📍 Nick's Tire & Auto, 17625 Euclid Ave, Cleveland · (216) 862-0005
> #ClevelandMechanic #TireShop #CarCare101 #EuclidOhio #AutoRepairTips #CarMaintenance

**Ad-ready variant A** (hook-forward, curiosity):
- Hook: "Got new tires last week? Do this before you forget."
- Caption: "The step most shops mention once and most drivers never get around to. Takes minutes."
- CTA: "Swing by and we'll check them — no guessing, no pressure."

**Ad-ready variant B** (reassurance-forward, lower anxiety):
- Hook: "Nothing's wrong with your car. This is just the follow-up."
- Caption: "After any wheel comes off, a quick re-check is normal practice — not a sign of a problem."
- CTA: "Stop by Nick's Tire & Auto on Euclid and we'll take a look."

## 7. Final status

**`BLOCKED: NO MOTION ROUTE`** — no TTS, Higgsfield, Meta-posting, or editing tool is reachable from
this session, `ffmpeg` is absent, and no live credential exists. Even if a route existed, the skill's
hard rule stands: a scheduled firing is never live authorization to spend, render, or publish. The
pack itself (script, prompts, captions, assembly, copy) is **PRODUCTION-READY** and waiting on a
human. **Nothing was rendered. Nothing was published. No spend occurred.**

**Still requires manual work:**
1. **Record or TTS-generate** the 6 voiceover lines at the stated timings (no TTS in this session).
2. **Run the brief through the real Studio wizard** (`admin → Growth → Instagram → Studio`) for a
   live quality score and a real repetition-ledger check — this pack's dedup was filesystem + PR
   search, not the live DB.
3. **Generate the 6 motion clips** (Higgsfield/Seedance, or the prod-pinned `template_stock` lane).
4. **Assemble in CapCut or ffmpeg** per §4, honoring the render-integrity contract.
5. **Select and clear a music bed** if one is wanted — real rights gap, see §4.
6. **Human-verify the end-card address/phone** against the current `legal.entity` fact before publish.
7. **Post via the approval door**, not directly — run the render-integrity gate, rendered QA, and the
   human-approval step, and publish only on an explicit, live, in-the-moment operator instruction.
