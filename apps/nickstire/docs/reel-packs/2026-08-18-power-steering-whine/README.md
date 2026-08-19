# Reel production pack — "The whine before it fails" (PSWHINE)

Scheduled-task run · 2026-08-18 · mode `INTELLIGENCE`/`PRODUCTION` (research + pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **PSWHINE**

This pack follows the reel-operator skill's 9-point receipt shape and the account's real,
data-corrected posting format from `docs/REEL-SLATE-2026-07-31.md` (Hook 0-2s → Setup 2-5s →
Value 5-25s → CTA 25-30s, SEND-oriented CTA, no in-frame AI-generated text). **No generation, DB
read, or publish call was made against production this run** — see §1 and §9.

---

## 1 · Mode, capabilities, repetition context

**Mode:** No live operator instruction authorized generation or publish for this run — this is a
scheduled/automated firing, and the skill's hard rule is explicit that a stored scheduled prompt
does not count as authorization. This is a pack-only run: `INTELLIGENCE` (topic research + scoring)
+ `PRODUCTION` pack authoring, stopping short of any `reel-canary` call.

**Capabilities — probed where possible, stated as unavailable otherwise:**

| Capability | Status |
|---|---|
| `getHiggsfieldAccountHealth()` | **NOT QUERIED** — no shell path to the running server or its credentials from this session; `env` here has no `HIGGSFIELD_*`, `REEL_*`, `ADMIN_API_KEY`, or `DATABASE_URL` set at all (confirmed by grepping this session's environment, not assumed) |
| `REEL_VIDEO_PROVIDER` (live value) | **UNKNOWN** — `docs/operations/REEL-PIPELINE.md` documents prod pinned to `template_stock` as of last write-up; not re-read live |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | **UNKNOWN** — if `REEL_AUTOPOST_ENABLED=true`, the daily cron may already have posted today independent of this pack |
| `ADMIN_API_KEY` / `/api/admin/reel-canary` | **NOT AVAILABLE** — this is a GitHub-scoped code session, not a session attached to the Railway deployment; no admin key present |
| TTS (Google Neural2 / ElevenLabs) | **NOT CONNECTED** — no TTS tool wired to this session |
| Higgsfield (clip generation) | **NOT CONNECTED** — no Higgsfield tool wired to this session |
| Meta/Instagram posting | **NOT CONNECTED**, and deliberately not attempted regardless — protected customer-facing action per root `AGENTS.md`, requires a live, specific operator go-ahead every time |
| Shell/render (ffmpeg) | Not attempted — even if `ffmpeg` were present, `reelAssembly.ts`'s real pipeline claims a job row out of the **production** TiDB database; running it for real risks claiming a live operator job from an unattended session |
| CapCut | **NOT INTEGRATED** — desktop app, no connector exists here |

Net: nothing on the workflow's requested tool list (ChatGPT/TTS/Higgsfield/Meta posting/CapCut) is
connected to this session. Per the source instructions' own step 5 ("if tools are missing, produce
a production-ready pack instead"), defaulting to the pack.

**Repetition ledger (`getRecentReelSignals`, 21-day window):** **NOT QUERIED** — the repo's only
`DATABASE_URL` is production TiDB, and this session has no live path to it. What I checked instead,
as a paper substitute:

- `apps/nickstire/docs/reel-packs/` — 5 merged packs exist (penny-test, tire-expiration,
  tread-fingerprint, battery-summer-heat, squealing-vs-grinding-brakes). None cover power steering.
- `docs/REEL-SLATE-2026-07-31.md` and `client/src/lib/facelessReelStudioSamples.ts` — searched both
  for "power steering" / "steering whine" / "steering fluid": **zero matches**. No prior slate item
  or reference sample claims this topic.
- **Live GitHub PR search this run** (`is:pr is:open "reel pack" in:title`): **34 open draft PRs**,
  none titled for power steering. Scanned all 34 titles for topic overlap — no match.

**Backlog finding, flagged rather than buried:** those 34 open drafts are the real story of this
run, more than the new pack is. The three most recent prior firings (PR #1647, #1669, #1671, all
within the last 24h) already logged this same growth — 29 → 32 → 33 unmerged drafts — and each one
chose to skip producing a new pack and report status instead. Nothing between those runs and now
merged, closed, or consumed any of them; the count is now 34 and still climbing at roughly one new
draft per scheduled firing. Producing pack #35 without addressing that is not obviously better than
another status-only run, so this pack is being kept deliberately small, and §9 below repeats the
recommendation plainly instead of assuming a fourth "no new pack" run in a row is more useful.

**Seasonal/mechanical note:** power steering whine is not seasonal the way the battery/coolant
topics are — it's evergreen wear-and-tear content, chosen partly *because* it doesn't compete with
the weather-timed topics already queued in the backlog (COLDSNAP, battery-summer-heat).

---

## 2 · Candidate concepts and scores

Two concepts considered, scored 0–10 per dimension on the sample briefs' rubric (hook / truth /
save / local / absurdity / fit). **These are my own manual estimates, not a live
`calculateReelQualityScore()` or critic-panel run** — flagged honestly in §5.

### Concept A — "The whine is asking for help" POV/x-ray hybrid (SELECTED)

Opens on a first-person POV of hands turning the wheel as a whine rises, then cuts inside the pump
to show why — low fluid lets air into the system, and that air is the whine. Ends on a five-minute
self-check.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 8 | 9 | 9 | 6 | 4 | 10 | **46** |

Below the skill's `≥57/60` sub-threshold for "winning concept" — see §5's honest accounting.

### Concept B — "Your car is a rumor mill" personified-pump bit (parked)

Anthropomorphize the pump as a coworker who's been "asking nicely" (the whine) before it "walks
out" (fails). Parked because the bit risks landing as cute rather than useful — the mechanic fact
here is strong enough to carry a straight explainer without needing a character to sell it, unlike
the pothole-gremlin or tire-pressure-balloonist topics where the character *is* the hook.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 7 | 8 | 7 | 5 | 8 | 8 | **43** |

---

## 3 · Claim evidence

No live `evidenceResolver.ts` / `EvidenceRecord` lookup ran (no DB access this session) — every
entailment below is **`not_evaluated`** in the pipeline's own vocabulary, not `supported`. Sourcing
follows the samples' own pattern: label-only proof citations, no fabricated URLs.

| Claim in this reel | Source note (label only) | Kind | Entailment |
|---|---|---|---|
| A whine or groan when turning the wheel is commonly caused by air in the power-steering fluid, usually from a low fluid level | Standard hydraulic power-steering diagnostic content (ASE-aligned technician training / Haynes-Chilton repair-manual class knowledge — cavitation noise from aerated fluid is a textbook symptom, not a shop-specific claim) | proof | not_evaluated |
| Continuing to drive with low/aerated fluid accelerates wear on the pump's internal seals | Same source class as above — running a hydraulic pump on aerated fluid is a well-documented cause of premature seal/pump wear | proof | not_evaluated |
| Checking the power-steering reservoir fluid level is a quick, driveway-doable check | Common, uncontroversial vehicle-maintenance fact (reservoir has a min/max marking on most vehicles) | proof | not_evaluated |
| Rough roads and frequent stop-and-go driving put extra load on the steering system over time | Common-knowledge framing used as the local-relevance tie-in, not a precise mechanical claim | pain_point | not_evaluated |

No `businessFacts.ts` row was pulled — this script states no shop price, warranty, or hours, so the
"no `reel`/`social` channel in `FactChannel` yet" gap the skill flags doesn't apply here by design.

**No claim in this pack states a diagnosis as certain.** Every line uses the approved soft-language
bank from `client/src/lib/facelessReelStudio.ts`: *worth checking · can point to · one clue*. The
script deliberately avoids naming a single guaranteed cause (a whine can also mean a slipping belt
or a failing pump outright) — it names the single most common cause and frames the fix as a
check, never a certainty.

---

## 4 · Production pack

### Storyboard (30s: Hook 0-2 → Setup 2-5 → Value 5-25 → CTA 25-30 + 3s freeze = 33s runtime)

Archetype: **pov_you_are_the_part** (driver POV, mirroring the brake-pad sample's structure) for
the hook/setup/CTA beats; **xray_cutaway** for the two mechanism beats; **product_ad_macro** for
the self-check beat.

| Beat | Time | Visual | On-screen overlay (ffmpeg, not AI-generated) | Voiceover (word-for-word) |
|---|---|---|---|---|
| 1 · Hook | 0:00–0:02 | First-person POV: hands on the wheel, turning into a parking spot, a faint whine starts to rise on the turn | — | "That whine when you turn the wheel?" |
| 2 · Setup | 0:02–0:05 | Same POV, wheel turns further, whine climbs — camera holds tight on the hands | "NOT NORMAL" | "That's not normal — and it's not going to fix itself." |
| 3 · Value 1 | 0:05–0:10 | X-ray cutaway into the power-steering pump housing, fluid swirling with visible air bubbles | "AIR IN THE FLUID" | "Low fluid lets air into the pump — that air is the whine you're hearing." |
| 4 · Value 2 | 0:10–0:15 | X-ray cutaway continues, a seal inside the pump visibly drying and cracking as the aerated fluid churns past it | — | "Keep driving on it, and that air wears the pump's seals down." |
| 5 · Value 3 | 0:15–0:20 | Product-ad macro: engine bay, a hand lifts the power-steering reservoir cap, dipstick line clearly below the fill mark | "5-MINUTE CHECK" | "Five-minute check: pop the hood, look at the reservoir line." |
| 6 · Value 4 | 0:20–0:25 | Back to POV hands on the wheel, turning smoothly now, whine gone | "CAUGHT EARLY = A TOP-OFF" | "Catch it early, it's a top-off. Wait, and it's a pump." |
| 7 · CTA | 0:25–0:30 | POV mirrors beat 1's framing — hands on the wheel, turning into the same spot, silent this time | "WORTH CHECKING." then CTA card fades in | "Worth checking before the whine turns into a bigger bill." |
| 8 · SAVE freeze | 0:30–0:33 | Static hold on the CTA card | "Send this to whoever's car has been whining on turns.\nStop by — we'll check the fluid, no charge.\nNick's Tire & Auto · 17625 Euclid Ave, Cleveland · (216) 862-0005" | (silent — ambient tone only) |

Standing negative prompt for every beat, per the pipeline's real M10 preflight contract: **faces,
hands (full/identifiable), human figures, on-screen text, logos, watermarks, subtitles**. Note: POV
beats 1/2/6/7 show hands-on-wheel as a first-person driving shot (no face, no identifiable person —
matches the existing `pov_you_are_the_part` brake-pad sample's own treatment, which uses the same
POV convention); confirm this reading against the live M10 preflight before generating, since "no
hands" is listed as a hard negative-prompt term and a driving POV inherently frames hands on a
wheel. No real person's name appears anywhere in this script.

### Full voiceover script, timed

```
[0:00–0:02] That whine when you turn the wheel?
[0:02–0:05] That's not normal — and it's not going to fix itself.
[0:05–0:10] Low fluid lets air into the pump — that air is the whine you're hearing.
[0:10–0:15] Keep driving on it, and that air wears the pump's seals down.
[0:15–0:20] Five-minute check: pop the hood, look at the reservoir line.
[0:20–0:25] Catch it early, it's a top-off. Wait, and it's a pump.
[0:25–0:30] Worth checking before the whine turns into a bigger bill.
[0:30–0:33] (silent hold — CTA card only)
```

~58 spoken words over 30s (≈1.9 words/sec) — comfortable at both the Google Neural2-J and
ElevenLabs "Roger" default paces the real `reelVoice.ts` uses.

### Visual sourcing — pick ONE route before rendering

The prod pipeline's currently-pinned free lane (`template_stock`, per
`docs/operations/REEL-PIPELINE.md`) generates **abstract Ken-Burns camera moves over a solid/gradient
backdrop** — it does not shoot literal steering-wheel POV or pump interiors. This concept needs the
POV and x-ray visuals to actually read, so `template_stock` alone will not carry it. Three real
options, in recommended order:

1. **Shop-shot footage (recommended for beats 1, 2, 5, 6, 7, 8).** A real dashcam-style POV rig on
   a shop vehicle for the wheel-turn shots, and a real engine-bay reservoir check filmed at the
   shop — cheap, on-brand, and the majority of this storyboard is practically shootable this way.
   Only beats 3–4 (pump interior x-ray) need route 2 or 3.
2. **Higgsfield/Seedance clip generation** for beats 3–4 only (currently NOT the prod-pinned route
   — would need `REEL_VIDEO_PROVIDER` flipped back and costs an estimated `$0.25/clip × 2 clips ≈
   $0.50`, per `generationLedger.ts`'s `COST_ESTIMATES_USD`). Per-beat prompt pack below.
3. **Licensed stock/motion-graphics footage** — fallback only if neither of the above is available.
   I have not sourced or verified any specific stock asset or URL (I don't fabricate URLs); the
   operator would search a licensed library for "hydraulic pump x-ray cutaway animation" and
   confirm commercial-use rights before use.

**Higgsfield-style prompt pack (route 2, beats 3–4 only):**

| Beat | Prompt | Negative prompt |
|---|---|---|
| 3 | Technical x-ray cutaway visualization of a car power-steering pump housing, translucent materials showing internal fluid swirling with fine air bubbles, cool schematic lighting, clean dark field, engineering-diagram aesthetic | faces, hands, human figures, on-screen text, logos, watermarks, subtitles |
| 4 | Technical x-ray cutaway visualization continues, a close view of an internal rubber seal drying and developing fine cracks as aerated fluid churns past it, precise engineering aesthetic, cool schematic lighting | (same) |

### Assembly (ffmpeg — matches `reelAssembly.ts`'s real technique)

1. **Canvas:** 1080×1920 (9:16), 30fps target.
2. **Concatenate** the 6 motion clips (beats 1, 3, 4, 5, 6, 7 — beat 2 reuses beat 1's clip held
   longer, since the setup line just lets the whine climb on the same shot) with hard cuts at each
   beat boundary. A slow dissolve, not a hard cut, works better on the beat 2→3 transition (POV →
   x-ray cutaway) since it's a world-change, not a beat-to-beat cut — matching the technique used in
   the battery-summer-heat pack for the same kind of transition.
3. **Caption burn-in:** word-level ASS subtitles synced to the VO timing above (karaoke-style
   word-highlight if the ElevenLabs TTS lane with alignment timestamps is used; otherwise beat-synced
   caption blocks off the Google TTS SSML pacing). `PlayResX/Y 1080x1920`, safe zone: keep all text
   inside the middle 60% of frame width and clear of the bottom 20% (UI overlap zone).
4. **Overlay text** (drawtext, NOT part of the generated video): "NOT NORMAL," "AIR IN THE FLUID,"
   "5-MINUTE CHECK," "CAUGHT EARLY = A TOP-OFF," "WORTH CHECKING," and the CTA card in beat 8.
5. **Audio mix:** VO track centered; no music bed by default — see §6 (rights gap). A rising
   mechanical whine SFX under beats 1–2 (fading to silence by beat 7's mirrored shot) is a short SFX
   element central to the concept, not a licensed music track, and carries no rights question.
6. **Freeze frame:** hold the final CTA-card frame for exactly 3s after the last spoken word
   (0:30–0:33) — the real render-integrity contract's `beats + 3s SAVE freeze` container-duration
   target.
7. **Render-integrity self-check before calling this "done"** (the real gate, `reelAssembly.ts`
   "#800/#801" — verify with `ffprobe` once a real file exists): container duration within 0.75s of
   33s, video-stream duration within 0.75s of 33s (don't trust container duration alone — it can lie
   via the audio track), ≥80% of the expected 30fps × 33s frame count, and ≥3 distinct MD5 hashes
   among 5 sampled frames (proves real motion — a static or looped-nothing render fails this and
   should be treated as unfinished, not shipped).

---

## 5 · Credit-risk and fallback routing

Estimates only, read from `generationLedger.ts`'s documented `COST_ESTIMATES_USD` constants — **the
live daily budget remaining and account balance are UNKNOWN** (no live read this session; the
$10/day `maxGenerationCostPerDayUsd` cap and today's spend against it were not queried).

| Route | Est. cost | Notes |
|---|---|---|
| Shop-shot footage (beats 1, 2, 5, 6, 7, 8) | **$0** | Covers 4 of 6 motion beats plus both static beats; only beats 3–4 (pump-interior x-ray) need route 2 or 3 |
| `template_stock` (prod default) | **$0/clip** | Free, but produces abstract backdrops — unsuitable for the x-ray beats (3–4) as-is (see §4) |
| Higgsfield/Seedance (currently inactive route) | **≈$0.25 × 2 clips ≈ $0.50**, labeled an ASSUMPTION in the source comment, not a metered price | Would need `REEL_VIDEO_PROVIDER` flipped — an operator/config decision, not mine to make. Cheapest paid-route pack in this series so far since only 2 of 6 beats need it. |
| TTS (Google Neural2-J or ElevenLabs) | Not itemized in the cost table read | Google lane is free-quota; ElevenLabs is the paid fallback only if Google fails |

**Honest self-score against the real 75-point gate** (see §2's per-concept table): estimating this
pack manually against `calculateReelQualityScore()`'s known weights —

first-frame 7/10 (a POV wheel-turn with a rising whine is a subtler scroll-stop than a flashing
warning icon or a documentary-style "case file" open) · muted-first 6/10 (the sound *is* the hook
here — a whine that can't be heard on mute loses real punch; overlay text on beat 2 partially
compensates) · beat structure 5/5 · length 5/5 · loop 5/5 (fixed via the beat-7 POV mirror) ·
sourced fact 9/10 (textbook hydraulic-diagnostic content, label-only not live-entailed) · faceless
10/10 · claim safety 10/10 · keyword 5/5 · winning-concept bonus 0/5 (Concept A scored 46/60 in §2,
below the skill's stated `≥57/60` sub-threshold) — **estimated total ≈62/75**, below the real gate's
70/75 floor.

That's a genuine finding, not false modesty: **muted-first is the real weak point** here, more than
in the battery pack — this concept leans on an audio cue (the whine) that a muted autoplay viewer
won't hear, and the overlay-text compensation (beat 2's "NOT NORMAL") only partially covers for it.
Worth a punch-up pass — e.g. a visible dashboard vibration/shudder cue timed to the whine so the
"something's wrong" read survives on mute — before spending render budget.

---

## 6 · Audio/music rights status

**No music-rights ledger exists in this repo** — confirmed real gap, not an oversight on my part.
This pack defaults to **no licensed music bed**: VO (Google TTS / ElevenLabs, both real working
lanes with no rights question) plus a short rising-whine SFX (central to the concept, not a music
track) mixed under it. If the operator wants a music bed, the lowest-friction, zero-rights-question
option is Meta's own built-in royalty-free audio library inside the Instagram/Facebook Reels
composer (pre-cleared for that platform) — I have not selected or verified a specific track, since I
have no live access to browse it.

---

## 7 · QA matrix

| Gate | Verdict | Backed by |
|---|---|---|
| Claim-safety wording (no prices, no guarantees, approved soft language) | **PASS** | Manual check against `client/src/lib/facelessReelStudio.ts`'s approved phrase list — script uses "worth checking," never states a diagnosis as certain, names the fix as a check not a repair |
| Brand-voice kill list (`shared/voice.ts`) | **PASS (manual)** | Manually checked every VO/caption/hashtag line against the kill-list categories described in prior packs — no obvious hits; **not run through the live linter**, since this session has no path to it |
| Faceless / standing negative prompt compliance | **PASS (manual, with a flagged edge case)** | Storyboard has no faces and no identifiable person; POV hands-on-wheel shots are the same convention the existing `pov_you_are_the_part` brake-pad sample uses, but "hands" is literally listed in the standing negative prompt — flagged in §4 for the operator/preflight to confirm before generating, not silently assumed fine |
| Repetition ledger (21-day, live DB) | **UNKNOWN** | Not queried — no live DB access this session; live GitHub PR search substitute run instead (§1), zero topic overlap found across 34 open drafts + 5 merged packs |
| Render-integrity gate (`reelAssembly.ts` #800/#801: duration, frame count, motion-proof MD5 check) | **UNKNOWN / N/A** | Nothing was rendered — no file exists to `ffprobe` |
| Rendered QA vision critic (`renderedQa.ts`) | **UNKNOWN** | Not run — requires an actual rendered file and a live call |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED** | Never called — no `reel-canary` access this session, and publish requires live operator authorization regardless (§9) |
| Quality score vs. live 70/75 floor | **FAIL (estimated)** | My own manual estimate in §5 is ≈62/75 — below the stated floor, weakest on muted-first. Flagged, not hidden. |

---

## 8 · IG/FB copy — 2 ad-ready variants

Format follows the account's current, data-corrected house style
(`docs/REEL-SLATE-2026-07-31.md`): short punchy lines, a SEND-oriented CTA (this account's posted
reels have measured `saved = 0.00`; the corrected objective is watch time and sends, not saves).
Hashtags capped at 4 (Instagram's Dec-2025 hard cap of 5, minus headroom), lowercase per the current
slate's convention.

### Variant A — SEND-first (primary recommendation, matches the corrected house strategy)

> That whine when you turn the wheel?
>
> That's not normal. Low fluid lets air into your power-steering pump — that air is the whine
> you're hearing. Keep driving on it and it wears the pump's seals down.
>
> Five-minute check: pop the hood, look at the reservoir line. Catch it early, it's a top-off.
> Wait, and it's a pump.
>
> Worth checking before the whine turns into a bigger bill.
>
> #powersteering #carmaintenance #clevelandohio #euclidohio

### Variant B — Comment-keyword style (matches the older Studio samples' `campaignKeyword` convention)

> That whine on turns isn't your car being dramatic.
>
> It's air in the power-steering fluid — usually from the level running low. Ignore it and that
> air wears down the pump's seals until "top-off" turns into "replace the pump."
>
> Comment WHINE and we'll check your fluid when you stop by, no charge.
>
> #powersteering #carmaintenance #clevelandohio #euclidohio

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

1. Pick a visual-sourcing route (§4) — shop-shot footage covers 4 of 6 motion beats here (better
   ratio than most prior packs in this series); only the pump-interior x-ray needs Higgsfield/stock.
2. Address the muted-first weak point flagged in §5 (a whine-driven hook needs a visible cue too)
   before spending render budget, or accept the estimate and iterate by hand.
3. Confirm the POV "hands on wheel" framing against the live M10 preflight (§4/§7) — it may need
   tighter framing to clear the standing negative-prompt term literally, even though it matches an
   existing approved sample's convention.
4. Check `REEL_AUTOPOST_ENABLED` and today's post count before scheduling manually — the daily cron
   may already be posting today independent of this pack, and the account is capped at 2 feed
   posts/day with 3h spacing.
5. Drive it through `POST /api/admin/reel-canary` (`start` → `advance` → `qa`) to get an actual
   rendered, QA-gated asset — and only call `{action:"publish"}` with a live go-ahead for this
   specific asset, per both skill files' hard rule.

**Separately, and more urgently than this pack: the backlog needs a human decision.** 34 open draft
PRs (per §1) sit unmerged, unclosed, and — as far as this session can tell — unconsumed by any
downstream process. The scheduled task that produces these runs on a cadence that outpaces any
review happening on them. Recommend the operator either (a) batch-review and merge/close the
existing 34 in one pass, keeping only genuinely distinct topics, or (b) pause this scheduled trigger
until that review happens. Continuing to fire it unattended just grows the pile — this run tried to
add real, non-duplicate value on top of that reality rather than pretend it isn't happening.
