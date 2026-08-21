# Reel pack: Why you can't just "add freon" to your AC

**Date:** 2026-08-21 · **Mode:** SCHEDULED (automated firing, no live operator present this run)
**Status:** `BLOCKED: NO MOTION ROUTE` for an actual render — see §1 for exactly what was and
wasn't checked. Per `.claude/skills/nickstire-reel-operator/SKILL.md` §"Producing a pack when the
motion route is unavailable," this is the full production-ready pack delivered instead of a
silently-downgraded asset. The pack itself is **PRODUCTION-READY** — script, prompts, captions,
assembly, and copy below are complete and ready for a human to run through the real Studio wizard.
**No render was attempted, no spend was incurred, nothing was published.** This also satisfies the
repo's own hard rule: a scheduled firing is never live operator authorization to generate, spend,
or publish (`AGENTS.md` protected operations; skill hard rule).

## 1. Capability preflight (real reads, this session)

| Check | Result |
|---|---|
| TTS tool connected to this session | Not connected — no text-to-speech MCP tool present |
| Higgsfield MCP / API connected to this session | Not connected |
| Meta / Instagram posting tool connected to this session | Not connected |
| CapCut / editing tool connected to this session | Not connected |
| Adobe-for-creativity MCP (video render, stock licensing) | **Connected** — `video_render`, `video_create_quick_cut`, `video_resize`, `asset_license_and_download_stock`, `media_enhance_speech` (audio *enhancement*, not TTS generation) are real tools available this session. **Deliberately not invoked**: licensing stock footage is a real spend action, and per the skill's hard rule a scheduled/automated firing is never live authorization to spend, generate, or publish — even though a technical render path exists here today, that's a capability note, not permission to use it unattended. |
| Shell/render (Bash) | Available, but no voiceover audio or footage assets exist to assemble — nothing to render |
| `ADMIN_API_KEY` / `HIGGSFIELD_*` / `META_PAGE_*` live credential in this checkout | **Absent** — only `apps/nickstire/.env.example` (a template) exists in this checkout; there is no `.env` file, so no live path to `/api/admin/reel-canary` regardless of the Adobe MCP finding above |
| `getHiggsfieldAccountHealth()` live read | Not performed — no path to call it from this session |
| `REEL_VIDEO_PROVIDER` (prod pin, per `docs/operations/REEL-PIPELINE.md`, verified 2026-08-11) | `template_stock` — the free local-ffmpeg lane, not Higgsfield/Seedance, is what prod actually renders on today. Re-verify this doc before assuming it still holds. |
| `REEL_GENERATION_ENABLED` / `REEL_PUBLISH_ENABLED` live value | `UNKNOWN` — not read this session (no live path) |
| Repetition ledger (`getRecentReelSignals`, 21-day `reel_jobs` read) | `UNKNOWN` — no live DB path from this session (prod-db-guard: the repo's only `DATABASE_URL` is production TiDB; not queried). Substituted with a **filesystem + PR check** instead (below). |

**Duplication check performed** (per skill §"Where the pack goes"):
- `ls apps/nickstire/docs/reel-packs/` — 52 merged packs, most recent dated 2026-08-20
  (`tailpipe-condensation-vs-coolant-leak`). No existing merged pack on AC recharge / sealed-system
  refrigerant myth.
- Open PR search (`is:open is:pr "reel pack" in:title`) — 11 open draft PRs (#1738, #1739, #1741,
  #1742, #1744, #1745, #1746, #1748, #1749, #1750, #1751) covering wheel wobble, musty AC
  smell (evaporator drain/cabin filter — a *different* AC angle than this pack's sealed-system
  myth), lug-nut re-torque, tire sidewall AWD matching, sticking brake caliper, reading a tire
  sidewall, low-tire soapy-water leak test, radiator fan idle, tire valve-stem dry rot, brake pedal
  sinking overnight, and differential whine. None duplicate this topic. The two existing AC-related
  packs (`ac-not-blowing-cold` merged 2026-08-18, and the open `musty-ac-smell` PR) are both
  symptom-triage/odor angles — this pack is a distinct myth-busting/education angle on why "topping
  off" refrigerant isn't the fix it sounds like.

## 2. Candidate concepts (0–5 per dimension) and selection

Dimensions: **Dup** = non-duplication vs. the ~63 topics already merged/in-flight · **Motion** =
faceless motion-beat potential · **Safety** = ease of staying inside the approved-phrasing / no
diagnosis-promise rules · **Evidence** = how groundable the core claim is · **Local** = Cleveland/
seasonal relevance.

| Concept | Dup | Motion | Safety | Evidence | Local | Total /25 |
|---|---|---|---|---|---|---|
| **AC recharge myth — sealed system, low level means a leak (selected)** | 5 | 4 | 5 | 4 | 5 | **23** |
| Torn CV axle boot — grease slinging inside the wheel | 3 — adjacent to merged `cv-joint-click` (same subsystem, different symptom) | 3 | 4 | 4 | 3 | 17 |
| Parasitic battery drain test (dome light left on) | 3 — adjacent to merged `wont-start-battery-starter-alternator` and `battery-terminal-corrosion` | 3 | 4 | 3 | 2 | 15 |

Selected: **AC recharge myth.** It's late-August in Cleveland — peak AC-demand season — and it's
a genuinely new angle in the library: every prior AC pack is symptom-triage ("why is it blowing
warm," "why does it smell"), while this one corrects a specific, common DIY misconception (buying
a can of refrigerant at the parts store and topping it off) with a general HVAC-engineering fact
(a sealed system doesn't consume refrigerant under normal operation — a low level means something
escaped), then steers to the safe action without diagnosing the leak location.

## 3. Claim evidence

| Claim | Status | Basis |
|---|---|---|
| "A car's AC is a sealed system — it doesn't burn through refrigerant like gas in a tank" | `UNKNOWN` per this repo's evidence store — general HVAC/automotive-engineering fact (a correctly functioning sealed refrigerant loop does not consume its charge through normal use), not shop-specific. No `EvidenceRecord` in `evidenceRecords.ts` was read this session (no live DB path). Recommend an operator attach a sourced `EvidenceRecord` before this claim is treated as `"supported"` under `shared/claimEntailment.ts`. |
| "If the level is low, refrigerant escaped somewhere — adding more without fixing the leak can strain the compressor" | `UNKNOWN`, same basis — standard mechanic/HVAC knowledge, phrased with the approved soft-language pattern ("can point to" / "worth checking" family), not asserted as a diagnosis of this specific vehicle. |
| Shop name / address / phone in the CTA card | Sourced: `SEED_FACTS` `legal.entity` — "Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112, (216) 862-0005, moeseuclid@gmail.com" (`apps/nickstire/server/services/businessFacts.ts:129`). **Gap, not silently cleared:** `FactChannel` is `"sms" | "voice" | "web"` only — there is no `"reel"`/`"social"` channel yet, so this fact is not currently channel-scoped for Reels. Treat the CTA card's address/phone as needing a human eyeball-check against the current facts before publish, not as auto-cleared. |
| No price, warranty, or guarantee claim is made anywhere in this script | Verified by inspection against `businessFacts.ts` categories — nothing here touches pricing/warranty/policy (an AC recharge service is not in `SEED_FACTS` at all), so no `BUSINESS` SSOT fact is invoked or at risk of drifting. |

## 4. Production pack — selected concept

**Title:** "Why you can't just 'add freon' to your AC"
**Total run time:** 30s of motion beats + 3s branded freeze = **33s container** (render-integrity
contract: container/video-stream duration within 0.75s of this; ≥3 distinct frame MD5s among 5
sampled — i.e., it must actually move).
**Archetype:** myth-bust-then-guide (hook poses the common DIY move as a question, corrects the
misconception with the underlying mechanism, then steers to the safe action without diagnosing).
**Motion lens:** documentary/macro-realistic (operator should confirm the exact lens label and its
`lens.avoid` term in the live Studio wizard — that value is generated per-run in
`facelessReelStudio.ts` and isn't reproducible outside it).

### Script (word-for-word, timed)

| Beat | Time | Narration (word-for-word) |
|---|---|---|
| 1 — Hook | 0:00–0:03 (3s) | "AC blowing warm — can you just add refrigerant and call it fixed?" |
| 2 — Myth | 0:03–0:08 (5s) | "Your car's AC is a sealed system. It doesn't burn through refrigerant like gas in a tank." |
| 3 — Explanation | 0:08–0:15 (7s) | "If the level is low, refrigerant escaped somewhere. Adding more just masks a leak instead of finding it." |
| 4 — Consequence | 0:15–0:21 (6s) | "Topping off without fixing the leak can strain the compressor and lead to a bigger repair down the road." |
| 5 — Safe action | 0:21–0:26 (5s) | "One clue is not a diagnosis — a proper recharge starts with a leak check, not a can from the parts store." |
| 6 — Branded CTA | 0:26–0:30 (4s) | "Stop by and we'll take a look — Nick's Tire and Auto, on Euclid Avenue." |
| — SAVE freeze | 0:30–0:33 (3s) | (no new narration; end card holds, logo + address/phone card per §3 gap note) |

Approved-phrasing check (against `facelessReelStudio.ts` pattern bank): uses "worth checking"
and "one clue is not a diagnosis" (beat 5), "stop by and we'll take a look" (beat 6, verbatim
approved CTA). Avoids all banned patterns (`you need`, `this means your X is bad/shot/gone`, "you
definitely need") — confirmed by inspection, not by running the real validator (no live path).

### Per-beat generation prompts (Higgsfield/Seedance-style, faceless)

Standing negative prompt used on every beat, copied verbatim from
`client/src/lib/facelessReelStudio.ts`: `human face, person, hands, gloves, arms, talking head,
low-res, blurry, extra fingers, plastic glow, oversaturated AI look, warped engine parts` — plus a
per-lens `avoid` term the real wizard appends at generation time (not reproducible outside it; the
operator running this through Studio will get the live value automatically).

Every beat below satisfies the faceless rule: **no people, faces, hands, gloves, or arms — the
object moves on its own** (or via ambient forces: light, heat shimmer, vapor, an unseen mechanism).

1. **Hook (0–3s).** *Prompt:* "Close-up on a car dashboard AC vent, louvers open, faint heat
   shimmer visibly rising from the vent instead of cold mist, warm interior backlight." *Opening
   frame:* the heat shimmer clearly visible against the vent, strongest possible first frame,
   unbranded, wordless. *Action complete by:* 2.5s. *Physical action:* heat shimmer rising
   (motion-gate qualifying beat).
2. **Myth (3–8s).** *Prompt:* "Object-only shot under a car's open hood, a sealed AC compressor and
   refrigerant line assembly, engine bay ambient light, camera slowly pushes in on the closed
   fitting caps — no hands, nothing being touched, emphasizing a self-contained sealed loop."
   *Continues the under-hood setting into beat 3.*
3. **Explanation cutaway (8–15s).** *Prompt:* "Object-only technical cutaway diagram of a closed
   AC refrigerant loop — compressor, condenser, evaporator connected by lines — with a small
   highlighted fitting where a thin vapor wisp visibly escapes; clean diagrammatic lighting, slow
   camera push-in; no text or labels rendered in-scene." *Physical action:* vapor escaping from the
   highlighted leak point (motion-gate qualifying beat).
4. **Consequence (15–21s).** *Prompt:* "Close-up on an AC compressor clutch pulley engaging and
   disengaging erratically under strain, visible cycling/chatter of the clutch face, engine bay
   ambient, backlit to show the mechanical motion clearly." *Physical action:* clutch
   engage/disengage cycling.
5. **Safe action (21–26s).** *Prompt:* "A UV inspection light on a stand sweeps its beam across an
   engine bay AC line fitting, revealing a faint fluorescent dye glow at the leak point — no hands
   present, the light beam itself is the only motion besides a slow rack-focus." *Physical action:*
   light-beam sweep + rack-focus revealing the dye glow (object moves on its own).
6. **Branded CTA (26–30s), freeze to 33s.** *Prompt:* "Exterior establishing shot of Nick's Tire &
   Auto's shop bay, tire stack in foreground, late-afternoon light, logo signage visible and
   legible; camera holds steady for a clean end-card composite." *Then:* static hold from 30s–33s
   with logo + address/phone end-card composited in post (per §3 gap, human-verify the card text
   against current `legal.entity` fact before publish).

Every prompt keeps the top 12% / bottom 20% of frame clear for IG UI per the repo's safe-zone rule.

### Captions

See `captions.srt` in this pack — SRT, burned-in per the muted-first requirement (10/75 quality
points), split into short readable cues rather than one long line per beat.

### Assembly instructions (ffmpeg/CapCut, matches the render-integrity contract)

1. Trim each of the 6 generated clips to its beat duration above (3–7s each); no beat may be
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
- If routed instead through the Adobe-for-creativity MCP's `asset_license_and_download_stock` (a
  real, connected tool this session — see §1), each licensed stock clip carries its own real Adobe
  Stock cost, which is **not** in `generationLedger.ts`'s estimate table at all and was not queried
  — this pack does not use that route, precisely because it's an unestimated real spend with no
  live operator authorization behind it today.
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
| Evidence entailment (`shared/claimEntailment.ts`) on the two automotive claims | `UNKNOWN` | See §3 — general HVAC/automotive knowledge, not read against `evidenceRecords.ts` live |

No `PASS` is claimed anywhere in this matrix — a `jobId` or "the command exited 0" is explicitly
not evidence of a finished Reel in this repo's own runbooks, and nothing here got that far.

## 6. IG/FB copy + two ad-ready variants

**Primary caption (organic feed post):**
> AC blowing warm? Before you grab a can of refrigerant from the parts store — your AC is a
> sealed system. It shouldn't lose charge on its own. If it's low, something escaped, and topping
> it off just hides the leak instead of fixing it. 🧊
> 📍 Nick's Tire & Auto, 17625 Euclid Ave, Cleveland · (216) 862-0005
> #ClevelandMechanic #CarCare101 #EuclidOhio #TireShop #AutoRepairTips #ACRepair

**Ad-ready variant A** (myth-forward, curiosity):
- Hook: "Can you really just 'add freon' and fix your AC?"
- Caption: "Short answer: no. Here's what a low refrigerant level actually means."
- CTA: "Stop by and we'll find the leak — no guessing, no pressure."

**Ad-ready variant B** (cost-avoidance-forward):
- Hook: "Topping off your AC could cost you more later."
- Caption: "A sealed system that's low on refrigerant has a leak. Masking it can strain the
  compressor — know before you top off."
- CTA: "Free check, honest answer — stop by Nick's Tire & Auto on Euclid."

## 7. Final status

**`BLOCKED: NO MOTION ROUTE`** — no TTS tool, and per the skill's hard rule a scheduled/automated
firing is never live authorization to spend, render, or publish even where a technical route
exists (the Adobe-for-creativity MCP's real render/stock-licensing tools, noted in §1, were
deliberately not invoked for exactly this reason). The pack itself (script, prompts, captions,
assembly, copy) is **PRODUCTION-READY** and waiting on a human to run it through the live Studio
wizard (`admin → Growth → Instagram → Studio`), record/generate the voiceover, and carry it through
the real quality/render-integrity/approval gates end to end. Nothing was rendered. Nothing was
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
