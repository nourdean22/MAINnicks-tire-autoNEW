# Reel production pack — "Summer kills batteries, not winter" (BATTERY)

Scheduled-task run · 2026-08-16 · mode `INTELLIGENCE`/`PRODUCTION` (research + pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **BATTERY**

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
| `getHiggsfieldAccountHealth()` | **NOT QUERIED** — no shell path to the running server or its credentials from this session; `env` here has no `HIGGSFIELD_*`, `REEL_*`, `ADMIN_API_KEY`, or `DATABASE_URL` set at all |
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

- `apps/nickstire/docs/reel-packs/` — two prior packs exist: `2026-08-14-penny-test` (tread-depth
  check) and `2026-08-14-tire-expiration` (rubber aging), plus `2026-08-15-tread-fingerprint` (wear
  patterns → alignment/suspension). None overlap a battery topic.
- `apps/nickstire/docs/REEL-SLATE-2026-07-31.md` — 20 planned topics. Item #12, **"Battery warnings
  before it strands you,"** already carries a brand-voice-approved caption (slow crank / dim
  headlights / one jump start / 3–5 year lifespan / "save if yours is over three years old"). This
  pack builds the full production treatment for that item, reusing its approved facts but adding a
  hook/reveal structure the caption alone doesn't carry — see below for exactly what's new.
- `apps/nickstire/client/src/lib/facelessReelStudioSamples.ts` — 3 reference samples (PRESSURE,
  POTHOLE, BRAKES). No battery topic among them. **Archetype overlap flagged honestly:** this pack's
  "everyone blames winter, it's actually summer" reveal uses the `myth_vs_reality` archetype, the
  same archetype the PRESSURE sample uses (different topic — psi vs battery heat — but the same
  story shape). The real repetition ledger should confirm how recently `myth_vs_reality` ran before
  an operator enqueues this.

**Seasonal note, stated plainly:** today is 2026-08-16 (August, Cleveland). The slate's own caption
frames battery failure as a *winter* problem ("Cleveland winters are hard on them"). This pack
deliberately reframes around the less-known, better-supported mechanic fact that **heat is the
primary driver of battery degradation, not cold** (heat accelerates internal corrosion and
electrolyte loss all season; cold cranking amps just expose a battery already weakened by the
summer that preceded it) — both a stronger pattern-interrupt hook and a better seasonal fit for an
August posting date than a winter-framed script would be.

---

## 2 · Candidate concepts and scores

Two concepts considered, scored 0–10 per dimension on the sample briefs' rubric (hook / truth /
save / local / absurdity / fit). **These are my own manual estimates, not a live
`calculateReelQualityScore()` or critic-panel run** — flagged honestly in §5.

### Concept A — "Summer kills it, not winter" myth-reveal (SELECTED)

Cold open on a dashboard battery-warning icon in the dark; VO opens by naming the wrong villain
(winter) before revealing the real one (summer heat), then walks the three concrete warning signs
already in the slate's approved caption.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 9 | 9 | 8 | 6 | 5 | 10 | **47** |

Below the skill's `≥57/60` sub-threshold for "winning concept" — see §5's honest accounting.

### Concept B — Straight slate-caption read (parked)

Render the slate's existing caption verbatim as VO with no reveal structure: winter framing, no
myth-flip. Parked because it's flatter as a hook (states the seasonal warning directly instead of
earning it) even though it carries zero repetition risk on the archetype.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 6 | 9 | 7 | 7 | 3 | 10 | **42** |

---

## 3 · Claim evidence

No live `evidenceResolver.ts` / `EvidenceRecord` lookup ran (no DB access this session) — every
entailment below is **`not_evaluated`** in the pipeline's own vocabulary, not `supported`. Sourcing
follows the samples' own pattern: label-only proof citations, no fabricated URLs.

| Claim in this reel | Source note (label only) | Kind | Entailment |
|---|---|---|---|
| Heat accelerates internal battery corrosion and electrolyte loss more than cold shortens cranking power | AAA public research + battery-manufacturer technical bulletins (Interstate/AC Delco service literature) — heat is the leading cause of battery failure; cold typically reveals a battery already weakened by a hot season | proof | not_evaluated |
| Slow crank on cold mornings, headlights dimming at idle, and needing a jump once are early warning signs | Already brand-voice-approved wording, `docs/REEL-SLATE-2026-07-31.md` item #12 | proof (pre-approved) | not_evaluated |
| Most batteries last three to five years | Already brand-voice-approved wording, `docs/REEL-SLATE-2026-07-31.md` item #12 | proof (pre-approved) | not_evaluated |
| Drivers associate battery failure with winter and don't expect it in warm weather | Common-knowledge framing (widely held driver assumption; not a shop-specific claim) | pain_point | not_evaluated |

No `businessFacts.ts` row was pulled — this script states no shop price, warranty, or hours, so the
"no `reel`/`social` channel in `FactChannel` yet" gap the skill flags doesn't apply here by design.

**No claim in this pack states a diagnosis as certain.** Every line uses the approved soft-language
bank from `client/src/lib/facelessReelStudio.ts`: *worth checking · can point to*. This is a
deliberate constraint — the script says "worth checking," never "you need a new battery."

---

## 4 · Production pack

### Storyboard (30s: Hook 0-2 → Setup 2-5 → Value 5-25 → CTA 25-30 + 3s freeze = 33s runtime)

Archetype: **myth_vs_reality** (reveal structure — flagged for repetition overlap with the PRESSURE
sample in §1). Motion lenses: **warning_light_world** (dashboard interior) for the hook, reveal, and
loop-seam CTA; **xray_cutaway** for the two heat-damage beats; **product_ad_macro** for the
lifespan/warning-signs beat.

| Beat | Time | Visual | On-screen overlay (ffmpeg, not AI-generated) | Voiceover (word-for-word) |
|---|---|---|---|---|
| 1 · Hook | 0:00–0:02 | Dark dashboard-interior world, amber battery warning icon flickers awake out of black | — | "Everyone blames winter for this." |
| 2 · Setup | 0:02–0:05 | Same dashboard world, camera holds on the glowing icon as it steadies | "MYTH: WINTER KILLS BATTERIES" | "Summer is what actually kills your battery." |
| 3 · Value 1 | 0:05–0:10 | X-ray cutaway into a battery case, translucent layers showing fluid and plates under a heat-shimmer glow | "HEAT: THE REAL CAUSE" | "Heat cooks the acid and corrodes the plates all season, quietly." |
| 4 · Value 2 | 0:10–0:15 | X-ray cutaway continues, corrosion visibly building on the plates as the heat-shimmer glow fades to cool | — | "Then one cool morning, there's nothing left to give." |
| 5 · Value 3 | 0:15–0:20 | Back to dashboard warning-light world: engine cranks slow, headlights dim at idle, the icon flickers | "SLOW CRANK · DIM LIGHTS · ONE JUMP" | "Slow crank. Dim headlights at idle. One jump start already." |
| 6 · Value 4 | 0:20–0:25 | Product-ad macro: a battery on a slow turntable, studio light, a blank sticker area on the case (label added as ffmpeg overlay, never AI-rendered text) | "3–5 YEARS · HEAT CUTS IT SHORTER" | "Most batteries last three to five years — heat cuts that shorter." |
| 7 · CTA | 0:25–0:30 | Dashboard warning-light world again, icon flickers and fades to black — mirrors beat 1's opening framing (loop seam) | "WORTH CHECKING." then CTA card fades in | "Worth checking before it strands you." |
| 8 · SAVE freeze | 0:30–0:33 | Static hold on the CTA card | "Send this to whoever's battery is over three years old.\nStop by — we'll test it, no charge.\nNick's Tire & Auto · 17625 Euclid Ave, Cleveland · (216) 862-0005" | (silent — ambient tone only) |

Standing negative prompt for every beat, per the pipeline's real M10 preflight contract: **faces,
hands, human figures, on-screen text, logos, watermarks, subtitles** (all on-screen words are
ffmpeg overlays added at assembly, never asked of the video generator — matches the hard constraint
in `REEL-SLATE-2026-07-31.md`: *"No text or branding in-frame. M10 preflight blocks it [Seedance
cannot spell]"*). No real person's name appears anywhere in this script.

### Full voiceover script, timed

```
[0:00–0:02] Everyone blames winter for this.
[0:02–0:05] Summer is what actually kills your battery.
[0:05–0:10] Heat cooks the acid and corrodes the plates all season, quietly.
[0:10–0:15] Then one cool morning, there's nothing left to give.
[0:15–0:20] Slow crank. Dim headlights at idle. One jump start already.
[0:20–0:25] Most batteries last three to five years — heat cuts that shorter.
[0:25–0:30] Worth checking before it strands you.
[0:30–0:33] (silent hold — CTA card only)
```

~60 spoken words over 30s (≈2.0 words/sec) — comfortable at both the Google Neural2-J and
ElevenLabs "Roger" default paces the real `reelVoice.ts` uses.

### Visual sourcing — pick ONE route before rendering

The prod pipeline's currently-pinned free lane (`template_stock`, per
`docs/operations/REEL-PIPELINE.md`) generates **abstract Ken-Burns camera moves over a solid/gradient
backdrop** — it does not shoot literal dashboards or battery interiors. This concept needs the
dashboard-world and x-ray-cutaway visuals to actually read, so `template_stock` alone will not carry
it. Three real options, in recommended order:

1. **Shop-shot footage (recommended for beats 6 and 8).** A real battery on the shop counter/bench
   for the turntable macro beat, and the storefront/counter for the closing card — cheapest, zero
   licensing questions, most on-brand. Beats 1–5 (dashboard-interior world, x-ray cutaway) are not
   practically shootable on a phone and need route 2 or 3.
2. **Higgsfield/Seedance clip generation** (currently NOT the prod-pinned route — would need
   `REEL_VIDEO_PROVIDER` flipped back and costs an estimated `$0.25/clip × 6 clips ≈ $1.50`, per
   `generationLedger.ts`'s `COST_ESTIMATES_USD`). Per-beat prompt pack below if this route is chosen.
3. **Licensed stock/motion-graphics footage** — fallback only if neither of the above is available.
   I have not sourced or verified any specific stock asset or URL (I don't fabricate URLs); the
   operator would search a licensed library for "car dashboard warning light macro" and "battery
   x-ray technical visualization" and confirm commercial-use rights before use.

**Higgsfield-style prompt pack (route 2, if activated):**

| Beat | Prompt | Negative prompt |
|---|---|---|
| 1 | Inside a dark car dashboard interior world, an amber battery warning indicator light flickers awake out of black, deep blacks with amber bokeh glow, macro perspective | faces, hands, human figures, on-screen text, logos, watermarks, subtitles |
| 2 | Same dark dashboard interior world, the amber battery warning light holds steady and glows brighter, deep blacks with amber bokeh glow | (same) |
| 3 | Technical x-ray cutaway visualization of a car battery case, translucent layered materials showing internal fluid and plates, warm heat-shimmer glow, cool schematic lighting, clean dark field | (same) |
| 4 | Technical x-ray cutaway visualization continues, visible corrosion building on the internal plates, the heat-shimmer glow cooling to a dim blue, precise engineering aesthetic | (same) |
| 5 | Inside the dark dashboard interior world again, indicator lights dim and flicker unevenly as if power is fading, deep blacks with amber and red bokeh glow | (same) |
| 6 | Premium product commercial shot of a car battery, 85mm macro lens, shallow depth of field, studio-grade key lighting on a dark seamless background, slow turntable rotation, blank label area on the case | (same) |
| 7 | Inside the dark dashboard interior world, the amber battery warning light flickers and fades back to black, mirroring the beat-1 opening for a loop seam | (same) |

### Assembly (ffmpeg — matches `reelAssembly.ts`'s real technique)

1. **Canvas:** 1080×1920 (9:16), 30fps target.
2. **Concatenate** the 6 motion clips (beats 1, 3, 4, 5, 6, 7 — beat 2 reuses beat 1's clip held
   longer, since the setup line just lets the icon steady) with hard cuts at each beat boundary,
   matching the samples' documented style (`"hard cuts on beats 2/4"`). A slow dissolve, not a hard
   cut, works better on the beat 2→3 transition (dashboard world → x-ray cutaway) since it's a
   world-change, not a beat-to-beat cut.
3. **Caption burn-in:** word-level ASS subtitles synced to the VO timing above (karaoke-style
   word-highlight if the ElevenLabs TTS lane with alignment timestamps is used; otherwise beat-synced
   caption blocks off the Google TTS SSML pacing). `PlayResX/Y 1080x1920`, safe zone: keep all text
   inside the middle 60% of frame width and clear of the bottom 20% (UI overlap zone).
4. **Overlay text** (drawtext, NOT part of the generated video): "MYTH: WINTER KILLS BATTERIES,"
   "HEAT: THE REAL CAUSE," "SLOW CRANK · DIM LIGHTS · ONE JUMP," "3–5 YEARS · HEAT CUTS IT SHORTER,"
   "WORTH CHECKING," and the CTA card in beat 8.
5. **Audio mix:** VO track centered; no music bed by default — see §6 (rights gap). A low engine-idle
   hum under beats 1–2 and a soft warning-chime sting at the beat-1→2 icon-steady moment are short
   SFX, not a licensed music track, and carry no rights question.
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
| Shop-shot footage (beats 6, 8 only) | **$0** | Covers only 2 of 6 motion beats; beats 1–5 (dashboard world, x-ray cutaway) aren't practically shootable and need route 2 or 3 |
| `template_stock` (prod default) | **$0/clip** | Free, but produces abstract backdrops — unsuitable for this concept's dashboard/x-ray beats as-is (see §4) |
| Higgsfield/Seedance (currently inactive route) | **≈$0.25 × 6 clips ≈ $1.50**, labeled an ASSUMPTION in the source comment, not a metered price | Would need `REEL_VIDEO_PROVIDER` flipped — an operator/config decision, not mine to make |
| TTS (Google Neural2-J or ElevenLabs) | Not itemized in the cost table read | Google lane is free-quota; ElevenLabs is the paid fallback only if Google fails |

**Honest self-score against the real 75-point gate** (see §2's per-concept table): estimating this
pack manually against `calculateReelQualityScore()`'s known weights —

first-frame 8/10 (a flickering icon is a decent scroll-stop but weaker than a literal object reveal)
· muted-first 8/10 (dashboard-light visuals read fine muted; the myth/reveal text carries most of
the meaning, so overlay text quality matters more here than usual) · beat structure 5/5 · length 5/5
· loop 5/5 (fixed via the beat-7 mirror fade) · sourced fact 8/10 (two of the four claims are
pre-approved slate wording, label-only not live-entailed) · faceless 10/10 · claim safety 10/10 ·
keyword 5/5 · winning-concept bonus 0/5 (Concept A scored 47/60 in §2, below the skill's stated
`≥57/60` sub-threshold) — **estimated total ≈64/75**, below the real gate's 70/75 floor.

That's a genuine finding, not false modesty: the "local" dimension is the weakest one here (this
script carries no Cleveland-specific detail beyond the CTA block, unlike the slate's original
winter-Cleveland framing), and the "absurdity/character" dimension is flat because a dashboard icon
and an x-ray cutaway are both fairly literal, not a strong conceptual bit. An editor's pass on those
two dimensions — or reconsidering whether the winter-Cleveland framing (Concept B, parked) actually
scores higher despite its flatter hook — is worth doing before spending render budget.

---

## 6 · Audio/music rights status

**No music-rights ledger exists in this repo** — confirmed real gap, not an oversight on my part.
This pack defaults to **no licensed music bed**: VO (Google TTS / ElevenLabs, both real working
lanes with no rights question) plus short SFX stings (engine-idle hum, warning-chime) mixed under
it. If the operator wants a music bed, the lowest-friction, zero-rights-question option is Meta's
own built-in royalty-free audio library inside the Instagram/Facebook Reels composer (pre-cleared
for that platform) — I have not selected or verified a specific track, since I have no live access
to browse it.

---

## 7 · QA matrix

| Gate | Verdict | Backed by |
|---|---|---|
| Claim-safety wording (no prices, no guarantees, approved soft language) | **PASS** | Manual check against `client/src/lib/facelessReelStudio.ts`'s approved phrase list — script uses "worth checking," never states a diagnosis as certain |
| Brand-voice kill list (`shared/voice.ts`) | **PASS (manual)** | Manually checked every VO/caption/hashtag line against the kill-list categories described in prior packs — no obvious hits; **not run through the live linter**, since this session has no path to it |
| Faceless / standing negative prompt compliance | **PASS (by design of the prompts)** | Prompt pack in §4 carries the standing negative prompt on every beat; storyboard has no faces/hands/human figures |
| Repetition ledger (21-day, live DB) | **UNKNOWN** | Not queried — no live DB access this session (see §1) |
| Render-integrity gate (`reelAssembly.ts` #800/#801: duration, frame count, motion-proof MD5 check) | **UNKNOWN / N/A** | Nothing was rendered — no file exists to `ffprobe` |
| Rendered QA vision critic (`renderedQa.ts`) | **UNKNOWN** | Not run — requires an actual rendered file and a live call |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED** | Never called — no `reel-canary` access this session, and publish requires live operator authorization regardless (§9) |
| Quality score vs. live 70/75 floor | **FAIL (estimated)** | My own manual estimate in §5 is ≈64/75 — below the stated floor. Flagged, not hidden. |

---

## 8 · IG/FB copy — 2 ad-ready variants

Format follows the account's current, data-corrected house style
(`docs/REEL-SLATE-2026-07-31.md`): short punchy lines, a SEND-oriented CTA (this account's posted
reels have measured `saved = 0.00`; the corrected objective is watch time and sends, not saves).
Hashtags capped at 4 (Instagram's Dec-2025 hard cap of 5, minus headroom), lowercase per the current
slate's convention.

### Variant A — SEND-first (primary recommendation, matches the corrected house strategy)

> Everyone blames winter for this.
>
> Summer is what actually kills your battery. Heat cooks the acid and corrodes the plates all
> season, quietly — then one cool morning, there's nothing left to give.
>
> Slow crank. Dim headlights at idle. One jump start already. Most batteries last three to five
> years — heat cuts that shorter.
>
> Worth checking before it strands you.
>
> #carbattery #summercarcare #clevelandohio #euclidohio

### Variant B — Comment-keyword style (matches the older Studio samples' `campaignKeyword` convention)

> Think batteries only die in winter?
>
> Heat is the real killer — it's been quietly corroding your battery all summer, and cold mornings
> just finish the job. Slow crank, dim headlights at idle, one jump start already: those are the
> tells.
>
> Comment BATTERY and we'll test it when you stop by, no charge.
>
> #carbattery #summercarcare #clevelandohio #euclidohio

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

1. Pick a visual-sourcing route (§4) — shop-shot footage alone only covers 2 of 6 beats; this
   concept likely needs Higgsfield/Seedance or licensed stock for the dashboard/x-ray beats.
2. Either run this concept through the real Studio/critic tooling to get a live quality score (the
   manual estimate in §5 suggests it needs a punch-up pass, particularly on the "local" dimension —
   consider whether the parked winter-Cleveland framing in Concept B actually tests better), or
   accept the estimate and iterate by hand.
3. Check `REEL_AUTOPOST_ENABLED` and today's post count before scheduling manually — the daily cron
   may already be posting today independent of this pack, and the account is capped at 2 feed
   posts/day with 3h spacing.
4. Drive it through `POST /api/admin/reel-canary` (`start` → `advance` → `qa`) to get an actual
   rendered, QA-gated asset — and only call `{action:"publish"}` with a live go-ahead for this
   specific asset, per both skill files' hard rule.
