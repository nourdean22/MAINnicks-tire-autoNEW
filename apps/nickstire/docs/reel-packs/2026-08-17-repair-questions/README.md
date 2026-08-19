# Reel production pack — "Four questions before you say yes" (TRUSTCHECK)

Scheduled-task run · 2026-08-17 · mode `INTELLIGENCE`/`PRODUCTION` (research + pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **TRUSTCHECK**

This pack follows the reel-operator skill's 9-point receipt shape and the account's real,
data-corrected posting format from `docs/REEL-SLATE-2026-07-31.md` (Hook 0-2s → Setup 2-5s →
Value 5-25s → CTA 25-30s). This topic is a REFERENCE/checklist format — per the slate's own
correction ("saves are the objective for REFERENCE formats... where returning later IS the
value"), the CTA here is SAVE-oriented, not SEND. **No generation, DB read, or publish call was
made against production this run** — see §1 and §9.

---

## 0 · Backlog note (read this before adding another pack)

Before authoring this pack I checked both `apps/nickstire/docs/reel-packs/` (5 merged packs) **and**
open PRs (`gh`/GitHub search for `reel pack` in title, open + draft). Seven scheduled runs in the
last ~6 hours produced seven still-unmerged draft PRs: **#1614** (wheel-bearing-hum), **#1615**
(check-engine-light), **#1616** (balance-vs-alignment), **#1617** (spare-tire-mileage), **#1618**
(coolant-color), **#1619** (cabin-vs-engine-air-filter), **#1620** ("noises that mean stop driving
now") — plus the 5 already-merged packs (penny-test, tire-expiration, tread-fingerprint,
battery-summer-heat, squealing-vs-grinding-brakes). That is **12 of the 20 slate topics** claimed
in under three days, 7 of them sitting in an unreviewed queue with nobody merging or closing them.

This pack picks a topic none of those 12 cover (see §2), so it does not duplicate existing work —
but the operator should know the review queue, not the topic pool, is now the bottleneck. Merging
or closing #1614–#1620 (or lowering how often this scheduled task fires) would do more for this
account than an 8th unreviewed draft.

---

## 1 · Mode, capabilities, repetition context

**Mode:** No live operator instruction authorized generation or publish for this run — this is a
scheduled/automated firing, and the skill's hard rule is explicit that a stored scheduled prompt
does not count as authorization ("Never infer publish permission from a heartbeat, prior approval,
a scheduled task, or a previous post"). This is a pack-only run: `INTELLIGENCE` (topic research +
scoring) + `PRODUCTION` pack authoring, stopping short of any `reel-canary` call.

**Capabilities — probed where possible, stated as unavailable otherwise:**

| Capability | Status |
|---|---|
| `getHiggsfieldAccountHealth()` | **NOT QUERIED** — this is a GitHub-scoped code session with no shell path to the running server or its credentials; no `HIGGSFIELD_*`, `REEL_*`, `ADMIN_API_KEY`, or `DATABASE_URL` present in this environment |
| `REEL_VIDEO_PROVIDER` (live value) | **UNKNOWN, best-known-value cited** — `docs/operations/REEL-PIPELINE.md` states prod reads `template_stock` (verified 2026-08-11 per that doc), i.e. the free local-ffmpeg lane, not paid Higgsfield/Seedance. Not re-read live this run. |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | **UNKNOWN** — if `REEL_AUTOPOST_ENABLED=true`, the 9am daily cron may already have posted today independent of this pack |
| `ADMIN_API_KEY` / `POST /api/admin/reel-canary` | **NOT AVAILABLE** — no admin key in this session; would not be called anyway without a live operator instruction per the hard rule |
| TTS (Google Neural2 / ElevenLabs) | **NOT CONNECTED** to this session |
| Higgsfield (clip generation) | **NOT CONNECTED** to this session |
| Meta/Instagram posting | **NOT CONNECTED**, and deliberately not attempted regardless — protected customer-facing action per root `AGENTS.md`, requires a live, specific operator go-ahead every time |
| Shell/render (ffmpeg) | Not attempted — the real `reelAssembly.ts` pipeline claims a job row out of the **production** TiDB database; running it for real from an unattended session risks claiming or mutating a live job |
| CapCut | **NOT INTEGRATED** — desktop app, no connector exists here |

Net: nothing on the requested tool list (ChatGPT/TTS/Higgsfield/Meta posting/CapCut) is connected
to this session. Per the source instructions' own step 3 ("if tools are missing, produce a
production-ready pack instead"), defaulting to the pack — never claiming a rendered file exists.

**Repetition ledger (`getRecentReelSignals`, 21-day window):** **NOT QUERIED** — the repo's only
`DATABASE_URL` is production TiDB, and this session has no live, authorized path to read it
unattended (`prod-db-guard` skill). What I checked instead, as the required paper substitute:

- `apps/nickstire/docs/reel-packs/` (merged) + open PRs search — see §0. None of the 12 already-claimed
  topics is "questions to ask before authorizing a repair."
- `apps/nickstire/docs/REEL-SLATE-2026-07-31.md` — topic **#20**, "Questions to ask before
  authorizing any repair," is the source for this pack's core content; it is the only slate item
  among the 9 still-unclaimed (#3, #9, #10, #11, #13, #15, #16, #17, #20) that (a) isn't
  winter/cold-season content off-fit for an August post (#3 cold-weather PSI drop, #11 winter
  tires), (b) isn't a near-duplicate of an already-open draft (#10 pothole overlaps the built-in
  `facelessReelStudioSamples.ts` POTHOLE sample's forensic-evidence-scan lens; #13 "pulls to one
  side" is adjacent to open draft #1616 balance-vs-alignment), and (c) is directly grounded in a
  real, sourced business fact rather than general mechanic advice — see §3.
- `apps/nickstire/client/src/lib/facelessReelStudioSamples.ts` — 3 reference samples (PRESSURE,
  POTHOLE, BRAKES). None cover a consumer-trust/checklist topic. **Archetype check:** this pack
  uses a new archetype (`consumer_playbook` / `invoice_reveal`, see §4) rather than reusing
  PRESSURE's `myth_vs_reality`+HUD-scan motif or the forensic-evidence-scan lens already used by
  POTHOLE and by the merged tread-fingerprint pack — deliberately, to avoid a third forensic/HUD
  reel in a row. The real repetition ledger should still confirm this before an operator enqueues it.

**Seasonal note:** today is 2026-08-17 (August, Cleveland) — this topic is evergreen (not
weather-tied), so seasonality is not a factor either way.

---

## 2 · Candidate concepts and scores

Two concepts considered, scored 0–10 per dimension on the sample briefs' rubric (hook / truth /
save / local / absurdity / fit). **These are my own manual estimates, not a live
`calculateReelQualityScore()` or critic-panel run** — flagged honestly, and neither clears the
75-point gate's "winning concept ≥57/60" bonus threshold, which I'm reporting rather than
inflating.

### Concept A — "Four questions before you say yes" (SELECTED)

A shop counter / work-order conceit: a written quote and an old removed part sit side by side as
each of four consumer questions lights up on the paperwork like a checklist being worked through.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 8 | 9 | 10 | 6 | 5 | 10 | **48** |

- **hook 8:** "You're allowed to ask these first" is an empowerment/permission-framing hook —
  strong but not a visual-surprise hook the way a myth-reveal is.
- **truth 9:** every claim is a direct paraphrase of the shop's actual written policy (§3), not a
  generic mechanic fact — about as unimpeachable as a claim gets.
- **save 10:** this is a literal checklist meant to be reopened at a different shop later — the
  single strongest save mechanic among the 9 unclaimed slate topics, and the account's own data
  (§ REEL-SLATE) says saves have been 0.00 across all 8 posted reels so far.
- **local 6:** not Cleveland/weather-specific; the CTA card ties it to the Euclid Ave shop, but the
  content itself is universal.
- **absurdity 5:** deliberately low-concept — this is a trust/utility play, not a hook built on a
  surprising visual metaphor, so it scores lower on "useful absurdity" than the HUD/myth pieces.
- **fit 10:** directly reflects Nick's actual operating policy (`repair.pricing_policy` in
  `businessFacts.ts`: "never quote a number blind — free check, written quote, you don't pay until
  you say yes") — as on-brand as content gets.

### Concept B — "Tire rotation" (parked)

Slate topic #17. Scored for comparison only.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 6 | 8 | 7 | 5 | 4 | 8 | **38** |

Lower on every dimension except a marginal truth edge — parked, not pursued further this run.

**Decision:** Concept A, on save-potential and direct grounding in a real, sourced shop policy
(§3), despite the lower absurdity/hook scores. Given the account's measured save rate is 0.00
across 8 reels, a topic whose entire premise is "reopen this later" is worth testing even without
a flashy hook.

---

## 3 · Claim evidence

Every substantive claim in this pack traces to a real file, not invention. `UNKNOWN`s are listed,
not omitted.

| Claim | Source | Status |
|---|---|---|
| "Free check, written quote, you don't pay until you say yes" | `apps/nickstire/server/services/businessFacts.ts:80-83`, `factKey: "repair.pricing_policy"`, category `policy`, source "BUSINESS operating model + brand voice", approved by Nour, verified 2026-07-21, channels `sms/voice/web` | **SUPPORTED** — read directly from the SEED_FACTS source (git-versioned code, not a DB row I queried) |
| "Can you show me the part? / What happens if I wait? / Is this safety or maintenance? / Can I have the old part back?" | `apps/nickstire/docs/REEL-SLATE-2026-07-31.md`, topic #20 (brand-voice-approved caption, screened by `scripts/lint-brand-voice.ts` when originally written) | **SUPPORTED** — reused verbatim from an already-approved caption; this pack adds a beat/motion structure the caption alone doesn't carry |
| "A good shop will not flinch" at these questions | Same slate caption (#20) | **SUPPORTED** — carried forward from the approved text, not a new assertion |
| Shop identity for the CTA card (name, address, phone) | `businessFacts.ts:129-132`, `factKey: "legal.entity"` — "Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112, (216) 862-0005" | **SUPPORTED** |
| No price is quoted in-frame | N/A — deliberate compliance with the claim-safety rule in `facelessReelStudio.ts` validators (no prices in-reel) | **BY DESIGN**, not a sourced claim |
| `EvidenceRecord`/`evidenceResolver.ts` entailment for these claims | Not read this run | **UNKNOWN** — these are policy/consumer-advice statements, not mechanic-diagnosis claims, so `evidenceResolver.ts` (built for claim-level mechanic/safety entailment) is likely the wrong tool for this topic; flagged rather than assumed |
| `FactChannel` coverage for a Reel/social post | `businessFacts.ts:31` — `FactChannel` is `"sms" | "voice" | "web"` only, no `"reel"`/`"social"` channel | **GAP, confirmed** — `repair.pricing_policy` and `legal.entity` are both scoped to `sms/voice/web`/`web` respectively, not `reel`. Per the skill's own instruction, this is a real gap to flag, not silently treat as cleared — an operator should confirm these facts are fine for public video use before this pack is enqueued, even though the "web" channel already means the same text is public-facing |

---

## 4 · Full production pack

**Format:** faceless, motion-first, REFERENCE/checklist. **Standing negative prompt for every
beat** (per the operator spec and the M10 preflight rule — Seedance cannot spell and must not
attempt to): `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`. All
on-screen words below are ffmpeg caption overlays composited in post, never generated by the video
model.

**Archetype:** `consumer_playbook` · **motionLens:** `invoice_reveal` · **objectCharacter:**
`the_written_quote` (a single hero prop — the work-order/quote sheet — anchors every beat for
visual continuity, matching the account's "one hero object across every beat" image-conditioning
pattern). **factBucket:** `trust_playbook`. **campaignKeyword:** `TRUSTCHECK`.

### Script — word-for-word narration, timed

| Time | VO line |
|---|---|
| 0:00–0:02 | "You're allowed to ask these — before you say yes to any repair." |
| 0:02–0:05 | "Any shop, not just this one." |
| 0:05–0:10 | "One. Can you show me the part?" |
| 0:10–0:14 | "Two. What happens if I wait?" |
| 0:14–0:18 | "Three. Is this safety, or is it maintenance?" |
| 0:18–0:22 | "Four. Can I have the old part back?" |
| 0:22–0:26 | "A good shop won't flinch. Free check, written quote — you don't pay until you say yes." |
| 0:26–0:30 | "Save this. Bring it to your next appointment — anywhere." |

Total runtime: **30 seconds** (Hook 0–2s → Setup 2–5s → Value 5–25s → CTA 25–30s), matching the
slate's own beat model and the render-integrity gate's "beats + 3s SAVE freeze" contract (last
2–3s holds on the CTA card).

### Storyboard beats (8 beats — within the product's 5–8 purposeful-visual-beats floor)

| # | Time | Visual (Higgsfield-style prompt) | Motion | On-screen text (ffmpeg overlay) | Purpose |
|---|---|---|---|---|---|
| 1 | 0:00–0:03 | Extreme macro: a worn, removed auto part (e.g. a brake pad down to the backing plate) resting on a wooden shop counter next to a blank work-order clipboard; soft directional shop light | Slow push-in on the part | "You're allowed to ask these first" | Hook — scroll-stop with an unresolved object |
| 2 | 0:03–0:06 | Pull back to reveal the full counter: clipboard, pen resting (not held — no hand), the old part, a coffee ring | Slow dolly-back reveal | "Before you say yes — any shop" | Setup — establishes the "counter" world every later beat shares |
| 3 | 0:06–0:10 | Macro on the clipboard; a checkbox glows/highlights as if being checked (motion graphic, not a hand) next to handwriting-style print reading a question mark icon | Reticle/highlight sweeps onto checkbox 1 | "1. Can you show me the part?" | Value — question 1, tied visually to the part from beat 1 |
| 4 | 0:10–0:14 | Same counter; a small desk calendar prop in frame, a page visibly turning/flipping forward | Page-flip motion, checkbox 2 highlights | "2. What happens if I wait?" | Value — question 2, urgency motif via the calendar, not fear-mongering visuals |
| 5 | 0:14–0:18 | Split-frame: left half a caution-tape-yellow swatch, right half a plain grey maintenance-tag swatch, both resting on the counter | Left/right highlight alternates, checkbox 3 highlights | "3. Safety or maintenance?" | Value — question 3, visual binary without naming a specific defect (claim-safety: no diagnosis asserted) |
| 6 | 0:18–0:22 | Macro: the old part (from beat 1) being set into a small clear zip bag on the counter | Slow deliberate placement motion (prop-only, no hand) | "4. Can I have the old part back?" | Value — question 4, closes the loop on the beat-1 hero prop |
| 7 | 0:22–0:26 | Wide shot of the counter: clipboard now shows all 4 checkboxes lit, a written quote sheet slides fully into frame | Quote sheet slide-in, gentle glow on the total-line area (no dollar figure rendered) | "Free check · written quote · you decide" | Consequence/proof — the shop's actual policy, tied to `repair.pricing_policy` |
| 8 | 0:26–0:30 | Branded CTA card: shop name, Euclid Ave address, phone — static end-card composited in post (not model-generated text) | Static hold (the "3s SAVE freeze") | "📌 Save this. Bring it to your next appointment." | CTA — save-oriented per REFERENCE-format guidance |

**Continuity note:** one hero prop (the old part) and one environment (the shop counter) recur
across beats 1, 3, 6 — matching the account's proven `REEL_IMAGE_CONDITIONING` pattern (a single
locked hero frame passed as `--start-image` to keep object/environment consistent), even though
this pack does not call that route itself.

### Assembly instructions (ffmpeg/CapCut)

1. **Trim** each of the 8 clips to its listed duration; label $shop-counter-context$ so a human
   editor keeps framing consistent if re-shooting any beat.
2. **Order & concatenate** beats 1→8 with short crossfades (`xfade`, ~0.3–0.4s) between beats —
   avoid the `zoompan`/stills-filter and `tpad` freeze-clone pitfalls the render-integrity gate
   (`#800/#801`) exists to catch (see `docs/operations/REEL-PIPELINE.md` "Render-integrity gate").
3. **Caption overlay layer:** burn in the 8 on-screen-text lines above as timed ffmpeg `drawtext`
   or subtitle-burn overlays (gold/black brand style per the account's existing overlay pattern) —
   never let the video model attempt to render this text itself.
4. **Voiceover:** lay the 30s VO track (script above) as the primary audio bed, ducked under a
   light instrumental music bed for beats 3–7 (see §6 for the rights gap on that music bed).
5. **CTA end-card (beat 8):** hold 3 full seconds on the static branded card — this is the "beats +
   3s SAVE freeze" the render-integrity gate checks container/video-stream duration against.
6. **Export:** 1080×1920 (9:16), H.264, 30s target — matches the pipeline's own output contract
   (15–30s range; this pack lands at the slate's standard 30s beat model).
7. **QA before calling it finished:** run the manual forensics recipe from
   `docs/operations/REEL-PIPELINE.md` (`ffprobe` video-stream duration + 5-frame MD5 sampling) —
   ≥3 distinct MD5s proves motion; identical MD5s across samples means a frozen/still export, which
   must not ship as a finished Reel.

---

## 5 · Credit-risk and fallback routing

- **Provider pin (best-known, not re-read live this run):** `REEL_VIDEO_PROVIDER=template_stock`
  per `docs/operations/REEL-PIPELINE.md` (verified there 2026-08-11) — the free local-ffmpeg lane,
  **not** paid Higgsfield/Seedance.
- **Per-clip cost at that pin:** `COST_ESTIMATES_USD.template_stock_clip = $0` (`generationLedger.ts:31`)
  — if this pack were enqueued today at the current pin, its estimated marginal generation cost is
  **$0** for all 8 beats. This is an estimate read from operator-tunable source constants, not a
  live metered figure — flagged as such per `generationLedger.ts`'s own comments.
- **If the pin were Higgsfield/Seedance instead:** `COST_ESTIMATES_USD.seedance_clip = $0.25`
  (labeled ASSUMPTION in source) × up to 8 beats ≈ **$2.00 estimated**, well under the
  `maxGenerationCostPerDayUsd` policy limit ($10/day per the runbook's guardrail table) — but this
  branch does not apply while the pin is `template_stock`.
- **Daily guardrails this run does NOT touch (informational only):** `RESERVATION_FEED_CAP` (2
  posts/day), `RESERVATION_SPACING` (3h), `REPEAT_CTA` (72h), `REPEAT_TOPIC` (7 days),
  `BUDGET_DAILY_EXCEEDED` ($10/day) — none evaluated this run since no `enqueueReelJob` call was
  made; an operator enqueuing this pack will hit these in order per
  `docs/runbooks/reel-pipeline.md`.
- **Fallback flag:** `REEL_FALLBACK_TO_TEMPLATE_STOCK` — moot for this pack while the pin is
  already `template_stock`.

---

## 6 · Audio/music rights — real gap

Per the skill's own documented gap: **no rights ledger for music exists in this repo.** The VO
track routes through `reelVoice.ts` when generated for real (not attempted this run — no TTS tool
connected). Any instrumental music bed suggested for beats 3–7 in §4 step 4 is **UNKNOWN/BLOCKED**
for rights clearance — this pack does not name a specific track, and an operator must source and
clear one (or use a royalty-free bed already cleared for this account) before publish. This is
reported as a gap, not silently dropped from the pack.

---

## 7 · QA matrix

Nothing was rendered this run, so every render-dependent gate is `BLOCKED` by construction — not
a defect, the expected state for a pack-only run.

| Gate | Status | Backing read |
|---|---|---|
| M10 preflight (in-frame text / "free" claim / faceless violations) | **UNKNOWN** | Not run — no `enqueueReelJob`/`reelDraftPrep` call made. Self-check: beat prompts above name no price, no real person, no in-frame text — consistent with what M10 checks for, but this is not the same as the deterministic gate having run |
| Render-integrity gate (#800/#801 — duration, frame count, motion-proof MD5s) | **BLOCKED** | No render exists to check |
| Rendered QA (M11 vision critic) | **BLOCKED** | No rendered frames exist |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED** | No `jobId` exists to evaluate |
| Claim-safety validators (`facelessReelStudio.ts`) | **PASS (self-check only, not the real validator)** | Script contains no price, no guarantee language, no diagnosis of a specific vehicle defect — matches the approved soft-language pattern bank's intent, but was not run through the actual TS validator function |
| Brand-voice lint (`scripts/lint-brand-voice.ts`) | **UNKNOWN** | Not run this session against this specific script text (the 4 questions + policy line are reused verbatim from an already-lint-passed slate caption; the connecting VO lines around them are new and unverified) |

---

## 8 · IG/FB copy + ad-ready variants

**Primary caption (as planned for organic IG/FB post):**

> You are allowed to ask these. A good shop will not flinch.
>
> Can you show me the part? What happens if I wait? Is this safety or maintenance? Can I have the
> old part back?
>
> Any shop that will not answer plainly is telling you something.
>
> 📌 Save this and bring it to your next appointment. Anywhere, not just here.
>
> #autorepair #cartips #clevelandohio #euclidohio

**Ad-ready variant 1 (hook-forward):**

- Hook: "4 questions your mechanic hopes you never ask."
- Caption: Same body as primary.
- CTA: "Save this before your next repair quote."

**Ad-ready variant 2 (policy-forward):**

- Hook: "Free check. Written quote. You decide."
- Caption: "That's the whole policy. No repair happens until you say yes — and you're allowed to
  ask these 4 questions first: [list]."
- CTA: "Save this. Bring it anywhere."

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

This pack is a hand-authored script + storyboard + assembly spec, grounded in a real sourced
business fact (§3) and reusing an already brand-voice-approved caption (slate #20). It has **not**
been compiled through `reelBriefGen.ts`, scored by the live `calculateReelQualityScore()`, run
through M10 preflight, rendered, or QA'd — so it cannot be `PRODUCTION-READY` in the pipeline's own
sense, and nothing here was published (`PUBLISHED WITH READ-BACK` does not apply). An operator who
wants this live should feed the topic ("Questions to ask before authorizing any repair" /
`TRUSTCHECK`) into a live `POST /api/admin/reel-canary {action:"start"}` call, or hand this script
to a human editor for manual assembly — and first resolve the review backlog in §0.
