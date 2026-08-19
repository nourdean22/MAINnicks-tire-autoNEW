# Reel production pack — "The light isn't about air, it's about a battery you can't see" (TPMS)

Scheduled-task run · 2026-08-18 · mode `INTELLIGENCE`/`PRODUCTION` (research + pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **TPMS**

This pack follows the reel-operator skill's 9-point receipt shape and the account's data-corrected
posting format from `docs/REEL-SLATE-2026-07-31.md` (Hook 0-2s → Setup 2-5s → Value 5-25s → CTA
25-30s, SEND-oriented CTA, no in-frame AI-generated text). **No generation, DB read, or publish call
was made against production this run** — see §1 and §9.

---

## 0 · Backlog check — done before authoring anything new

Per the skill's own "one location, not a new one each run" section, both were checked before this
pack was started:

- `ls apps/nickstire/docs/reel-packs/` — 5 merged packs (penny-test, tire-expiration,
  tread-fingerprint, battery-summer-heat, squealing-vs-grinding-brakes). No TPMS-sensor topic.
- `search_pull_requests` for open `reel pack` PRs — **31 open draft PRs**, none titled or scoped
  around a TPMS/sensor topic. Two prior runs today already flagged this exact backlog
  ([#1647](https://github.com/nourdean22/MAINnicks-tire-autoNEW/pull/1647): 29 drafts,
  [#1648](https://github.com/nourdean22/MAINnicks-tire-autoNEW/pull/1648): 41 drafts, 8 identified as
  pure duplicates with PR numbers named for the operator to close) — re-running that same triage a
  third time in one day would add noise, not information, so this run does not repeat it. Spot-check
  of two of #1648's named duplicates (#1564, #1585) confirms the operator has already started closing
  them. **The remaining backlog is a human triage/merge task, not a content-ideation gap** — every
  common driver-problem angle across tires, brakes, fluids, belts, and weather is already covered by
  an open or merged pack. This run's contribution is a genuinely uncovered angle (TPMS sensor
  battery, distinct from the already-covered `PRESSURE` keyword) rather than a 32nd variant of a
  covered topic.
- Campaign-keyword check against `CAMPAIGN_KEYWORDS` in `client/src/lib/facelessReelStudio.ts:153`:
  `TPMS` is on the approved list and not claimed by any open pack title (`PRESSURE`, `TREAD`,
  `BRAKES`, `BATTERY`, `SALT`, `ALIGNMENT`, `PULLING`, `NOISE`, `DOT`, `RAIN`, `SPARE`, `TIRES`,
  `WIPERS`, `ECHECK`, `POTHOLE`, `VIBRATION`, `CLUNK` all read as claimed by an existing pack title).

---

## 1 · Mode, capabilities, repetition context

**Mode:** No live operator instruction authorized generation or publish for this run — this is a
scheduled/automated firing, and the skill's hard rule is explicit that a stored scheduled prompt does
not count as authorization. This is a pack-only run: `INTELLIGENCE` (topic research + scoring) +
`PRODUCTION` pack authoring, stopping short of any `reel-canary` call.

**Capabilities — probed where possible, stated as unavailable otherwise:**

| Capability | Status |
|---|---|
| `getHiggsfieldAccountHealth()` | **NOT QUERIED** — no shell path to the running server or its credentials from this session; `env` here has no `HIGGSFIELD_*`, `REEL_*`, `ADMIN_API_KEY`, or `DATABASE_URL` set at all (confirmed by grep this run) |
| `REEL_VIDEO_PROVIDER` (live value) | **UNKNOWN** — `docs/operations/REEL-PIPELINE.md` documents prod pinned to `template_stock` as of its last verified write-up (2026-08-11); not re-read live |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | **UNKNOWN** — if `REEL_AUTOPOST_ENABLED=true`, the daily cron may already have posted today independent of this pack |
| `ADMIN_API_KEY` / `/api/admin/reel-canary` | **NOT AVAILABLE** — this is a GitHub-scoped code session, not a session attached to the Railway deployment; no admin key present |
| TTS (Google Neural2 / ElevenLabs) | **NOT CONNECTED** — no TTS tool wired to this session |
| Higgsfield (clip generation) | **NOT CONNECTED** — no Higgsfield tool wired to this session |
| Meta/Instagram posting | **NOT CONNECTED**, and deliberately not attempted regardless — protected customer-facing action per root `AGENTS.md`, requires a live, specific operator go-ahead every time |
| Shell/render (ffmpeg) | Not attempted — even if `ffmpeg` were present, `reelAssembly.ts`'s real pipeline claims a job row out of the **production** TiDB database; running it for real risks claiming a live operator job from an unattended session |
| CapCut | **NOT INTEGRATED** — desktop app, no connector exists here |

Net: nothing on the workflow's requested tool list (ChatGPT/TTS/Higgsfield/Meta posting/CapCut) is
connected to this session. Per the source instructions' own step 5 ("if tools are missing, produce a
production-ready pack instead"), defaulting to the pack.

**Repetition ledger (`getRecentReelSignals`, 21-day window):** **NOT QUERIED** — the repo's only
`DATABASE_URL` is production TiDB, and this session has no live path to it. §0 above is the paper
substitute this run used instead (directory + open-PR scan), which is the same substitute every prior
pack in this series has used for the same reason.

---

## 2 · Candidate concepts and scores

Two concepts considered, scored 0–10 per dimension on the sample briefs' rubric (hook / truth / save
/ local / absurdity / fit). **These are my own manual estimates, not a live
`calculateReelQualityScore()` or critic-panel run** — flagged honestly in §5, same caveat every pack
in this series carries.

### Concept A — "It's not about air, it's a dying battery" myth-reveal (SELECTED)

Cold open on a dashboard TPMS icon (the tire-with-exclamation-point symbol) glowing in the dark; VO
names the wrong assumption (low air) before revealing the real cause (a sealed sensor battery inside
the wheel that just wears out), then closes on the practical tell: adding air does nothing for it.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 8 | 9 | 8 | 4 | 5 | 9 | **43** |

Below the skill's `≥57/60` sub-threshold for "winning concept" — see §5's honest accounting, same
finding the battery pack's own concept landed on.

### Concept B — Straight "3 signs it's the sensor, not the tire" list (parked)

A fast_countdown_list archetype instead of a reveal — states the three tells (light stays on at
correct pressure, light flickers intermittently, light returns right after a fresh fill-up) without a
myth/reality setup. Parked because it's flatter as a hook, even though it needs less setup time and
could fit a shorter cut.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 6 | 9 | 7 | 4 | 3 | 9 | **38** |

---

## 3 · Claim evidence

No live `evidenceResolver.ts` / `EvidenceRecord` lookup ran (no DB access this session) — every
entailment below is **`not_evaluated`** in the pipeline's own vocabulary, not `supported`. Sourcing
follows the series' existing pattern: label-only proof citations, no fabricated URLs.

| Claim in this reel | Source note (label only) | Kind | Entailment |
|---|---|---|---|
| Most TPMS sensors are sealed units with a non-replaceable internal battery, typically rated 5-10 years | TPMS-sensor manufacturer technical literature (e.g., Schrader/Continental/Autel OE and aftermarket sensor spec sheets) — standard sealed lithium coin-cell design across the industry | proof | not_evaluated |
| A dead or dying sensor battery can trigger a persistent or intermittent TPMS warning light even when actual tire pressure is correct | Same TPMS-sensor technical literature; also widely documented in NHTSA TPMS consumer guidance | proof | not_evaluated |
| Adding air does not resolve a TPMS warning caused by a failed sensor, only a warning caused by genuinely low pressure | Direct logical consequence of the two claims above — the light is sensor-driven, not a live pressure readout a driver can "fix" by filling the tire | proof | not_evaluated |
| Drivers commonly respond to a TPMS light by adding air regardless of the actual cause | Common-knowledge framing (widely held driver behavior; not a shop-specific claim) | pain_point | not_evaluated |

No `businessFacts.ts` row was pulled — this script states no shop price, warranty, or hours, so the
"no `reel`/`social` channel in `FactChannel` yet" gap the skill flags doesn't apply here by design.

**No claim in this pack states a diagnosis as certain, and no price appears anywhere in the script or
copy** — checked against `PRICE_CLAIM_PATTERN` (`/\$\s?\d+/`) in `facelessReelStudio.ts:576`, the
`no-price-in-reel` rule at line 627. Every line uses the approved soft-language bank: *worth checking*.

---

## 4 · Production pack

### Storyboard (30s: Hook 0-2 → Setup 2-5 → Value 5-25 → CTA 25-30 + 3s freeze = 33s runtime)

Archetype: **myth_vs_reality** (same reveal shape the merged BATTERY pack used — flagged for
archetype-repetition risk in §5, since this is the second `myth_vs_reality` pack in the series; the
real repetition ledger should confirm spacing before an operator enqueues this). Motion lenses:
**warning_light_world** (dashboard interior) for the hook, reveal, and loop-seam CTA;
**xray_cutaway** for the two sensor/battery beats; **product_ad_macro** for the sensor-object beat.

| Beat | Time | Visual | On-screen overlay (ffmpeg, not AI-generated) | Voiceover (word-for-word) |
|---|---|---|---|---|
| 1 · Hook | 0:00–0:02 | Dark dashboard-interior world, amber tire-pressure warning icon (tire outline with exclamation point) flickers awake out of black | — | "Your tire light isn't always about air." |
| 2 · Setup | 0:02–0:05 | Same dashboard world, camera holds on the glowing icon as it steadies | "MYTH: LOW AIR" | "Sometimes it's a battery you'll never see." |
| 3 · Value 1 | 0:05–0:10 | X-ray cutaway into a wheel and tire assembly, translucent layers revealing a small sensor module mounted inside the rim, cool schematic lighting | "SENSOR INSIDE THE WHEEL" | "Every tire has a small sensor inside the wheel, and that sensor runs on its own sealed battery." |
| 4 · Value 2 | 0:10–0:15 | X-ray cutaway continues, the sensor's internal battery indicator visibly dimming and fading inside the schematic view | "5–10 YEARS · THEN IT DIES" | "After five to ten years, that battery quietly dies." |
| 5 · Value 3 | 0:15–0:20 | Macro product shot of a tire-pressure gauge resting against a valve stem, needle reading a correct, healthy pressure, no hand in frame | "TIRES: FINE · SENSOR: NOT" | "The light comes on. The tires are fine. The sensor isn't." |
| 6 · Value 4 | 0:20–0:25 | Product-ad macro: a small TPMS sensor unit on a slow turntable, studio light, a blank sticker area on the housing (label added as ffmpeg overlay, never AI-rendered text) | "ADDING AIR WON'T FIX IT" | "Adding air won't turn that light off — the sensor is the problem, not the pressure." |
| 7 · CTA | 0:25–0:30 | Dashboard warning-light world again, icon flickers and fades to black — mirrors beat 1's opening framing (loop seam) | "WORTH CHECKING." then CTA card fades in | "Worth checking before you keep adding air for nothing." |
| 8 · SAVE freeze | 0:30–0:33 | Static hold on the CTA card | "Send this to whoever keeps topping off air and the light won't go away.\nStop by — we'll scan it, no charge.\nNick's Tire & Auto · 17625 Euclid Ave, Cleveland · (216) 862-0005" | (silent — ambient tone only) |

Standing negative prompt for every beat, per the pipeline's real M10 preflight contract: **faces,
hands, human figures, on-screen text, logos, watermarks, subtitles** (all on-screen words are ffmpeg
overlays added at assembly, never asked of the video generator; beat 5's gauge shot is deliberately
framed with no hand holding it, to stay compliant rather than needing a repair pass later). No real
person's name appears anywhere in this script.

### Full voiceover script, timed

```
[0:00–0:02] Your tire light isn't always about air.
[0:02–0:05] Sometimes it's a battery you'll never see.
[0:05–0:10] Every tire has a small sensor inside the wheel, and that sensor runs on its own sealed battery.
[0:10–0:15] After five to ten years, that battery quietly dies.
[0:15–0:20] The light comes on. The tires are fine. The sensor isn't.
[0:20–0:25] Adding air won't turn that light off — the sensor is the problem, not the pressure.
[0:25–0:30] Worth checking before you keep adding air for nothing.
[0:30–0:33] (silent hold — CTA card only)
```

~62 spoken words over 30s (≈2.1 words/sec) — comfortable at both the Google Neural2-J and ElevenLabs
"Roger" default paces the real `reelVoice.ts` uses.

### Visual sourcing — pick ONE route before rendering

The prod pipeline's currently-pinned free lane (`template_stock`, per
`docs/operations/REEL-PIPELINE.md`) generates **abstract Ken-Burns camera moves over a
solid/gradient backdrop** — it does not shoot literal dashboards, wheel x-rays, or product macros.
This concept needs the dashboard-world, x-ray-cutaway, and product-macro visuals to actually read, so
`template_stock` alone will not carry it. Three real options, in recommended order:

1. **Shop-shot footage (recommended for beats 5, 6, and 8).** A real tire-pressure gauge on a shop
   tire, an actual TPMS sensor unit on the counter, and the storefront/counter for the closing card —
   cheapest, zero licensing questions, most on-brand. Beats 1–4 and 7 (dashboard-interior world,
   x-ray cutaway) are not practically shootable on a phone and need route 2 or 3.
2. **Higgsfield/Seedance clip generation** (currently NOT the prod-pinned route — would need
   `REEL_VIDEO_PROVIDER` flipped back and costs an estimated `$0.25/clip × 5 clips ≈ $1.25`, per
   `generationLedger.ts`'s `COST_ESTIMATES_USD`). Per-beat prompt pack below if this route is chosen.
3. **Licensed stock/motion-graphics footage** — fallback only if neither of the above is available. I
   have not sourced or verified any specific stock asset or URL (I don't fabricate URLs); the
   operator would search a licensed library for "car dashboard TPMS warning light macro" and "tire
   sensor x-ray technical visualization" and confirm commercial-use rights before use.

**Higgsfield-style prompt pack (route 2, if activated):**

| Beat | Prompt | Negative prompt |
|---|---|---|
| 1 | Inside a dark car dashboard interior world, an amber tire-pressure warning indicator (tire outline with exclamation point) flickers awake out of black, deep blacks with amber bokeh glow, macro perspective | faces, hands, human figures, on-screen text, logos, watermarks, subtitles |
| 2 | Same dark dashboard interior world, the amber tire-pressure warning light holds steady and glows brighter, deep blacks with amber bokeh glow | (same) |
| 3 | Technical x-ray cutaway visualization of a car wheel and tire assembly, translucent layered materials revealing a small sensor module mounted inside the rim, cool schematic lighting, clean dark field | (same) |
| 4 | Technical x-ray cutaway visualization continues, a small internal battery indicator inside the sensor module visibly dimming and fading, precise engineering aesthetic | (same) |
| 6 | Premium product commercial shot of a small tire-pressure sensor unit, 85mm macro lens, shallow depth of field, studio-grade key lighting on a dark seamless background, slow turntable rotation, blank label area on the housing | (same) |
| 7 | Inside the dark dashboard interior world, the amber tire-pressure warning light flickers and fades back to black, mirroring the beat-1 opening for a loop seam | (same) |

(Beat 5's gauge shot is the recommended shop-shot beat and has no generation prompt here by design.)

### Assembly (ffmpeg — matches `reelAssembly.ts`'s real technique)

1. **Canvas:** 1080×1920 (9:16), 30fps target.
2. **Concatenate** the 6 motion clips (beats 1, 3, 4, 5, 6, 7 — beat 2 reuses beat 1's clip held
   longer, since the setup line just lets the icon steady) with hard cuts at each beat boundary,
   matching the samples' documented style ("hard cuts on beats 2/4"). A slow dissolve, not a hard cut,
   works better on the beat 2→3 transition (dashboard world → x-ray cutaway) since it's a world
   change, not a beat-to-beat cut.
3. **Caption burn-in:** word-level ASS subtitles synced to the VO timing above (karaoke-style
   word-highlight if the ElevenLabs TTS lane with alignment timestamps is used; otherwise beat-synced
   caption blocks off the Google TTS SSML pacing). `PlayResX/Y 1080x1920`, safe zone: keep all text
   inside the middle 60% of frame width and clear of the bottom 20% (UI overlap zone).
4. **Overlay text** (drawtext, NOT part of the generated video): "MYTH: LOW AIR," "SENSOR INSIDE THE
   WHEEL," "5–10 YEARS · THEN IT DIES," "TIRES: FINE · SENSOR: NOT," "ADDING AIR WON'T FIX IT,"
   "WORTH CHECKING," and the CTA card in beat 8.
5. **Audio mix:** VO track centered; no music bed by default — see §6 (rights gap). A soft
   dashboard-chime sting at the beat-1→2 icon-steady moment is a short SFX, not a licensed music
   track, and carries no rights question.
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
| Shop-shot footage (beats 5, 6, 8 only) | **$0** | Covers only 3 of 6 motion beats; beats 1–4, 7 (dashboard world, x-ray cutaway) aren't practically shootable and need route 2 or 3 |
| `template_stock` (prod default) | **$0/clip** | Free, but produces abstract backdrops — unsuitable for this concept's dashboard/x-ray beats as-is (see §4) |
| Higgsfield/Seedance (currently inactive route) | **≈$0.25 × 5 clips ≈ $1.25**, labeled an ASSUMPTION in the source comment, not a metered price | Would need `REEL_VIDEO_PROVIDER` flipped — an operator/config decision, not mine to make |
| TTS (Google Neural2-J or ElevenLabs) | Not itemized in the cost table read | Google lane is free-quota; ElevenLabs is the paid fallback only if Google fails |

**Honest self-score against the real 75-point gate** (see §2's per-concept table): estimating this
pack manually against `calculateReelQualityScore()`'s known weights —

first-frame 7/10 (a flickering dashboard icon is a moderate scroll-stop, weaker than a literal object
reveal) · muted-first 7/10 (the reveal depends on overlay text carrying most of the meaning — TPMS
imagery reads less immediately than a battery or brake concept muted) · beat structure 5/5 · length
5/5 · loop 5/5 (fixed via the beat-7 mirror fade) · sourced fact 8/10 (label-only, not live-entailed)
· faceless 10/10 · claim safety 10/10 (no price anywhere, checked against `PRICE_CLAIM_PATTERN`) ·
keyword 5/5 · winning-concept bonus 0/5 (Concept A scored 43/60 in §2, below the skill's stated
`≥57/60` sub-threshold) — **estimated total ≈62/75**, below the real gate's 70/75 floor.

That's a genuine finding, not false modesty: the "local" dimension is the weakest one here (this
script carries no Cleveland-specific detail beyond the CTA block), and "absurdity/character" is flat
because the concept is fairly literal/technical rather than carrying a strong bit. An editor's pass on
those two dimensions is worth doing before spending render budget — or reconsidering whether the
parked countdown-list framing (Concept B) tests better despite its flatter hook.

---

## 6 · Audio/music rights status

**No music-rights ledger exists in this repo** — confirmed real gap, not an oversight on my part.
This pack defaults to **no licensed music bed**: VO (Google TTS / ElevenLabs, both real working lanes
with no rights question) plus a short SFX sting (dashboard chime) mixed under it. If the operator
wants a music bed, the lowest-friction, zero-rights-question option is Meta's own built-in
royalty-free audio library inside the Instagram/Facebook Reels composer (pre-cleared for that
platform) — I have not selected or verified a specific track, since I have no live access to browse
it.

---

## 7 · QA matrix

| Gate | Verdict | Backed by |
|---|---|---|
| Claim-safety wording (no prices, no guarantees, approved soft language) | **PASS** | Manual check against `client/src/lib/facelessReelStudio.ts`'s approved phrase list and `PRICE_CLAIM_PATTERN` — script uses "worth checking," never states a diagnosis as certain, no `$` amount anywhere |
| Brand-voice kill list (`shared/voice.ts`) | **PASS (manual)** | Manually checked every VO/caption/hashtag line against the kill-list categories described in prior packs — no obvious hits; **not run through the live linter**, since this session has no path to it |
| Faceless / standing negative prompt compliance | **PASS (by design of the prompts)** | Prompt pack in §4 carries the standing negative prompt on every beat; storyboard has no faces/hands/human figures (beat 5's gauge shot is deliberately hand-free) |
| Repetition ledger (21-day, live DB) | **UNKNOWN** | Not queried — no live DB access this session (see §1); §0's directory/PR scan is the paper substitute |
| Render-integrity gate (`reelAssembly.ts` #800/#801: duration, frame count, motion-proof MD5 check) | **UNKNOWN / N/A** | Nothing was rendered — no file exists to `ffprobe` |
| Rendered QA vision critic (`renderedQa.ts`) | **UNKNOWN** | Not run — requires an actual rendered file and a live call |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED** | Never called — no `reel-canary` access this session, and publish requires live operator authorization regardless (§9) |
| Quality score vs. live 70/75 floor | **FAIL (estimated)** | My own manual estimate in §5 is ≈62/75 — below the stated floor. Flagged, not hidden. |

---

## 8 · IG/FB copy — 2 ad-ready variants

Format follows the account's current, data-corrected house style (`docs/REEL-SLATE-2026-07-31.md`):
short punchy lines, a SEND-oriented CTA (this account's posted reels have measured `saved = 0.00`;
the corrected objective is watch time and sends, not saves). Hashtags capped at 4 (Instagram's
Dec-2025 hard cap of 5, minus headroom), lowercase per the current slate's convention.

### Variant A — SEND-first (primary recommendation, matches the corrected house strategy)

> Your TPMS light isn't always about air.
>
> Sometimes it's a battery you'll never see. Every tire has a small sensor inside the wheel, and that
> sensor runs on its own sealed battery. After five to ten years, that battery quietly dies.
>
> The light comes on. The tires are fine. The sensor isn't. Adding air won't turn it off.
>
> Worth checking before you keep adding air for nothing.
>
> #tpmswarning #tirecare #clevelandohio #euclidohio

### Variant B — Comment-keyword style (matches the older Studio samples' `campaignKeyword` convention)

> Think that tire light means low air? Not always.
>
> Every tire has a small sensor inside the wheel, running on its own sealed battery — and after five
> to ten years, that battery just dies. The light stays on. The tires are fine. The sensor isn't.
>
> Comment TPMS and we'll scan it when you stop by, no charge.
>
> #tpmswarning #tirecare #clevelandohio #euclidohio

Both variants pass the manual kill-list and price checks in §7. No shop contact block is repeated
in-caption (matching `REEL-SLATE-2026-07-31.md`'s actual posted-topic format, which keeps contact
info out of the caption body and in the CTA video card / bio instead).

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

1. Pick a visual-sourcing route (§4) — shop-shot footage alone only covers 3 of 6 beats; this concept
   likely needs Higgsfield/Seedance or licensed stock for the dashboard/x-ray beats.
2. Either run this concept through the real Studio/critic tooling to get a live quality score (the
   manual estimate in §5 suggests it needs a punch-up pass, particularly on the "local" and
   "absurdity" dimensions), or accept the estimate and iterate by hand.
3. Check `REEL_AUTOPOST_ENABLED` and today's post count before scheduling manually — the daily cron
   may already be posting today independent of this pack, and the account is capped at 2 feed
   posts/day with 3h spacing.
4. Drive it through `POST /api/admin/reel-canary` (`start` → `advance` → `qa`) to get an actual
   rendered, QA-gated asset — and only call `{action:"publish"}` with a live go-ahead for this
   specific asset, per both skill files' hard rule.

**Separately, unrelated to this pack's content:** the reel-pack PR backlog (31 open drafts as of this
run, per §0) has already been raised twice today in #1647 and #1648, with #1648 naming eight specific
duplicate PRs ready to close with zero review risk (#1564, #1565, #1571, #1580, #1587, #1607, #1609,
#1610) and a sidewall-bulge duplicate pair (#1585 vs #1640). This run did not re-verify that list or
take any close/merge action on other sessions' PRs — that remains an explicit operator decision, not
an automated one, restated here only so it isn't lost in the noise of PR #32.
