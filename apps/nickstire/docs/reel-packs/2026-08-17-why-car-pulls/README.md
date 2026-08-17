# Reel production pack — "The wheel is straight. The car isn't." (PULLING)

Scheduled-task run · 2026-08-17 · mode `INTELLIGENCE`/`SCHEDULED` (research + pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **PULLING** · slate item
#13, `docs/REEL-SLATE-2026-07-31.md`

This pack follows the reel-operator skill's 9-point receipt shape and the account's documented
posting format (Hook 0-2s → Setup 2-5s → Value 5-25s → CTA 25-30s + 3s SAVE freeze, SEND-oriented
CTA, no in-frame AI-generated text). **No generation, DB read, or publish call was made against
production this run** — see §1 and §9.

---

## 1 · Mode, capabilities, repetition context

**Mode.** This is an automated scheduled firing with no live operator present. The skill's hard
rule is explicit that a stored scheduled prompt is not authorization to generate, spend, or
publish: *"Never infer publish permission from a heartbeat, prior approval, a scheduled task, or a
previous post."* This run stops at `INTELLIGENCE` (topic selection) + `PRODUCTION` pack authoring
— no `reel-canary` call was attempted.

**Capabilities — checked this session, not assumed:**

| Capability | Status |
|---|---|
| LLM (script/copy authoring) | **AVAILABLE** — this session |
| TTS (Google Neural2 / ElevenLabs, `reelVoice.ts`) | **NOT CONNECTED** — no TTS tool wired to this session |
| Higgsfield (clip generation) | **NOT CONNECTED** — no Higgsfield tool, and `env` here has no `HIGGSFIELD_*` var set |
| Meta/Instagram posting | **NOT CONNECTED**, and deliberately not attempted regardless — protected customer-facing action per root `AGENTS.md`, requires a live, specific operator go-ahead every time |
| Shell/render (ffmpeg) | **NOT AVAILABLE** — checked directly: `which ffmpeg` → not found in this container |
| `ADMIN_API_KEY` / `/api/admin/reel-canary` | **NOT AVAILABLE** — `env \| grep -i admin_api_key` returned nothing; this is a GitHub-scoped code session, not one attached to the Railway deployment |
| `DATABASE_URL` (prod TiDB) | **NOT SET** in this session's env — confirmed by direct check, not assumed |
| `REEL_VIDEO_PROVIDER` / `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` (live values) | **UNKNOWN** — not queryable from here; `docs/operations/REEL-PIPELINE.md` last documented prod pinned to `template_stock` |
| CapCut | **NOT INTEGRATED** — desktop app, no connector exists here |

Net: nothing on the requested tool list (ChatGPT/TTS/Higgsfield/Meta posting/CapCut/render) is
connected to this session — verified directly (`which ffmpeg`, `env` grep), not inferred. Per the
scheduled prompt's own step 5 ("if tools are missing, produce a production-ready pack instead") and
the skill's stronger hard rule (a scheduled firing never gets `PUBLISH` regardless of tool
availability), this run defaults to a pack.

**Repetition context — paper check, no live DB access:**

- `getRecentReelSignals()` (21-day live ledger): **NOT QUERIED** — no DB path from this session.
- Checked instead: `ls apps/nickstire/docs/reel-packs/` (merged packs) — `penny-test`,
  `tire-expiration`, `tread-fingerprint`, `battery-summer-heat`, `squealing-vs-grinding-brakes`.
- Checked open, unmerged reel-pack PRs via `gh`-equivalent search (`search_pull_requests`,
  `list_pull_requests`) — the directory listing alone is blind to drafts still in flight, exactly
  the failure mode PR #1611 documented. Open today: #1614 wheel-bearing-hum, #1615
  check-engine-light, #1616 balance-vs-alignment, #1617 spare-tire-mileage, #1618 coolant-color,
  #1619 cabin-vs-engine-air-filter, #1620 noises-that-mean-stop-driving-now, #1621
  repair-authorization-questions.
- Cross-referenced both lists against all 20 titles in `docs/REEL-SLATE-2026-07-31.md`. Remaining
  **uncovered** slate items as of this run: #3 cold weather/tire light, #9 oil change intervals,
  #10 pothole damage you cannot see (a *sample* — not a produced pack — already exists for this
  theme in `facelessReelStudioSamples.ts`, so treated as higher-overlap-risk and skipped), #11
  all-season vs winter tires, **#13 why the car pulls to one side (SELECTED)**, #15 what "you need
  struts" actually means, #16 tread depth for rain vs snow, #17 tire rotation.
- **Why #13 over the other open slots:** #3 and #11 are winter/seasonal framed and it's mid-August
  — a seasonal mismatch the battery pack (2026-08-16) already flagged and worked around once; #13
  needs no such reframe. #13 is also evergreen (not weather-gated), safety-relevant (a pull can be
  dangerous at speed), and its approved caption already gives a clean, non-alarmist 3-way diagnostic
  structure that fits this pipeline's beat format without inventing new claims.
- **Archetype/lens overlap check:** merged packs used no `diagnostic_hud_reveal` archetype (tire
  expiration used an "overlooked label" motif; tread-fingerprint explicitly parked
  `pov_you_are_the_part` as recently reused; the battery pack used `myth_vs_reality` +
  `warning_light_world`/`xray_cutaway`/`product_ad_macro`). This pack uses `diagnostic_hud_reveal` +
  `blueprint_technical`/`xray_cutaway` — new archetype, one shared lens (`xray_cutaway`, already
  used twice across two prior packs, so a third use is a soft flag for the operator, not a hard
  block). **A live `getRecentReelSignals()` read is still the real gate before enqueue** — this is
  a paper substitute, not equivalent to it.

---

## 2 · Candidate concepts and scores

Two concepts considered, scored 0–10 per dimension on the samples' rubric (hook / truth / save /
local / absurdity / fit). **These are manual estimates, not a live `calculateReelQualityScore()` or
critic-panel run** — flagged honestly in §5, not presented as an authoritative score.

### Concept A — "Blueprint pull-vector" diagnostic reveal (SELECTED)

Cold open on a top-down technical schematic of a car on a straight road; the car's motion-vector
line bends off center even though the wheel is drawn dead straight. The reveal walks the slate's
own two-branch diagnostic (brake-triggered vs. constant) and lands on "check pressure first — it's
free."

| hook | truth | save/send | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 8 | 9 | 8 | 5 | 4 | 10 | **44** |

Below the skill's `≥57/60` sub-threshold for "winning concept" — carried into §5's honest
accounting, not hidden.

### Concept B — Straight slate-caption read (parked)

Render the slate's existing caption verbatim as VO with a generic driving b-roll, no HUD/blueprint
device. Parked because it leans on stock "car driving down road" footage that reads as flatter and
more generic than the schematic device, even though it is the lowest-effort, zero-new-claim option.

| hook | truth | save/send | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 5 | 9 | 7 | 5 | 2 | 10 | **38** |

---

## 3 · Claim evidence

No live `evidenceResolver.ts` / `EvidenceRecord` lookup ran (no DB access this session) — every
entailment below is **`not_evaluated`** in the pipeline's own vocabulary, not `supported`.

| Claim in this reel | Source note (label only) | Kind | Entailment |
|---|---|---|---|
| A pull that changes with brake application typically points to uneven brake force (a sticking caliper or uneven pad wear between the two front wheels) | Standard mechanical diagnostic heuristic; already brand-voice-approved wording, `docs/REEL-SLATE-2026-07-31.md` item #13 | proof (pre-approved) | not_evaluated |
| A pull that is constant regardless of braking typically points to alignment or uneven tire pressure | Same source, item #13 | proof (pre-approved) | not_evaluated |
| Checking tire pressure is a free, low-effort first diagnostic step | Same source, item #13 ("Check pressure first. It is free and it is often the answer.") | proof (pre-approved) | not_evaluated |
| Drivers often assume a pull means an expensive alignment problem before checking simpler causes | Common-knowledge framing, not a shop-specific claim | pain_point | not_evaluated |

No `businessFacts.ts` row was pulled — this script states no shop price, warranty, or hours beyond
the standard CTA contact block, so the skill's flagged gap ("no `reel`/`social` channel in
`FactChannel` yet") doesn't block anything here by design.

**No claim in this pack states a diagnosis as certain.** Every diagnostic line uses the approved
soft-language bank from `client/src/lib/facelessReelStudio.ts` — *can point to · worth checking · do
not guess* — never "you need alignment" or "this means your brakes are shot."

---

## 4 · Production pack

### Storyboard (30s: Hook 0-2 → Setup 2-5 → Value 5-25 → CTA 25-30 + 3s freeze = 33s runtime)

**Note on runtime contract:** this matches the account's actual documented/posted format
(`docs/REEL-SLATE-2026-07-31.md`'s `Hook 0–2s → Setup 2–5s → Value 5–25s → CTA 25–30s` plus the
render-integrity gate's `beats + 3s SAVE freeze`), which the two most recent merged packs
(2026-08-16 battery, brakes) both follow. This is 11s longer than the `REEL_OUTPUT_RULES` code
constant (`minSeconds: 15, maxSeconds: 22`) in `facelessReelStudio.ts` — a real discrepancy between
that constant and the slate's actual practice, flagged here rather than silently resolved either
way; an operator should confirm which one governs before enqueueing.

Archetype: **diagnostic_hud_reveal**. Motion lenses: **blueprint_technical** (top-down schematic,
carries the hook/setup/CTA and the loop seam) and **xray_cutaway** (the brake-caliper and
tire/alignment value beats).

| Beat | Time | Visual | On-screen overlay (ffmpeg, not AI-generated) | Voiceover (word-for-word) |
|---|---|---|---|---|
| 1 · Hook | 0:00–0:02 | Top-down blueprint-technical schematic: a car icon on a straight dashed-centerline road, a thin glowing motion-vector line trailing behind it bends visibly off-center | — | "The wheel is straight. The car isn't." |
| 2 · Setup | 0:02–0:05 | Same schematic, camera pushes in on the bending vector line as it pulses | — | "A pull like this has more than one cause." |
| 3 · Value 1 | 0:05–0:10 | X-ray cutaway into a front brake caliper and rotor, one side glowing hot/uneven against the other, cool schematic lighting | "BRAKING-ONLY PULL" | "Only pulls when you brake? That can point to the brakes." |
| 4 · Value 2 | 0:10–0:15 | X-ray cutaway into a wheel's alignment geometry (toe angle skewing) dissolving into a tire cross-section with uneven pressure on one side | "CONSTANT PULL" | "Pulls all the time? That can point to alignment — or just tire pressure." |
| 5 · Value 3 | 0:15–0:20 | Product-ad macro on a tire valve stem, an abstract analog needle/dial sweeping (no legible digits — numbers are never asked of the generator) | "CHECK PRESSURE FIRST" | "Check pressure first. It's free, and it's often the answer." |
| 6 · Value 4 | 0:20–0:25 | Back to the blueprint schematic, the vector line flickers between "bent" and "straight" states | "CHANGING = SOONER · STEADY = SOON, NOT BLIND" | "Changing pull, worth checking soon. Steady and mild can wait — but do not guess." |
| 7 · CTA | 0:25–0:30 | Blueprint schematic vector line straightens fully, mirrors beat 1's opening framing (loop seam) | "WORTH CHECKING." then CTA card fades in | "Worth checking before it becomes a bigger fix." |
| 8 · SAVE freeze | 0:30–0:33 | Static hold on the CTA card | "Send this before you book anything.\nStop by — we'll check pressure and take a look, free.\nNick's Tire & Auto · 17625 Euclid Ave, Cleveland · (216) 862-0005" | (silent — ambient tone only) |

Standing negative prompt for every beat, per the pipeline's real M10 preflight contract: **faces,
hands, human figures, on-screen text, logos, watermarks, subtitles**. No steering-wheel-grip or
brake-pedal-foot visual is used anywhere (both would trip the faceless/limb-actor gate) — the
diagnosis is told entirely through the schematic and cutaway devices. No real person's name appears
anywhere in this script.

### Full voiceover script, timed

```
[0:00–0:02] The wheel is straight. The car isn't.
[0:02–0:05] A pull like this has more than one cause.
[0:05–0:10] Only pulls when you brake? That can point to the brakes.
[0:10–0:15] Pulls all the time? That can point to alignment — or just tire pressure.
[0:15–0:20] Check pressure first. It's free, and it's often the answer.
[0:20–0:25] Changing pull, worth checking soon. Steady and mild can wait — but do not guess.
[0:25–0:30] Worth checking before it becomes a bigger fix.
[0:30–0:33] (silent hold — CTA card only)
```

71 spoken words over 30s (≈2.4 words/sec) — comfortable at both the Google Neural2-J and ElevenLabs
default paces the real `reelVoice.ts` uses, and close to the battery pack's measured ~2.0 wps.

### Visual sourcing — pick ONE route before rendering

`template_stock` (the prod-pinned free lane per `docs/operations/REEL-PIPELINE.md`) generates
abstract Ken-Burns moves over a solid/gradient backdrop — it cannot render a top-down schematic or
an x-ray cutaway. This concept needs the blueprint and cutaway visuals to read at all, so
`template_stock` alone will not carry it. Real options, in recommended order:

1. **Higgsfield/Seedance clip generation** (currently NOT the prod-pinned route — would need
   `REEL_VIDEO_PROVIDER` flipped back). Estimated cost: `$0.25/clip × 6 clips ≈ $1.50`, per
   `generationLedger.ts`'s `COST_ESTIMATES_USD` (labeled an ASSUMPTION in that source's own
   comment, not a metered price). Prompt pack below.
2. **Licensed motion-graphics template** (a stock After Effects/Motion "schematic HUD" template with
   the car icon and vector line swapped for brand colors) — plausible fallback for beats 1, 2, 6, 7
   specifically, since those are graphic-design elements rather than photoreal footage. I have not
   sourced or verified a specific template or its license terms; the operator would need to.
3. **Shop-shot footage** does not fit this concept well — there is no photographable "pull," caliper
   x-ray, or blueprint schematic on a phone camera. Not a practical route here (unlike the battery
   pack, where beats 6/8 were shootable).

**Higgsfield-style prompt pack (route 1, if activated):**

| Beat | Prompt | Negative prompt |
|---|---|---|
| 1 | Top-down technical blueprint schematic of a car icon on a straight dashed-line road, a thin glowing cyan motion-trail line bending off-center behind it, dark blueprint-blue background, clean vector-line aesthetic | faces, hands, human figures, on-screen text, logos, watermarks, subtitles |
| 2 | Same top-down blueprint schematic, camera pushes in on the bending glowing motion-trail line as it pulses | (same) |
| 3 | Technical x-ray cutaway of a car's front brake caliper and rotor, translucent layered materials, one side glowing amber-hot against a cool blue opposite side, precise engineering lighting | (same) |
| 4 | Technical x-ray cutaway of a wheel's alignment geometry, the toe angle visibly skewing off true, dissolving into a tire cross-section showing uneven internal pressure on one side, clean schematic lighting | (same) |
| 5 | Premium product macro shot of a tire valve stem, 85mm lens, shallow depth of field, an abstract analog gauge needle sweeping with no legible numerals, dark studio background | (same) |
| 6 | Top-down blueprint schematic again, the glowing motion-trail line flickering between a bent state and a straight state, dark blueprint-blue background | (same) |
| 7 | Top-down blueprint schematic, the glowing motion-trail line settles fully straight, mirroring the beat-1 opening for a loop seam | (same) |

### Assembly (ffmpeg — matches `reelAssembly.ts`'s real technique)

1. **Canvas:** 1080×1920 (9:16), 30fps target.
2. **Concatenate** the 6 motion clips (beats 1, 3, 4, 5, 6, 7 — beat 2 reuses beat 1's clip held
   longer for the push-in) with hard cuts at each beat boundary. A quick dissolve, not a hard cut,
   works better on the 2→3 transition (schematic → x-ray world change).
3. **Caption burn-in:** word-level ASS subtitles synced to the VO timing above. `PlayResX/Y
   1080x1920`, safe zone: keep text inside the middle 60% of frame width, clear of the bottom 20%
   (UI overlap zone).
4. **Overlay text** (drawtext, NOT part of the generated video): "BRAKING-ONLY PULL," "CONSTANT
   PULL," "CHECK PRESSURE FIRST," "CHANGING = SOONER · STEADY = SOON, NOT BLIND," "WORTH CHECKING,"
   and the CTA card in beat 8.
5. **Audio mix:** VO track centered; no music bed by default — see §6 (rights gap). A soft
   HUD-style tick/pulse SFX on each schematic beat transition is a short SFX, not a licensed music
   track, and carries no rights question.
6. **Freeze frame:** hold the final CTA-card frame for exactly 3s after the last spoken word
   (0:30–0:33) — the real render-integrity contract's `beats + 3s SAVE freeze` target.
7. **Render-integrity self-check before calling this "done"** (the real gate, `reelAssembly.ts`
   "#800/#801" — verify with `ffprobe` once a real file exists): container duration within 0.75s of
   33s, video-stream duration within 0.75s of 33s (container duration can lie via the audio track),
   ≥80% of the expected 30fps × 33s frame count, and ≥3 distinct MD5 hashes among 5 sampled frames
   (proves real motion — a static schematic that never animates should fail this, not ship).

---

## 5 · Credit-risk and fallback routing

Estimates only, read from `generationLedger.ts`'s documented `COST_ESTIMATES_USD` constants — the
**live daily budget remaining and account balance are UNKNOWN** (no live read this session; the
`maxGenerationCostPerDayUsd` cap and today's spend against it were not queried).

| Route | Est. cost | Notes |
|---|---|---|
| `template_stock` (prod default) | **$0/clip** | Free, but abstract Ken-Burns backdrops cannot carry a blueprint-schematic or x-ray-cutaway concept — unsuitable as-is (see §4) |
| Higgsfield/Seedance (currently inactive route) | **≈$0.25 × 6 clips ≈ $1.50**, labeled an ASSUMPTION in the source comment, not a metered price | Would need `REEL_VIDEO_PROVIDER` flipped — an operator/config decision, not mine to make |
| Licensed motion-graphics template | Unestimated — no specific asset priced | Plausible for beats 1/2/6/7 only; beats 3-5 (cutaways) still need a generation route |
| TTS (Google Neural2-J or ElevenLabs) | Not itemized in the cost table read | Google lane is free-quota; ElevenLabs is the paid fallback only if Google fails |

**Honest self-score against the real 75-point gate** (weights: first-frame 10 · muted-first 10 ·
beat structure 5 · length 5 · loop 5 · sourced fact 10 · faceless 10 · claim safety 10 · keyword 5 ·
winning-concept bonus 5):

first-frame 7/10 (a bending vector line is a clear "something's wrong" cue but reads more cerebral
than visceral — weaker scroll-stop than a glowing warning icon) · muted-first 7/10 (the on-screen
overlay text is load-bearing here; without it, a viewer scrolling muted may not immediately parse
"brake-only vs. constant" from the schematic alone) · beat structure 5/5 · length 5/5 (matches the
slate's documented 30s+3s contract; flagged against the differing code constant in §4) · loop 4/5
(the straighten-out mirror works but is a subtler loop than a fade-to-black) · sourced fact 8/10
(pre-approved slate wording, not live-entailed) · faceless 10/10 · claim safety 10/10 · keyword 5/5
(`PULLING` is a valid `CampaignKeyword`) · winning-concept bonus 0/5 (Concept A scored 44/60 in §2,
below the stated `≥57/60` sub-threshold) — **estimated total ≈61/75**, below the real gate's 70/75
floor.

That's a genuine finding, not false modesty: the weakest dimensions are first-frame hook and
muted-first legibility — the same structural risk every "diagnostic split" concept carries versus a
single strong visual image. An editor's pass on making the vector-line bend more dramatic in the
first half-second, or reconsidering whether overlay text should appear earlier (beat 1 instead of
beat 3), is worth doing before spending render budget.

---

## 6 · Audio/music rights status

**No music-rights ledger exists in this repo** — a confirmed, repeat gap, not an oversight specific
to this pack. This pack defaults to **no licensed music bed**: VO (Google TTS / ElevenLabs, both
real working lanes with no rights question) plus short SFX (HUD tick/pulse stings) mixed under it.
If the operator wants a music bed, the lowest-friction, zero-rights-question option is Meta's own
built-in royalty-free audio library inside the Instagram/Facebook Reels composer (pre-cleared for
that platform) — no specific track has been selected or verified, since this session has no live
access to browse it.

---

## 7 · QA matrix

| Gate | Verdict | Backed by |
|---|---|---|
| Claim-safety wording (no prices, no guarantees, approved soft language) | **PASS** | Manual check against `client/src/lib/facelessReelStudio.ts`'s approved phrase list — script uses "can point to" / "worth checking" / "do not guess," never states a diagnosis as certain |
| Brand-voice kill list (`shared/voice.ts`) | **PASS (manual)** | Manually checked every VO/caption/hashtag line against the kill-list categories described in prior packs — no obvious hits; **not run through the live linter**, since this session has no path to it |
| Faceless / standing negative prompt compliance | **PASS (by design of the prompts)** | Prompt pack in §4 carries the standing negative prompt on every beat; storyboard deliberately avoids hands-on-wheel or foot-on-pedal visuals |
| Repetition ledger (21-day, live DB) | **UNKNOWN** | Not queried — no live DB access this session (see §1); paper check against merged packs + open PRs done instead |
| Render-integrity gate (`reelAssembly.ts` #800/#801: duration, frame count, motion-proof MD5 check) | **UNKNOWN / N/A** | Nothing was rendered — no file exists to `ffprobe` |
| Rendered QA vision critic (`renderedQa.ts`) | **UNKNOWN** | Not run — requires an actual rendered file and a live call |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED** | Never called — no `reel-canary` access this session, and publish requires live operator authorization regardless (§9) |
| Quality score vs. live 70/75 floor | **FAIL (estimated)** | Manual estimate in §5 is ≈61/75 — below the stated floor. Flagged, not hidden. |

---

## 8 · IG/FB copy — 2 ad-ready variants

Format follows the account's current house style (`docs/REEL-SLATE-2026-07-31.md`): short punchy
lines, a SEND-oriented CTA (this account's posted reels have measured `saved = 0.00`; the corrected
objective is watch time and sends, not saves). Hashtags capped at 4, reusing the slate's own
pre-approved set for item #13, lowercase per the current convention.

### Variant A — SEND-first (primary recommendation, matches the corrected house strategy)

> The wheel is straight. The car isn't.
>
> A pull has more than one cause, and they're not equally urgent. Only pulls when you brake? That
> can point to the brakes. Pulls all the time? That can point to alignment — or just uneven tire
> pressure.
>
> Check pressure first. It's free, and it's often the answer.
>
> Worth checking before it becomes a bigger fix.
>
> #wheelalignment #cartips #autorepair #clevelandohio

### Variant B — Comment-keyword style (matches the older Studio samples' `campaignKeyword` convention)

> Your car is pulling and you don't know why?
>
> A brake-only pull and an all-the-time pull point at different things — one's the brakes, the
> other's alignment or just low tire pressure. Check pressure first, it's free.
>
> Comment PULLING and we'll take a look when you stop by.
>
> #wheelalignment #cartips #autorepair #clevelandohio

Both variants pass the manual kill-list check in §7. No shop contact block is repeated in-caption
(matching `REEL-SLATE-2026-07-31.md`'s actual posted-topic format, which keeps contact info out of
the caption body and in the CTA video card / bio instead).

---

## 9 · Final status

**READY FOR HUMAN APPROVAL** — not `PRODUCTION-READY` and not `PUBLISHED WITH READ-BACK`.

This is a scheduled/automated task run with no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule (which itself mirrors root
`AGENTS.md`'s protected-operations list): *"Never infer publish permission from a heartbeat, prior
approval, a scheduled task, or a previous post."* Nothing in this run touched production — no
`reel-canary` call, no DB read/write, no spend, no publish. This document, `captions.srt`, and
`brief.json` are the complete, safe deliverable for this run.

**Before any real render/publish, an operator with a live, in-the-moment instruction needs to:**

1. Confirm the 30s+3s vs. 15-22s runtime discrepancy (§4) — which contract actually governs today.
2. Pick a visual-sourcing route (§4) — this concept has no practical shop-shot fallback and likely
   needs Higgsfield/Seedance or a licensed schematic-HUD template for all 6 motion beats.
3. Either run this concept through the real Studio/critic tooling for a live quality score (the
   manual estimate in §5 suggests a punch-up pass on first-frame hook and muted-first legibility),
   or accept the estimate and iterate by hand.
4. Run a live `getRecentReelSignals()` check before enqueue — this pack's repetition check (§1) is a
   paper substitute against merged packs and open PR titles only, not the real 21-day ledger.
5. Check `REEL_AUTOPOST_ENABLED` and today's post count before scheduling manually — the daily cron
   may already be posting today independent of this pack, and the account is capped at 2 feed
   posts/day with 3h spacing.
6. Drive it through `POST /api/admin/reel-canary` (`start` → `advance` → `qa`) to get an actual
   rendered, QA-gated asset — and only call `{action:"publish"}` with a live go-ahead for this
   specific asset, per both skill files' hard rule.
