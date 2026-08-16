# Reel production pack — "Your tread just got fingerprinted" (TREAD)

Scheduled-task run · 2026-08-15 · mode `INTELLIGENCE`/`PRODUCTION` (research + pack only, per
`apps/nickstire/.claude/skills/reel-operator/SKILL.md`) · campaign keyword **TREAD**

This pack follows the reel-operator skill's 9-point receipt shape and the account's real,
data-corrected posting format from `docs/REEL-SLATE-2026-07-31.md` (Hook 0-2s → Setup 2-5s →
Value 5-25s → CTA 25-30s, SEND-oriented CTA, no in-frame AI-generated text). **No generation, DB
read, or publish call was made against production this run** — see §1 and §9.

---

## 1 · Mode, capabilities, repetition context

**Mode:** No live operator instruction authorized generation or publish for this run (this is a
scheduled/automated firing — `reel-operator`'s hard rule explicitly says a scheduled task does not
count as authorization). This is a pack-only run: `INTELLIGENCE` (topic research + scoring) +
`PRODUCTION` pack authoring, stopping short of any `reel-canary` call.

**Capabilities — not probed, stated as such rather than assumed:**

| Capability | Status |
|---|---|
| `getHiggsfieldAccountHealth()` | **NOT QUERIED** — no path to call it from this session |
| `REEL_VIDEO_PROVIDER` (live value) | **UNKNOWN** — `docs/operations/REEL-PIPELINE.md` documents prod pinned to `template_stock` as of last write-up; not re-read live |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | **UNKNOWN** — if `REEL_AUTOPOST_ENABLED=true`, the daily cron may already have posted today independent of this pack |
| `ADMIN_API_KEY` / `/api/admin/reel-canary` | **NOT AVAILABLE** — this session has no shell access to the prod Railway environment and no valid admin key |
| TTS / Higgsfield / Meta MCP tools | **NOT CONNECTED** to this session |

**Repetition ledger (`getRecentReelSignals`, 21-day window):** **NOT QUERIED** — the repo's only
`DATABASE_URL` is production TiDB, and reading it was not something this session had live
authorization to do unattended. What I checked instead, as a paper substitute:

- `apps/nickstire/docs/REEL-SLATE-2026-07-31.md` — 20 planned topics, none overlap this one (closest
  are #4 "alignment vs balance" — vibration vs pulling, not visual tread-pattern reading — and #13
  "why the car pulls to one side").
- `apps/nickstire/client/src/lib/facelessReelStudioSamples.ts` — 3 reference samples (PRESSURE,
  POTHOLE, BRAKES). None overlap this topic. **Lens overlap flagged:** this pack's
  fingerprint/case-file conceit is adjacent to POTHOLE's `forensic_evidence_scan` lens — not
  identical (this one is a print-match conceit specific to tread, POTHOLE is a dashcam/evidence-board
  conceit), but the real repetition ledger should confirm this hasn't been used more recently than
  these two files show before an operator enqueues it.

---

## 2 · Candidate concepts and scores

Two concepts considered, scored 0–10 per dimension on the sample briefs' rubric (hook / truth /
save / local / absurdity / fit). **These are my own manual estimates, not a live
`calculateReelQualityScore()` or critic-panel run** — flagged honestly in §5.

### Concept A — "Fingerprint case file" (SELECTED)

A forensic-HUD "print match" motif reads four tread wear patterns as four suspects, closing the
case on each root cause.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 9 | 9 | 8 | 8 | 7 | 10 | **51** |

Below the skill's `≥57/60` sub-threshold for "winning concept" — see §5's honest accounting of why,
and what would need to change to clear it.

### Concept B — "POV: you are the tire" (parked)

First-person tire POV feeling each wear pattern develop, mirroring the BRAKES sample's
`pov_you_are_the_part` archetype. Parked because that archetype/lens was used two months ago for
BRAKES and reusing it back-to-back risks a flatter feed even though the individual reel would
likely score similarly.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 8 | 9 | 7 | 6 | 8 | 10 | **48** |

---

## 3 · Claim evidence

No live `evidenceResolver.ts` / `EvidenceRecord` lookup ran (no DB access this session) — every
entailment below is **`not_evaluated`** in the pipeline's own vocabulary, not `supported`. Sourcing
follows the samples' own pattern: label-only proof citations, no fabricated URLs.

| Claim in this reel | Source note (label only) | Kind | Entailment |
|---|---|---|---|
| Flat/center tread wear points to overinflation | Tire Rack education — inflation basics (same label the PRESSURE sample cites) | proof | not_evaluated |
| Wear on both outer edges points to underinflation | Car Care Council — tire wear pattern diagnostics | proof | not_evaluated |
| Wear on one edge only points to alignment, not air pressure | Car Care Council — alignment symptoms (same label the POTHOLE sample cites) | proof | not_evaluated |
| Cupped/scalloped patches can point to worn suspension | AAA / Car Care Council — suspension wear symptoms | proof | not_evaluated |
| Drivers see uneven wear and don't connect it to a cause | Aggregated shop questions: "why is my tire wearing weird on one side" | pain_point | not_evaluated |

No `businessFacts.ts` row was pulled — this script makes no price, warranty, or hours claim, so the
"no `reel`/`social` channel in `FactChannel` yet" gap the skill flags doesn't apply here by design.

**No claim in this pack states a diagnosis as certain.** Every line uses the approved soft-language
bank from `client/src/lib/facelessReelStudio.ts`: *can point to · worth checking · one clue · do not
guess*. This is a deliberate design constraint, not an oversight — one visual clue never diagnoses a
car by itself, and the script says so on-camera.

---

## 4 · Production pack

### Storyboard (30s: Hook 0-2 → Setup 2-5 → Value 5-25 → CTA 25-30 + 3s freeze = 33s runtime)

| Beat | Time | Visual | On-screen overlay (ffmpeg, not AI-generated) | Voiceover (word-for-word) |
|---|---|---|---|---|
| 1 · Hook | 0:00–0:02 | Macro tread, HUD scan-line sweeps across it, "MATCH FOUND" flourish | — | "Your tread just got fingerprinted." |
| 2 · Setup | 0:02–0:05 | HUD opens four case-file tabs over the tire | "4 PATTERNS. 4 CAUSES." | "Four patterns. Four suspects." |
| 3 · Value 1 | 0:05–0:10 | Macro dolly across a tire worn flat down the center | "SUSPECT: OVERINFLATION" | "Flat across the center? Suspect: overinflation." |
| 4 · Value 2 | 0:10–0:15 | Macro dolly across both outer shoulders, both visibly worn | "SUSPECT: UNDERINFLATION" | "Worn on both edges? Suspect: underinflation." |
| 5 · Value 3 | 0:15–0:20 | Macro dolly across one worn shoulder, the other edge clean | "SUSPECT: ALIGNMENT" | "Worn on just one edge? Suspect: alignment — not air." |
| 6 · Value 4 | 0:20–0:25 | Macro across a cupped/scalloped wear pattern, HUD highlights the scallops | "SUSPECT: WORN SUSPENSION" | "Cupped, scalloped patches? Suspect: worn suspension." |
| 7 · CTA | 0:25–0:30 | HUD closes the case, pulls back — mirrors beat 1's opening framing (loop seam) | "ONE CLUE NEVER CLOSES THE CASE." then CTA card fades in | "One clue never closes the case. Worth checking — not worth guessing." |
| 8 · SAVE freeze | 0:30–0:33 | Static hold on the CTA card | "Send this to whoever's tread looks a little suspicious.\nStop by — we'll take a real look.\nNick's Tire & Auto · 17625 Euclid Ave, Cleveland · (216) 862-0005" | (silent — ambient tone only) |

Standing negative prompt for every beat, per the pipeline's real M10 preflight contract: **faces,
hands, human figures, on-screen text, logos, watermarks, subtitles** (all on-screen words are
ffmpeg overlays added at assembly, never asked of the video generator — this matches the hard
constraint in `REEL-SLATE-2026-07-31.md`: *"No text or branding in-frame. M10 preflight blocks it
[Seedance cannot spell]"*). No real person's name appears anywhere in this script.

### Full voiceover script, timed

```
[0:00–0:02] Your tread just got fingerprinted.
[0:02–0:05] Four patterns. Four suspects.
[0:05–0:10] Flat across the center? Suspect: overinflation.
[0:10–0:15] Worn on both edges? Suspect: underinflation.
[0:15–0:20] Worn on just one edge? Suspect: alignment — not air.
[0:20–0:25] Cupped, scalloped patches? Suspect: worn suspension.
[0:25–0:30] One clue never closes the case. Worth checking — not worth guessing.
[0:30–0:33] (silent hold — CTA card only)
```

~55 spoken words over 30s (≈1.8 words/sec) — comfortable at both the Google Neural2-J and
ElevenLabs "Roger" default paces the real `reelVoice.ts` uses.

### Visual sourcing — pick ONE route before rendering

The prod pipeline's currently-pinned free lane (`template_stock`, per
`docs/operations/REEL-PIPELINE.md`) generates **abstract Ken-Burns camera moves over a solid/gradient
backdrop** — it does not shoot literal tires. This concept needs the viewer to actually *see* four
distinct tread patterns, so `template_stock` alone will not carry it. Three real options, in
recommended order:

1. **Shop-shot macro footage (recommended).** Five ~10s handheld or tripod macro clips of real
   customer tires already at the shop showing (or close enough to stage with a worn takeoff tire)
   center wear, both-edge wear, one-edge wear, and cupping. Cheapest, zero licensing questions,
   most on-brand (these are literally Nick's tires). A phone macro lens or macro mode is enough;
   keep the frame to rubber only — no faces, no plates, no shop signage with a real person in it.
2. **Higgsfield/Seedance clip generation** (currently NOT the prod-pinned route — would need
   `REEL_VIDEO_PROVIDER` flipped back and costs an estimated `$0.25/clip × 5 clips ≈ $1.25`, per
   `generationLedger.ts`'s `COST_ESTIMATES_USD`). Per-beat prompt pack below if this route is chosen.
3. **Licensed stock tire-tread macro footage** — fallback only if neither of the above is available.
   I have not sourced or verified any specific stock asset or URL (I don't fabricate URLs); the
   operator would search a licensed library (e.g. their existing Storyblocks/Pexels/Envato account,
   if any) for "tire tread macro close up wear" and confirm commercial-use rights before use.

**Higgsfield-style prompt pack (route 2, if activated):**

| Beat | Prompt | Negative prompt |
|---|---|---|
| 1 | Extreme macro of a tire tread, camera push-in, cinematic studio lighting with a thin blue scan-line sweeping across the rubber | faces, hands, human figures, on-screen text, logos, watermarks, subtitles |
| 3 | Macro dolly across a tire tread worn flat and smooth down the center groove, shoulders still deep | (same) |
| 4 | Macro dolly across a tire's outer shoulder, worn thin at both edges, deep tread remaining in the center | (same) |
| 5 | Macro dolly across a tire tread worn thin on one shoulder only, opposite shoulder still deep | (same) |
| 6 | Macro of a tire tread with a scalloped, cupped wear pattern rippling across the surface | (same) |
| 7 | Slow pull-back from tread macro to a wider three-quarter tire shot, mirroring the beat-1 push-in for a loop seam | (same) |

### Assembly (ffmpeg — matches `reelAssembly.ts`'s real technique)

1. **Canvas:** 1080×1920 (9:16), 30fps target.
2. **Concatenate** the 6 motion clips (beats 1,3,4,5,6,7) with hard cuts at each beat boundary —
   matching the samples' documented style (`"hard cuts on beats 2/4"`, `"hard cut beats 1-4, snap-zoom
   transition into beat 5"`). No crossfades needed; hard cuts read as more forensic/punchy for this
   HUD conceit.
3. **Caption burn-in:** word-level ASS subtitles synced to the VO timing above (karaoke-style
   word-highlight if the ElevenLabs TTS lane with alignment timestamps is used; otherwise beat-synced
   caption blocks off the Google TTS SSML pacing). `PlayResX/Y 1080x1920`, safe zone: keep all text
   inside the middle 60% of frame width and clear of the bottom 20% (UI overlap zone), per the
   samples' `safeZoneNotes` convention.
4. **Overlay text** (drawtext, NOT part of the generated video): the "SUSPECT: ___" tags per beat,
   the "4 PATTERNS. 4 CAUSES." setup tag, the closing "ONE CLUE NEVER CLOSES THE CASE." line, and the
   CTA card in beat 8.
5. **Audio mix:** VO track centered; no music bed by default — see §6 (rights gap). If the operator
   wants ambient sound design (scan-line whoosh, HUD confirmation chime, matching the samples' `audioCue`
   fields), those are short SFX stings, not a licensed music track, and carry no rights question.
6. **Freeze frame:** hold the final CTA-card frame for exactly 3s after the last spoken word (0:30–0:33)
   — this is the real render-integrity contract's `beats + 3s SAVE freeze` container-duration target.
7. **Render-integrity self-check before calling this "done"** (the real gate, `reelAssembly.ts`
   "#800/#801" — verify with `ffprobe` once a real file exists): container duration within 0.75s of
   33s, video-stream duration within 0.75s of 33s (don't trust container duration alone — it can lie
   via the audio track), ≥80% of the expected 30fps × 33s frame count, and ≥3 distinct MD5 hashes among
   5 sampled frames (proves real motion — a static or looped-nothing render fails this and should be
   treated as unfinished, not shipped).

---

## 5 · Credit-risk and fallback routing

Estimates only, read from `generationLedger.ts`'s documented `COST_ESTIMATES_USD` constants — **the
live daily budget remaining and account balance are UNKNOWN** (no live read this session; the
$10/day `maxGenerationCostPerDayUsd` cap and today's spend against it were not queried).

| Route | Est. cost | Notes |
|---|---|---|
| Shop-shot footage (recommended) | **$0** | No generation spend at all — just VO (TTS) cost |
| `template_stock` (prod default) | **$0/clip** | Free, but produces abstract backdrops — unsuitable for this concept as-is (see §4) |
| Higgsfield/Seedance (currently inactive route) | **≈$0.25 × 5 clips ≈ $1.25**, labeled an ASSUMPTION in the source comment, not a metered price | Would need `REEL_VIDEO_PROVIDER` flipped — an operator/config decision, not mine to make |
| TTS (Google Neural2-J or ElevenLabs) | Not itemized in the cost table read | Google lane is free-quota; ElevenLabs is the paid fallback only if Google fails |

**Honest self-score against the real 75-point gate** (see §2's per-concept table): estimating this
pack manually against `calculateReelQualityScore()`'s known weights —

first-frame 9/10 · muted-first 9/10 · beat structure 5/5 · length 5/5 · loop 5/5 (fixed via the
beat-7 mirror pull-back) · sourced fact 7/10 (label-only, not live-entailed) · faceless 10/10 ·
claim safety 10/10 · keyword 5/5 · winning-concept bonus 0/5 (Concept A scored 51/60 in §2, below
the skill's stated `≥57/60` sub-threshold) — **estimated total ≈65/75**, below the real gate's
70/75 floor.

That's a genuine finding, not false modesty: this pack is a strong first draft, but the "local"
angle (Cleveland/Euclid Ave specificity beyond the CTA block) and the "absurdity/character" depth of
the fingerprint conceit are the two dimensions most worth an editor's pass before spending render
budget. I did not inflate the numbers to look finished — the skill's own words apply: *"the server
re-scores at enqueue — don't trust a client-only score,"* and this was never even a client-side
score, just my manual estimate with no live tooling behind it.

---

## 6 · Audio/music rights status

**No music-rights ledger exists in this repo** — confirmed real gap, not an oversight on my part.
This pack defaults to **no licensed music bed**: VO (Google TTS / ElevenLabs, both real working
lanes with no rights question) plus short SFX stings (scan sweep, confirmation chime) mixed under
it. If the operator wants a music bed, the lowest-friction, zero-rights-question option is Meta's
own built-in royalty-free audio library inside the Instagram/Facebook Reels composer (pre-cleared
for that platform) — I have not selected or verified a specific track, since I have no live access
to browse it.

---

## 7 · QA matrix

| Gate | Verdict | Backed by |
|---|---|---|
| Claim-safety wording (no prices, no guarantees, approved soft language) | **PASS** | Manual check against `client/src/lib/facelessReelStudio.ts`'s approved phrase list — script uses "can point to," "worth checking," "one clue," "not worth guessing" |
| Brand-voice kill list (`shared/voice.ts`) | **PASS** | Manually checked every VO/caption/hashtag line against all 39 `KILL_RULES` — no hits |
| Faceless / standing negative prompt compliance | **PASS** (by design of the prompts) | Prompt pack in §4 carries the standing negative prompt on every beat; storyboard has no faces/hands/human figures |
| Repetition ledger (21-day, live DB) | **UNKNOWN** | Not queried — no live DB access this session (see §1) |
| Render-integrity gate (`reelAssembly.ts` #800/#801: duration, frame count, motion-proof MD5 check) | **UNKNOWN / N/A** | Nothing was rendered — no file exists to `ffprobe` |
| Rendered QA vision critic (`renderedQa.ts`) | **UNKNOWN** | Not run — requires an actual rendered file and a live call |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED** | Never called — no `reel-canary` access this session, and publish requires live operator authorization regardless (§9) |
| Quality score vs. live 70/75 floor | **FAIL (estimated)** | My own manual estimate in §5 is ≈65/75 — below the stated floor. Flagged, not hidden. |

---

## 8 · IG/FB copy — 2 ad-ready variants

Format follows the account's current, data-corrected house style
(`docs/REEL-SLATE-2026-07-31.md`): short punchy lines, a SEND-oriented CTA (this account's 8 posted
reels measured `saved = 0.00`; the corrected objective is watch time and sends, not saves).
Hashtags capped at 4 (Instagram's Dec-2025 hard cap of 5, minus headroom), lowercase per the current
slate's convention.

### Variant A — SEND-first (primary recommendation, matches the corrected house strategy)

> Your tread just got fingerprinted.
>
> Flat down the center is overinflation. Worn on both edges is underinflation. Worn on just one
> edge is alignment, not air. Cupped or scalloped patches can point to worn suspension.
>
> One clue never closes the case — worth checking, not worth guessing.
>
> Send this to whoever's tread looks a little suspicious.
>
> #tiretreadwear #wheelalignment #clevelandohio #euclidohio

### Variant B — Comment-keyword style (matches the older Studio samples' `campaignKeyword` convention)

> Read your tread like a detective.
>
> Your tire's wear pattern is basically a case file: flat center, both edges, one edge, or
> cupped — each one points somewhere different, and none of them is a guess you should make alone.
>
> Comment TREAD and we'll check it when you stop by.
>
> #tiretreadwear #wheelalignment #clevelandohio #euclidohio

Both variants pass the manual kill-list check in §7. No shop contact block is repeated in-caption
(matching `REEL-SLATE-2026-07-31.md`'s actual posted-topic format, which keeps contact info out of
the caption body and in the CTA video card / bio instead).

---

## 9 · Final status

**READY FOR HUMAN APPROVAL** — not `PRODUCTION-READY` and not `PUBLISHED WITH READ-BACK`.

This is a scheduled/automated task run with no live operator present. Per
`apps/nickstire/.claude/skills/reel-operator/SKILL.md`'s hard rule (which itself mirrors root
`AGENTS.md`'s protected-operations list): *"Never infer publish permission from a heartbeat, prior
approval, a scheduled task, or a previous post."* Nothing in this run touched production — no
`reel-canary` call, no DB read/write, no spend, no publish. This document and `captions.srt` are the
complete, safe deliverable for this run.

**Before any real render/publish, an operator with a live, in-the-moment instruction needs to:**

1. Pick a visual-sourcing route (§4) — shop-shot footage is the free, zero-rights, recommended path.
2. Either run this concept through the real Studio/critic tooling to get a live quality score (the
   manual estimate in §5 suggests it needs a punch-up pass first), or accept the estimate and iterate
   by hand.
3. Check `REEL_AUTOPOST_ENABLED` and today's post count before scheduling manually — the daily cron
   may already be posting today independent of this pack, and the account is capped at 2 feed
   posts/day with 3h spacing.
4. Drive it through `POST /api/admin/reel-canary` (`start` → `advance` → `qa`) to get an actual
   rendered, QA-gated asset — and only call `{action:"publish"}` with a live go-ahead for this
   specific asset, per both skill files' hard rule.
