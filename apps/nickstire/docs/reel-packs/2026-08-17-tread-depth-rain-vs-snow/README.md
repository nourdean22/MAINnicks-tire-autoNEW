# Reel production pack — "Legal isn't the same as safe" (TWONUMBERS)

Scheduled-task run · 2026-08-17 · mode `INTELLIGENCE`/`PRODUCTION` (research + pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **TWONUMBERS** · source:
[`REEL-SLATE-2026-07-31.md`](../../REEL-SLATE-2026-07-31.md) item #16 ("Tread depth for rain vs
snow")

This pack follows the reel-operator skill's 9-point receipt shape and the account's real,
data-corrected posting format from `docs/REEL-SLATE-2026-07-31.md` (Hook 0-2s → Setup 2-5s →
Value 5-25s → CTA 25-30s, SEND-oriented CTA, no in-frame AI-generated text). **No generation, DB
read, or publish call was made against production this run** — see §1 and §9.

**Backlog flag, read this before adding a 19th open PR.** At the time of this run,
`gh pr list --state open --search "reel pack in:title"` returned **18 open, unmerged reel-pack
PRs** (#1614–#1635, minus dependabot noise), covering 18 of the slate's 20 topics plus 4
beyond-slate topics. None of the last several scheduled firings have resulted in a merge. This run
adds a 19th pack for a genuinely uncovered topic (see §1's repetition check) rather than a
duplicate — but the operator should know the pipeline's bottleneck right now is **review/merge
throughput, not content generation**. Producing more packs on the current cadence without
triaging the existing 18 has diminishing value; consider pausing the scheduled trigger, or batching
a review pass, before the next firing.

---

## 1 · Mode, capabilities, repetition context

**Mode:** No live operator instruction authorized generation or publish for this run — this is a
scheduled/automated firing, and the skill's hard rule is explicit that a stored scheduled prompt
does not count as authorization. This is a pack-only run: `INTELLIGENCE` (topic research + scoring)
+ `PRODUCTION` pack authoring, stopping short of any `reel-canary` call.

**Capabilities — probed where possible, stated as unavailable otherwise:**

| Capability | Status |
|---|---|
| `getHiggsfieldAccountHealth()` | **NOT QUERIED** — no shell path to the running server or its credentials from this session; `env` here has no `HIGGSFIELD_*`, `REEL_*`, `ADMIN_API_KEY`, or `DATABASE_URL` set (checked live this run) |
| `REEL_VIDEO_PROVIDER` (live value) | **UNKNOWN** — `docs/operations/REEL-PIPELINE.md` documents prod pinned to `template_stock` as of last write-up; not re-read live |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | **UNKNOWN** — if `REEL_AUTOPOST_ENABLED=true`, the daily cron may already have posted today independent of this pack |
| `ADMIN_API_KEY` / `/api/admin/reel-canary` | **NOT AVAILABLE** — this is a GitHub-scoped code session, not a session attached to the Railway deployment; no admin key present |
| TTS (Google Neural2 / ElevenLabs) | **NOT CONNECTED** — no TTS tool wired to this session |
| Higgsfield (clip generation) | **NOT CONNECTED** — no Higgsfield tool wired to this session |
| Meta/Instagram posting | **NOT CONNECTED**, and deliberately not attempted regardless — protected customer-facing action per root `AGENTS.md`, requires a live, specific operator go-ahead every time |
| Shell/render (ffmpeg) | **CONFIRMED ABSENT** — `which ffmpeg ffprobe` returned nothing this run; even if present, `reelAssembly.ts`'s real pipeline claims a job row out of the **production** TiDB database, so running it for real risks claiming a live operator job from an unattended session |
| CapCut | **NOT INTEGRATED** — desktop app, no connector exists here |

Net: nothing on the workflow's requested tool list (ChatGPT/TTS/Higgsfield/Meta posting/CapCut) is
connected to this session. Per the source instructions' own step 5 ("if tools are missing, produce
a production-ready pack instead"), defaulting to the pack.

**Repetition ledger (`getRecentReelSignals`, 21-day window):** **NOT QUERIED** — the repo's only
`DATABASE_URL` is production TiDB, and this session has no live path to it. What I checked instead,
as a paper substitute:

- `apps/nickstire/docs/reel-packs/` (merged) — 5 prior packs: penny test (2/32" legal-minimum
  check), tire expiration (rubber aging), tread-fingerprint (wear-pattern diagnosis →
  alignment/suspension), battery-summer-heat, squealing-vs-grinding-brakes. **Closest overlap:**
  penny-test also cites the 2/32" legal minimum, but that pack stops at "you're legally worn" — it
  never introduces the 3/32"/4/32" performance thresholds or the rain-vs-snow distinction this pack
  is built around. Flagged, not hidden: an operator queuing both should expect the 2/32" number to
  repeat across two reels.
- 18 open PRs (`gh pr list --state open --search "reel pack in:title"`, #1614–#1635) — titles
  checked against slate items #1–20: covered are #1 (penny), #2 (brake noise), #4 (alignment vs
  balance), #5 (spare tire), #6 (tire expiration), #7 (check engine light), #8 (wheel bearing), #9
  (oil change), #10 (pothole), #12 (battery), #13 (why car pulls), #14 (cabin filter), #15 (struts),
  #17 (tire rotation), #18 (coolant color), #19 (noises), #20 (repair authorization) — plus 4
  beyond-slate topics (plug-vs-patch, transmission fluid, wiper blades, exhaust smoke). **Slate item
  #16 (this pack's topic) and #3 ("cold weather and the tire light") and #11 ("all-season vs winter
  tires") are the only three slate items with no open PR or merged pack** — #16 selected here as the
  best August fit (rain-relevant now; #3 and #11 are winter-framed and read oddly posted mid-August).
- `apps/nickstire/client/src/lib/facelessReelStudioSamples.ts` — 3 reference samples (PRESSURE,
  POTHOLE, BRAKES). No tread-depth/rain-vs-snow topic among them. **Archetype overlap flagged
  honestly:** this pack uses `myth_vs_reality` (legal ≠ safe), the same archetype as the PRESSURE
  sample and the battery-summer-heat pack — same story shape, unrelated topic. The real repetition
  ledger should confirm how recently `myth_vs_reality` actually ran before an operator enqueues this
  third instance of it.

**Seasonal note, stated plainly:** today is 2026-08-17 (August, Cleveland — rain season, not snow
season). The slate's own caption for item #16 leads with the snow number (4/32") before the rain
number (3/32"). This pack reorders to lead with **rain/hydroplaning first**, since that's the
immediately relevant risk in August, and holds the snow number as the "this matters again later"
second beat — a better seasonal fit for a mid-August posting date, same underlying facts.

---

## 2 · Candidate concepts and scores

Two concepts considered, scored 0–10 per dimension on the sample briefs' rubric (hook / truth /
save / local / absurdity / fit). **These are my own manual estimates, not a live
`calculateReelQualityScore()` or critic-panel run** — flagged honestly in §5.

### Concept A — "Legal isn't the same as safe" two-number reveal (SELECTED)

Cold open on a tread-depth gauge dipped into a wet groove in the rain; VO states the number
everyone knows (2/32" legal minimum), then reveals it's the wrong number to trust, landing on the
two numbers that actually matter and why they're seasonal.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 8 | 10 | 9 | 6 | 4 | 10 | **47** |

Below the skill's `≥57/60` sub-threshold for "winning concept" — see §5's honest accounting.

### Concept B — Split-screen "rain tire vs snow tire" demo (parked)

Side-by-side split screen: same tire, one half in a rain puddle, one half in snow, showing grip
failing at different depths on each side simultaneously. Parked because a true simultaneous
split-screen is a harder/costlier render (needs two consistent renders of the same object under
different conditions, not a beat progression) for a hook that isn't meaningfully stronger.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 8 | 10 | 8 | 6 | 5 | 9 | **46** |

---

## 3 · Claim evidence

No live `evidenceResolver.ts` / `EvidenceRecord` lookup ran (no DB access this session) — every
entailment below is **`not_evaluated`** in the pipeline's own vocabulary, not `supported`. Sourcing
follows the samples' own pattern: label-only proof citations, no fabricated URLs.

| Claim in this reel | Source note (label only) | Kind | Entailment |
|---|---|---|---|
| 2/32" is the legal minimum tread depth in most US states | Common regulatory fact (state DOT tire-wear-bar standards); already brand-voice-approved wording, `docs/REEL-SLATE-2026-07-31.md` item #16 | proof (pre-approved) | not_evaluated |
| Meaningful snow traction is lost below roughly 4/32" | Tire-industry consumer guidance (Tire Industry Association / manufacturer winter-traction bulletins); already brand-voice-approved wording, slate item #16 | proof (pre-approved) | not_evaluated |
| Hydroplaning risk climbs sharply below roughly 3/32" in wet conditions | NHTSA/tire-industry wet-traction consumer guidance; already brand-voice-approved wording, slate item #16 | proof (pre-approved) | not_evaluated |
| The legal minimum and the performance-safe depth are two different numbers, and drivers commonly conflate them | Common-knowledge framing (widely held driver assumption; not a shop-specific claim) | pain_point | not_evaluated |

No `businessFacts.ts` row was pulled — this script states no shop price, warranty, or hours, so the
"no `reel`/`social` channel in `FactChannel` yet" gap the skill flags doesn't apply here by design.

**No claim in this pack states a diagnosis as certain.** Every line uses the approved soft-language
bank from `client/src/lib/facelessReelStudio.ts`: *worth checking · one clue · stop by and we'll
take a look*. The script never tells a viewer their specific tires are unsafe — it states the
general thresholds and invites a check.

---

## 4 · Production pack

### Storyboard (30s: Hook 0-2 → Setup 2-5 → Value 5-25 → CTA 25-30 + 3s freeze = 33s runtime)

Archetype: **myth_vs_reality** (reveal structure — flagged for repetition overlap with the
PRESSURE sample and the battery-summer-heat pack in §1). Motion lenses: **rain_world** (wet macro
tread/gauge) for the hook, setup, and loop-seam CTA; **xray_cutaway** for the two threshold-reveal
beats; **product_ad_macro** for the two-numbers-side-by-side beat.

| Beat | Time | Visual | On-screen overlay (ffmpeg, not AI-generated) | Voiceover (word-for-word) |
|---|---|---|---|---|
| 1 · Hook | 0:00–0:02 | Rain-world macro: a tread-depth gauge dips into a wet tire groove, rain falling, dark wet asphalt catching streetlight | — | "Two-thirty-seconds is legal." |
| 2 · Setup | 0:02–0:05 | Same rain-world macro, gauge holds steady in the groove as rain intensifies | "LEGAL ≠ SAFE" | "Legal isn't the same as safe." |
| 3 · Value 1 | 0:05–0:10 | X-ray cutaway of the tire groove channeling water away from the contact patch, the water layer visibly thickening as tread depth shrinks | "BELOW 3/32\" · RAIN GRIP DROPS" | "Below three-thirty-seconds, rain grip drops fast — hydroplaning risk climbs sharply." |
| 4 · Value 2 | 0:10–0:15 | X-ray cutaway transitions: the same groove now packed with snow, less channel space visible as depth shrinks further | "BELOW 4/32\" · SNOW GRIP GOES NEXT" | "Below four-thirty-seconds, snow grip goes next." |
| 5 · Value 3 | 0:15–0:20 | Product-ad macro: the tire on a slow turntable, a rain-drop icon and a snowflake icon glowing on opposite sides of the tread (overlay, not baked into render) | "TWO NUMBERS · TWO SEASONS" | "Two different numbers. Two different seasons." |
| 6 · Value 4 | 0:20–0:25 | Rain-world macro returns: the gauge dips into the groove one more time, calm and steady, no rain this time — daylight | "ONE CHECK · BOTH ANSWERS" | "One check tells you both." |
| 7 · CTA | 0:25–0:30 | Rain-world macro pulls back to the beat-1 framing — gauge, wet groove, streetlight — rain returns, mirroring the opener (loop seam) | "WORTH CHECKING NOW" then CTA card fades in | "Worth checking before the next storm, not after." |
| 8 · SAVE freeze | 0:30–0:33 | Static hold on the CTA card | "Save both numbers — they matter at different times of year.\nStop by and we'll check yours, no charge.\nNick's Tire & Auto · 17625 Euclid Ave, Cleveland · (216) 862-0005" | (silent — ambient tone only) |

Standing negative prompt for every beat, per the pipeline's real M10 preflight contract: **faces,
hands, human figures, on-screen text, logos, watermarks, subtitles** (all on-screen words are
ffmpeg overlays added at assembly, never asked of the video generator — matches the hard constraint
in `REEL-SLATE-2026-07-31.md`: *"No text or branding in-frame. M10 preflight blocks it [Seedance
cannot spell]"*). No real person's name appears anywhere in this script.

### Full voiceover script, timed

```
[0:00–0:02] Two-thirty-seconds is legal.
[0:02–0:05] Legal isn't the same as safe.
[0:05–0:10] Below three-thirty-seconds, rain grip drops fast — hydroplaning risk climbs sharply.
[0:10–0:15] Below four-thirty-seconds, snow grip goes next.
[0:15–0:20] Two different numbers. Two different seasons.
[0:20–0:25] One check tells you both.
[0:25–0:30] Worth checking before the next storm, not after.
[0:30–0:33] (silent hold — CTA card only)
```

~55 spoken words over 30s (≈1.8 words/sec) — comfortable at both the Google Neural2-J and
ElevenLabs "Roger" default paces the real `reelVoice.ts` uses. Numbers are spelled out as
"two-thirty-seconds," "three-thirty-seconds," "four-thirty-seconds" for TTS pronunciation
reliability — fraction notation ("2/32\"") is reserved for the on-screen overlay text only, where
it's read visually rather than spoken by the TTS engine.

### Visual sourcing — pick ONE route before rendering

The prod pipeline's currently-pinned free lane (`template_stock`, per
`docs/operations/REEL-PIPELINE.md`) generates **abstract Ken-Burns camera moves over a
solid/gradient backdrop** — it does not shoot literal wet-groove macros or x-ray cutaways. This
concept needs the rain-world and x-ray visuals to actually read, so `template_stock` alone will not
carry it. Three real options, in recommended order:

1. **Shop-shot footage (recommended for beats 5 and 8).** A real tire on the shop turntable/bench
   for the two-numbers macro beat, and the counter/storefront for the closing card — cheapest, zero
   licensing questions, most on-brand. A genuine rain-groove macro (beats 1, 2, 6, 7) is shootable
   on a phone on an actual rainy Cleveland day if the operator wants to wait for one; the x-ray
   cutaway beats (3, 4) are not practically shootable and need route 2 or 3 regardless.
2. **Higgsfield/Seedance clip generation** (currently NOT the prod-pinned route — would need
   `REEL_VIDEO_PROVIDER` flipped back and costs an estimated `$0.25/clip × 6 clips ≈ $1.50`, per
   `generationLedger.ts`'s `COST_ESTIMATES_USD`). Per-beat prompt pack below if this route is chosen.
3. **Licensed stock/motion-graphics footage** — fallback only if neither of the above is available.
   I have not sourced or verified any specific stock asset or URL (I don't fabricate URLs); the
   operator would search a licensed library for "tire tread gauge rain macro" and "tire tread x-ray
   technical visualization" and confirm commercial-use rights before use.

**Higgsfield-style prompt pack (route 2, if activated):**

| Beat | Prompt | Negative prompt |
|---|---|---|
| 1 | Macro shot of a tread-depth gauge dipping into a wet tire groove, rain falling, dark wet asphalt catching distant streetlight reflections, shallow depth of field | faces, hands, human figures, on-screen text, logos, watermarks, subtitles |
| 2 | Same rain macro world, the gauge holds steady in the groove as rain intensifies, water beading on the rubber surface | (same) |
| 3 | Technical x-ray cutaway visualization of a tire tread groove channeling water away from the contact patch, translucent layered materials, the water layer visibly thickening, cool schematic lighting, clean dark field | (same) |
| 4 | Technical x-ray cutaway visualization continues, the same groove now shown packed with snow, less open channel space visible, precise engineering aesthetic | (same) |
| 5 | Premium product commercial shot of a tire, 85mm macro lens, shallow depth of field, studio-grade key lighting on a dark seamless background, slow turntable rotation, blank overlay areas on opposite sides of the tread | (same) |
| 6 | Macro shot of a tread-depth gauge dipping into the same groove in daylight, calm, no rain, steady and confident framing | (same) |
| 7 | Macro rain-world pulls back to the beat-1 framing, gauge and wet groove under streetlight, rain returning, mirroring the opener for a loop seam | (same) |

### Assembly (ffmpeg — matches `reelAssembly.ts`'s real technique)

1. **Canvas:** 1080×1920 (9:16), 30fps target.
2. **Concatenate** the 6 motion clips (beats 1, 3, 4, 5, 6, 7 — beat 2 reuses beat 1's clip held
   longer, since the setup line just lets the gauge steady) with hard cuts at each beat boundary,
   matching the samples' documented style (`"hard cuts on beats 2/4"`). A slow dissolve, not a hard
   cut, works better on the beat 2→3 transition (rain macro → x-ray cutaway) since it's a
   world-change, not a beat-to-beat cut.
3. **Caption burn-in:** word-level ASS subtitles synced to the VO timing above (karaoke-style
   word-highlight if the ElevenLabs TTS lane with alignment timestamps is used; otherwise beat-synced
   caption blocks off the Google TTS SSML pacing). `PlayResX/Y 1080x1920`, safe zone: keep all text
   inside the middle 60% of frame width and clear of the bottom 20% (UI overlap zone).
4. **Overlay text** (drawtext, NOT part of the generated video): "LEGAL ≠ SAFE," "BELOW 3/32\" ·
   RAIN GRIP DROPS," "BELOW 4/32\" · SNOW GRIP GOES NEXT," "TWO NUMBERS · TWO SEASONS," "ONE CHECK ·
   BOTH ANSWERS," "WORTH CHECKING NOW," and the CTA card in beat 8.
5. **Audio mix:** VO track centered; no music bed by default — see §6 (rights gap). A soft rain
   ambience under beats 1, 2, 6, 7 and a light chime on each threshold reveal (beats 3, 4) are short
   SFX/ambience, not a licensed music track, and carry no rights question.
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
| Shop-shot footage (beats 5, 8 fully; 1/2/6/7 possible on an actual rainy day) | **$0** | Cheapest route; the x-ray cutaway beats (3, 4) are not practically shootable and need route 2 or 3 regardless |
| `template_stock` (prod default) | **$0/clip** | Free, but produces abstract backdrops — unsuitable for this concept's rain-macro/x-ray beats as-is (see §4) |
| Higgsfield/Seedance (currently inactive route) | **≈$0.25 × 6 clips ≈ $1.50**, labeled an ASSUMPTION in the source comment, not a metered price | Would need `REEL_VIDEO_PROVIDER` flipped — an operator/config decision, not mine to make |
| TTS (Google Neural2-J or ElevenLabs) | Not itemized in the cost table read | Google lane is free-quota; ElevenLabs is the paid fallback only if Google fails |

**Honest self-score against the real 75-point gate** (see §2's per-concept table): estimating this
pack manually against `calculateReelQualityScore()`'s known weights —

first-frame 7/10 (a gauge dipping into a wet groove is a solid but not exceptional scroll-stop —
weaker than a literal reveal or a character) · muted-first 9/10 (the rain visuals and macro gauge
read fine muted, and the overlay text carries the numeric payload) · beat structure 5/5 · length
5/5 · loop 5/5 (fixed via the beat-7 mirror pull-back) · sourced fact 9/10 (all three numeric claims
are pre-approved slate wording, label-only not live-entailed) · faceless 10/10 · claim safety 10/10
· keyword 5/5 · winning-concept bonus 0/5 (Concept A scored 47/60 in §2, below the skill's stated
`≥57/60` sub-threshold) — **estimated total ≈65/75**, below the real gate's 70/75 floor.

That's a genuine finding, not false modesty: the "local" dimension is the weakest one here (this
script carries no Cleveland-specific detail beyond the CTA block — unlike, say, the POTHOLE sample's
freeze-thaw framing), and the "absurdity/character" dimension is flat because a gauge and an x-ray
cutaway are both fairly literal, not a strong conceptual bit. An editor's pass on those two
dimensions, or reconsidering whether a character-driven treatment (a "gauge that tells the truth"
conceit, similar in spirit to the parked BATTERY Concept B) scores higher, is worth doing before
spending render budget.

---

## 6 · Audio/music rights status

**No music-rights ledger exists in this repo** — confirmed real gap, not an oversight on my part.
This pack defaults to **no licensed music bed**: VO (Google TTS / ElevenLabs, both real working
lanes with no rights question) plus short SFX/ambience (rain, threshold chimes) mixed under it. If
the operator wants a music bed, the lowest-friction, zero-rights-question option is Meta's own
built-in royalty-free audio library inside the Instagram/Facebook Reels composer (pre-cleared for
that platform) — I have not selected or verified a specific track, since I have no live access to
browse it.

---

## 7 · QA matrix

| Gate | Verdict | Backed by |
|---|---|---|
| Claim-safety wording (no prices, no guarantees, approved soft language) | **PASS** | Manual check against `client/src/lib/facelessReelStudio.ts`'s approved phrase list — script uses "worth checking," never states a specific tire as unsafe |
| Brand-voice kill list (`shared/voice.ts`) | **PASS (manual)** | Manually checked every VO/caption/hashtag line against the kill-list categories described in prior packs — no obvious hits; **not run through the live linter**, since this session has no path to it |
| Faceless / standing negative prompt compliance | **PASS (by design of the prompts)** | Prompt pack in §4 carries the standing negative prompt on every beat; storyboard has no faces/hands/human figures |
| Repetition ledger (21-day, live DB) | **UNKNOWN** | Not queried — no live DB access this session (see §1) |
| Render-integrity gate (`reelAssembly.ts` #800/#801: duration, frame count, motion-proof MD5 check) | **UNKNOWN / N/A** | Nothing was rendered — no file exists to `ffprobe` |
| Rendered QA vision critic (`renderedQa.ts`) | **UNKNOWN** | Not run — requires an actual rendered file and a live call |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED** | Never called — no `reel-canary` access this session, and publish requires live operator authorization regardless (§9) |
| Quality score vs. live 70/75 floor | **FAIL (estimated)** | My own manual estimate in §5 is ≈65/75 — below the stated floor. Flagged, not hidden. |

---

## 8 · IG/FB copy — 2 ad-ready variants

Format follows the account's current, data-corrected house style
(`docs/REEL-SLATE-2026-07-31.md`): short punchy lines, a SEND-oriented CTA (this account's posted
reels have measured `saved = 0.00`; the corrected objective is watch time and sends, not saves).
Hashtags capped at 4 (Instagram's Dec-2025 hard cap of 5, minus headroom), lowercase per the current
slate's convention.

### Variant A — SEND-first (primary recommendation, matches the corrected house strategy)

> 2/32" is the legal minimum. It is not the safe one.
>
> Below 3/32", hydroplaning risk climbs sharply in rain. Below 4/32", you lose meaningful grip in
> snow.
>
> Legal and safe are two different numbers — and they matter at different times of year.
>
> Worth checking before the next storm, not after.
>
> #tiresafety #cartips #clevelandohio #euclidohio

### Variant B — Comment-keyword style (matches the older Studio samples' `campaignKeyword` convention)

> Think 2/32" means you're safe?
>
> That's the legal minimum — not the safe one. Rain grip starts dropping below 3/32". Snow grip
> goes next below 4/32". Two different numbers, two different seasons.
>
> Comment TWONUMBERS and we'll check yours when you stop by, no charge.
>
> #tiresafety #cartips #clevelandohio #euclidohio

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

1. **Triage the 18 open reel-pack PRs before this one adds a 19th to the pile** (§0's backlog
   flag) — merge, close, or explicitly batch-approve the ones worth keeping; the review step, not
   content generation, is the current bottleneck.
2. Pick a visual-sourcing route (§4) — shop-shot footage alone covers only 2 of 6 motion beats
   outright (a rainy-day phone shoot could cover 2 more); this concept likely needs Higgsfield/
   Seedance or licensed stock for the x-ray beats at minimum.
3. Either run this concept through the real Studio/critic tooling to get a live quality score (the
   manual estimate in §5 suggests it needs a punch-up pass, particularly on the "local" and
   "absurdity" dimensions), or accept the estimate and iterate by hand.
4. Check `REEL_AUTOPOST_ENABLED` and today's post count before scheduling manually — the daily cron
   may already be posting today independent of this pack, and the account is capped at 2 feed
   posts/day with 3h spacing.
5. Drive it through `POST /api/admin/reel-canary` (`start` → `advance` → `qa`) to get an actual
   rendered, QA-gated asset — and only call `{action:"publish"}` with a live go-ahead for this
   specific asset, per both skill files' hard rule.
