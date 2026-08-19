# Reel production pack — "You didn't run over anything" (COLDSNAP)

Scheduled-task run · 2026-08-18 · mode `INTELLIGENCE`/`PRODUCTION` (research + pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **COLDSNAP**

This pack follows the reel-operator skill's 9-point receipt shape and the account's real,
data-corrected posting format from `docs/REEL-SLATE-2026-07-31.md` (Hook 0-2s → Setup 2-5s →
Value 5-25s → CTA 25-30s, SEND-oriented CTA, no in-frame AI-generated text). **No generation, DB
read, or publish call was made against production this run** — see §1 and §9.

---

## 0 · Read this first — backlog and slate status

**This run did not check for a pending queue before adding to it — and there is one.** As of this
run, `apps/nickstire/docs/reel-packs/` holds 5 **merged** packs, and a search for open PRs titled
"reel pack" returned **23 open, unmerged drafts** (`#1614`–`#1640`, opened 2026-08-16 23:33 through
2026-08-17 23:32 — roughly one every hour for a full day). None of them have been merged, closed, or
reviewed as far as this session can see. That is not a one-off; it is a pattern worth the operator's
attention independent of this pack's content.

Cross-referencing those 28 titles against `docs/REEL-SLATE-2026-07-31.md`'s 20 pre-approved topics:
**18 of the 20 slate items now have a pack** (merged or open-PR). Only two remain: **#3 "Cold weather
and the tire light"** (this pack) and **#11 "All-season vs winter tires"**. After this pack merges,
the pre-approved slate is effectively exhausted — any further scheduled run either has to draw on a
non-slate topic (as several of the 23 open PRs already have: coolant/exhaust/belt/wiper/road-trip
topics with no pre-approved caption) or the operator needs to review/merge/prune the existing backlog
before more accumulate on top of it.

**Recommendation, stated plainly and not acted on unilaterally:** triage the 23 open PRs (merge the
good ones, close superseded/duplicate ones) before this scheduled task fires again, and/or reduce its
firing cadence. Continuing to add one pack per hour to an unreviewed queue produces volume, not
throughput.

---

## 1 · Mode, capabilities, repetition context

**Mode:** No live operator instruction authorized generation or publish for this run — this is a
scheduled/automated firing, and the skill's hard rule is explicit that a stored scheduled prompt does
not count as authorization. This is a pack-only run: `INTELLIGENCE` (topic research + scoring) +
`PRODUCTION` pack authoring, stopping short of any `reel-canary` call.

**Capabilities — probed where possible, stated as unavailable otherwise:**

| Capability | Status |
|---|---|
| `getHiggsfieldAccountHealth()` | **NOT QUERIED** — no shell path to the running server or its credentials from this session; no `HIGGSFIELD_*`, `REEL_*`, `ADMIN_API_KEY`, or `DATABASE_URL` set here |
| `REEL_VIDEO_PROVIDER` (live value) | **UNKNOWN** — `docs/operations/REEL-PIPELINE.md` documented prod pinned to `template_stock` as of its last write-up; not re-read live |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | **UNKNOWN** — if `REEL_AUTOPOST_ENABLED=true`, the daily cron may already have posted today independent of this pack |
| `ADMIN_API_KEY` / `/api/admin/reel-canary` | **NOT AVAILABLE** — this is a GitHub-scoped code session, not one attached to the Railway deployment; no admin key present |
| TTS (Google Neural2 / ElevenLabs) | **NOT CONNECTED** — no TTS tool wired to this session |
| Higgsfield (clip generation) | **NOT CONNECTED** — no Higgsfield tool wired to this session |
| Meta/Instagram posting | **NOT CONNECTED**, and deliberately not attempted regardless — protected customer-facing action per root `AGENTS.md`, requires a live, specific operator go-ahead every time |
| Shell/render (ffmpeg) | Not attempted — even if `ffmpeg` were present, `reelAssembly.ts`'s real pipeline claims a job row out of the **production** TiDB database; running it for real risks claiming a live operator job from an unattended session |
| CapCut | **NOT INTEGRATED** — desktop app, no connector exists here |

Net: nothing on the workflow's requested tool list (ChatGPT/TTS/Higgsfield/Meta posting/CapCut) is
connected to this session. Per the source instructions' own step 5 ("if tools are missing, produce a
production-ready pack instead"), defaulting to the pack.

**Repetition ledger (`getRecentReelSignals`, 21-day window):** **NOT QUERIED** — the repo's only
`DATABASE_URL` is production TiDB, and this session has no live path to it. What I checked instead, as
a paper substitute:

- `apps/nickstire/docs/reel-packs/` (merged) — penny-test, tire-expiration, tread-fingerprint,
  battery-summer-heat, squealing-vs-grinding-brakes. None overlap a tire-pressure/TPMS topic.
- The 23 open-PR titles listed in §0 — none is a tire-pressure/TPMS topic either. The nearest
  neighbor is `#1624` "summer-heat tire-pressure," which is about heat expanding air in summer, the
  physical inverse of this pack's cold-contraction topic — related mechanism, opposite season and
  opposite warning trigger, not a duplicate.
- `apps/nickstire/client/src/lib/facelessReelStudioSamples.ts` — the **PRESSURE** reference sample
  is also tire-pressure-themed, using archetype `myth_vs_reality` + motion lens `xray_cutaway`
  (its myth: "everyone checks the wrong PSI number" — max-press sidewall number vs. the recommended
  door-jamb number). **Overlap flagged honestly:** same underlying subject (tire pressure), different
  specific myth (wrong number to check vs. why the light appears at all). This pack deliberately uses
  a different archetype/lens pairing (`caught_on_camera_documentary` + `forensic_evidence_scan`,
  matching the POTHOLE sample's investigative shape instead) to reduce format repetition even though
  the subject-matter adjacency remains. A live repetition-ledger check should confirm how recently a
  tire-pressure topic actually posted before an operator enqueues this.
- `docs/REEL-SLATE-2026-07-31.md` item **#3, "Cold weather and the tire light,"** already carries a
  brand-voice-approved caption (10°F-per-PSI fact, check-cold-before-driving advice, "save this for
  the first frost" CTA). This pack builds the full production treatment for that item, reusing its
  approved facts.

**Seasonal note, stated plainly:** today is 2026-08-18 (mid-August, Cleveland) — the opposite season
from this topic's trigger (first frost / cold-morning TPMS light). The slate item itself is written
for a cold-weather posting window. This pack is production-ready as a pre-approved topic, but an
operator should hold it for a fall posting date rather than publishing it in August — the "summer
heat tire-pressure" open PR (`#1624`) is the seasonally-correct pick for right now; this one is not.

---

## 2 · Candidate concepts and scores

Two concepts considered, scored 0–10 per dimension on the sample briefs' rubric (hook / truth / save
/ local / absurdity / fit). **These are my own manual estimates, not a live
`calculateReelQualityScore()` or critic-panel run** — flagged honestly in §5.

### Concept A — "You didn't run over anything" investigative reveal (SELECTED)

Cold open on a glowing TPMS dashboard icon with a diagnostic HUD reticle scanning it (mirrors the
PRESSURE sample's opening device, but the "case" being investigated is different); VO opens by naming
the driver's actual fear (a puncture) before ruling it out and revealing the real cause (temperature
physics), then walks the two concrete pieces of advice from the slate's approved caption.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 8 | 9 | 7 | 8 | 5 | 10 | **47** |

Below the skill's `≥57/60` sub-threshold for "winning concept" — see §5's honest accounting.

### Concept B — Straight slate-caption read (parked)

Render the slate's existing caption verbatim as VO with no investigative framing: states the 10°F/PSI
fact directly, no "you didn't run over anything" reveal. Parked because it's a flatter hook (states
the fact instead of first ruling out the driver's fear) even though it carries slightly less
subject-matter overlap risk with the PRESSURE sample.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 6 | 9 | 7 | 8 | 3 | 10 | **43** |

---

## 3 · Claim evidence

No live `evidenceResolver.ts` / `EvidenceRecord` lookup ran (no DB access this session) — every
entailment below is **`not_evaluated`** in the pipeline's own vocabulary, not `supported`. Sourcing
follows the samples' own pattern: label-only proof citations, no fabricated URLs.

| Claim in this reel | Source note (label only) | Kind | Entailment |
|---|---|---|---|
| Roughly 1 PSI is lost per 10°F drop in ambient temperature (tire air contracts with cold) | Basic gas-law physics (Gay-Lussac's law applied to tire inflation); commonly cited by tire manufacturers (e.g., Michelin, Goodyear consumer guidance) and already brand-voice-approved wording, `docs/REEL-SLATE-2026-07-31.md` item #3 | proof (pre-approved) | not_evaluated |
| The TPMS light commonly triggers on the first cold morning of a season, not from road damage | Direct consequence of the PSI-vs-temperature relationship above; already brand-voice-approved framing, same slate item | proof (pre-approved) | not_evaluated |
| Tires that have been driven on read a higher (warmer) pressure than their true cold pressure, which can mask a real underinflation | Standard tire-manufacturer guidance (check pressure "cold," i.e., before driving or after ≥3 hours parked); already brand-voice-approved wording, same slate item | proof (pre-approved) | not_evaluated |
| Drivers commonly assume a sudden dashboard warning light means damage (a puncture or impact) | Common-knowledge framing (widely held driver assumption; not a shop-specific claim) | pain_point | not_evaluated |

No `businessFacts.ts` row was pulled — this script states no shop price, warranty, or hours, so the
"no `reel`/`social` channel in `FactChannel` yet" gap the skill flags doesn't apply here by design.

**No claim in this pack states a diagnosis as certain.** Every line uses the approved soft-language
bank from `client/src/lib/facelessReelStudio.ts`: *worth checking*. The script explicitly rules out
one wrong conclusion (a puncture) before explaining the real, non-alarming cause — it never tells a
viewer their tire is damaged or that they must act immediately.

---

## 4 · Production pack

### Storyboard (30s: Hook 0-2 → Setup 2-5 → Value 5-25 → CTA 25-30 + 3s freeze = 33s runtime)

Archetype: **caught_on_camera_documentary** (investigative reveal — chosen over `myth_vs_reality` to
reduce format overlap with the PRESSURE sample, per §1). Motion lenses: **forensic_evidence_scan**
(dashboard + evidence-marker beats) and **product_ad_macro** (the pressure-gauge beat).

| Beat | Time | Visual | On-screen overlay (ffmpeg, not AI-generated) | Voiceover (word-for-word) |
|---|---|---|---|---|
| 1 · Hook | 0:00–0:02 | Extreme macro on a car dashboard TPMS warning icon glowing to life in a dark cabin, a thin diagnostic HUD reticle sweeps across it | — | "You didn't run over anything." |
| 2 · Setup | 0:02–0:05 | Same dashboard macro, the HUD reticle steadies and locks on the icon | "NOT DAMAGE." | "That warning light isn't damage — it's the weather." |
| 3 · Value 1 | 0:05–0:10 | Forensic evidence-scan: a scan-line sweeps across a tire sidewall in macro, an "EVIDENCE 1" marker pins a thermometer readout dropping | "EVIDENCE 1: −10°F ≈ −1 PSI" | "Every ten degrees the temperature drops pulls about one PSI out of every tire." |
| 4 · Value 2 | 0:10–0:15 | Forensic evidence-scan continues: a second marker pins a calendar/frost-on-glass detail, evidence board style | "EVIDENCE 2: THE FIRST COLD MORNING" | "That's why the light shows up on the first cold Cleveland morning — out of nowhere." |
| 5 · Value 3 | 0:15–0:20 | Product-ad macro: a tire pressure gauge held to a valve stem, needle settling on a reading, cool morning light | "WARM TIRES READ HIGH" | "Warm tires read high and hide the real number." |
| 6 · Value 4 | 0:20–0:25 | Product-ad macro continues: the same gauge on a *cold* tire, needle settling lower, a checkmark-style highlight on the true reading | "CHECK IT COLD, BEFORE YOU DRIVE" | "Check the pressure cold, before you drive — that's the number that counts." |
| 7 · CTA | 0:25–0:30 | Back to the dashboard macro from beat 1, the TPMS icon fades to black — mirrors beat 1's opening framing (loop seam) | "WORTH CHECKING." then CTA card fades in | "Worth checking before that first frost." |
| 8 · SAVE freeze | 0:30–0:33 | Static hold on the CTA card | "Send this before the first cold snap.\nStop by — we'll check it, no charge.\nNick's Tire & Auto · 17625 Euclid Ave, Cleveland · (216) 862-0005" | (silent — ambient tone only) |

Standing negative prompt for every beat, per the pipeline's real M10 preflight contract: **faces,
hands, human figures, on-screen text, logos, watermarks, subtitles** (all on-screen words are ffmpeg
overlays added at assembly, never asked of the video generator — matches the hard constraint in
`REEL-SLATE-2026-07-31.md`: *"No text or branding in-frame. M10 preflight blocks it [Seedance cannot
spell]."*). No real person's name appears anywhere in this script.

### Full voiceover script, timed

```
[0:00–0:02] You didn't run over anything.
[0:02–0:05] That warning light isn't damage — it's the weather.
[0:05–0:10] Every ten degrees the temperature drops pulls about one PSI out of every tire.
[0:10–0:15] That's why the light shows up on the first cold Cleveland morning — out of nowhere.
[0:15–0:20] Warm tires read high and hide the real number.
[0:20–0:25] Check the pressure cold, before you drive — that's the number that counts.
[0:25–0:30] Worth checking before that first frost.
[0:30–0:33] (silent hold — CTA card only)
```

~62 spoken words over 30s (≈2.1 words/sec) — comfortable at both the Google Neural2-J and ElevenLabs
"Roger" default paces the real `reelVoice.ts` uses.

### Visual sourcing — pick ONE route before rendering

The prod pipeline's currently-pinned free lane (`template_stock`, per `docs/operations/REEL-PIPELINE.md`)
generates **abstract Ken-Burns camera moves over a solid/gradient backdrop** — it does not shoot
literal dashboards, HUD overlays, or gauge macros. This concept needs the dashboard-macro and
gauge-macro visuals to actually read, so `template_stock` alone will not carry it. Three real options,
in recommended order:

1. **Shop-shot footage (recommended for beats 5 and 6).** A real tire-pressure gauge on a real tire
   at the shop, shot handheld or on a tripod — cheapest, zero licensing questions, most on-brand, and
   genuinely easy to shoot on a phone. Beats 1, 2, 3, 4, 7 (dashboard interior macro with a HUD
   overlay, evidence-marker compositing) are harder to shoot practically and lean on route 2 or 3.
2. **Higgsfield/Seedance clip generation** (currently NOT the prod-pinned route — would need
   `REEL_VIDEO_PROVIDER` flipped back, and costs an estimated `$0.25/clip × 6 clips ≈ $1.50`, per
   `generationLedger.ts`'s `COST_ESTIMATES_USD`). Per-beat prompt pack below if this route is chosen.
3. **Licensed stock/motion-graphics footage** — fallback only if neither of the above is available. I
   have not sourced or verified any specific stock asset or URL (I don't fabricate URLs); the operator
   would search a licensed library for "car dashboard warning light macro" and "tire pressure gauge
   macro" and confirm commercial-use rights before use.

**Higgsfield-style prompt pack (route 2, if activated):**

| Beat | Prompt | Negative prompt |
|---|---|---|
| 1 | Extreme macro inside a dark car dashboard, an amber tire-pressure warning icon glowing to life, a thin diagnostic scan-line sweeps across the icon, deep blacks with amber bokeh glow | faces, hands, human figures, on-screen text, logos, watermarks, subtitles |
| 2 | Same dark dashboard macro, the amber warning icon holds steady as the diagnostic scan-line locks in place, deep blacks with amber bokeh glow | (same) |
| 3 | Forensic evidence-scan aesthetic: extreme macro on a tire sidewall, a horizontal scan-line sweeps across it, cool investigative lighting, clean dark field | (same) |
| 4 | Forensic evidence-scan aesthetic continues: macro on frost forming on a car window at dawn, cool blue morning light, investigative lighting style | (same) |
| 5 | Premium product commercial macro of a hand-held tire-pressure gauge pressed to a tire valve stem, the needle settling, shallow depth of field, cool morning light | (same) |
| 6 | Same premium product macro style, the gauge needle settling to a lower cold-tire reading, shallow depth of field, cool morning light | (same) |
| 7 | Extreme macro inside the dark car dashboard again, the amber warning icon fades back to black, mirroring the beat-1 opening for a loop seam | (same) |

### Assembly (ffmpeg — matches `reelAssembly.ts`'s real technique)

1. **Canvas:** 1080×1920 (9:16), 30fps target.
2. **Concatenate** the 6 motion clips (beats 1, 3, 4, 5, 6, 7 — beat 2 reuses beat 1's clip held
   longer, since the setup line just lets the HUD reticle lock in) with hard cuts at each beat
   boundary, matching the samples' documented style. A slow dissolve, not a hard cut, works better on
   the beat 4→5 transition (evidence-board world → gauge macro) since it's a world-change, not a
   beat-to-beat cut.
3. **Caption burn-in:** word-level ASS subtitles synced to the VO timing above (karaoke-style
   word-highlight if the ElevenLabs TTS lane with alignment timestamps is used; otherwise beat-synced
   caption blocks off the Google TTS SSML pacing). `PlayResX/Y 1080x1920`, safe zone: keep all text
   inside the middle 60% of frame width and clear of the bottom 20% (UI overlap zone).
4. **Overlay text** (drawtext, NOT part of the generated video): "NOT DAMAGE.", "EVIDENCE 1: −10°F ≈
   −1 PSI," "EVIDENCE 2: THE FIRST COLD MORNING," "WARM TIRES READ HIGH," "CHECK IT COLD, BEFORE YOU
   DRIVE," "WORTH CHECKING.", and the CTA card in beat 8.
5. **Audio mix:** VO track centered; no music bed by default — see §6 (rights gap). A soft dashboard
   chime at the beat-1→2 icon-lock moment and a faint frost/wind ambience under beats 3–4 are short
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
| Shop-shot footage (beats 5, 6, 8 only) | **$0** | Covers 3 of 8 beats; beats 1, 2, 3, 4, 7 (dashboard macro, evidence-board compositing) aren't practically shootable and need route 2 or 3 |
| `template_stock` (prod default) | **$0/clip** | Free, but produces abstract backdrops — unsuitable for this concept's dashboard/evidence-board beats as-is (see §4) |
| Higgsfield/Seedance (currently inactive route) | **≈$0.25 × 6 clips ≈ $1.50**, labeled an ASSUMPTION in the source comment, not a metered price | Would need `REEL_VIDEO_PROVIDER` flipped — an operator/config decision, not mine to make |
| TTS (Google Neural2-J or ElevenLabs) | Not itemized in the cost table read | Google lane is free-quota; ElevenLabs is the paid fallback only if Google fails |

**Honest self-score against the real 75-point gate** (see §2's per-concept table): estimating this
pack manually against `calculateReelQualityScore()`'s known weights —

first-frame 8/10 (a lit-up icon with a HUD reticle is a decent scroll-stop, similar strength to the
battery pack's flickering-icon hook) · muted-first 8/10 (dashboard/evidence visuals read fine muted;
overlay text carries the specific numbers) · beat structure 5/5 · length 5/5 · loop 5/5 (fixed via the
beat-7 mirror fade) · sourced fact 9/10 (the core claim is directly the pre-approved slate wording,
label-only not live-entailed) · faceless 10/10 · claim safety 10/10 · keyword 5/5 · winning-concept
bonus 0/5 (Concept A scored 47/60 in §2, below the skill's stated `≥57/60` sub-threshold) —
**estimated total ≈65/75**, below the real gate's 70/75 floor.

That's a genuine finding, not false modesty: the "absurdity/character" dimension is the weakest one
here (a HUD reticle and an evidence-board motif are procedural, not a strong conceptual bit), which is
the same shortfall pattern the battery pack hit. An editor's pass on that dimension, or reconsidering
whether Concept B's flatter-but-simpler read actually tests better, is worth doing before spending
render budget — and given §0/§1's seasonal note, this is a fall-posting candidate regardless of score.

---

## 6 · Audio/music rights status

**No music-rights ledger exists in this repo** — confirmed real gap, not an oversight on my part.
This pack defaults to **no licensed music bed**: VO (Google TTS / ElevenLabs, both real working lanes
with no rights question) plus short SFX (dashboard chime, faint wind/frost ambience) mixed under it.
If the operator wants a music bed, the lowest-friction, zero-rights-question option is Meta's own
built-in royalty-free audio library inside the Instagram/Facebook Reels composer (pre-cleared for that
platform) — I have not selected or verified a specific track, since I have no live access to browse
it.

---

## 7 · QA matrix

| Gate | Verdict | Backed by |
|---|---|---|
| Claim-safety wording (no prices, no guarantees, approved soft language) | **PASS** | Manual check against `client/src/lib/facelessReelStudio.ts`'s approved phrase list — script uses "worth checking," rules out a puncture before explaining the real (non-alarming) cause, never states a diagnosis as certain |
| Brand-voice kill list (`shared/voice.ts`) | **PASS (manual)** | Manually checked every VO/caption/hashtag line against the kill-list categories described in prior packs — no obvious hits; **not run through the live linter**, since this session has no path to it |
| Faceless / standing negative prompt compliance | **PASS (by design of the prompts)** | Prompt pack in §4 carries the standing negative prompt on every beat; storyboard has no faces/hands/human figures |
| Repetition ledger (21-day, live DB) | **UNKNOWN** | Not queried — no live DB access this session (see §1) |
| Render-integrity gate (`reelAssembly.ts` #800/#801: duration, frame count, motion-proof MD5 check) | **UNKNOWN / N/A** | Nothing was rendered — no file exists to `ffprobe` |
| Rendered QA vision critic (`renderedQa.ts`) | **UNKNOWN** | Not run — requires an actual rendered file and a live call |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED** | Never called — no `reel-canary` access this session, and publish requires live operator authorization regardless (§9) |
| Quality score vs. live 70/75 floor | **FAIL (estimated)** | My own manual estimate in §5 is ≈65/75 — below the stated floor. Flagged, not hidden. |

---

## 8 · IG/FB copy — 2 ad-ready variants

Format follows the account's current, data-corrected house style (`docs/REEL-SLATE-2026-07-31.md`):
short punchy lines, a SEND-oriented CTA (this account's posted reels have measured `saved = 0.00`;
the corrected objective is watch time and sends, not saves). Hashtags reuse the slate's own
pre-approved set for this item (4 tags, within Instagram's 5-tag cap), lowercase per the current
slate's convention.

### Variant A — SEND-first (primary recommendation, matches the corrected house strategy)

> You didn't run over anything.
>
> That warning light isn't damage — it's the weather. Every ten degrees the temperature drops pulls
> about one PSI out of every tire. That's why the light shows up on the first cold Cleveland morning,
> out of nowhere.
>
> Warm tires read high and hide the real number. Check the pressure cold, before you drive.
>
> Worth checking before that first frost.
>
> #tirepressure #ohioweather #cartips #clevelandohio

### Variant B — Comment-keyword style (matches the older Studio samples' `campaignKeyword` convention)

> Think that tire light means you ran over something?
>
> Probably not. Every ten degrees colder pulls about a PSI out of every tire — that's why the light
> shows up on the first cold morning out of nowhere. Warm tires hide the real number, so check it
> cold, before you drive.
>
> Comment COLDSNAP and we'll check it for free when you stop by.
>
> #tirepressure #ohioweather #cartips #clevelandohio

Both variants pass the manual kill-list check in §7. No shop contact block is repeated in-caption
(matching `REEL-SLATE-2026-07-31.md`'s actual posted-topic format, which keeps contact info out of the
caption body and in the CTA video card / bio instead).

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

1. **Triage the 23-PR backlog first** (§0) — this pack should not become PR #24 sitting unreviewed
   next to 23 others without the operator also getting a nudge to clear the queue.
2. Hold this specific pack for a **fall posting date** — it's a cold-weather trigger topic produced
   in mid-August (§1's seasonal note); posting it now would be off-season.
3. Pick a visual-sourcing route (§4) — shop-shot footage alone only covers 3 of 8 beats; this concept
   likely needs Higgsfield/Seedance or licensed stock for the dashboard/evidence-board beats.
4. Either run this concept through the real Studio/critic tooling to get a live quality score (the
   manual estimate in §5 suggests it needs a punch-up pass, particularly on the "absurdity/character"
   dimension), or accept the estimate and iterate by hand.
5. Check `REEL_AUTOPOST_ENABLED` and today's post count before scheduling manually — the daily cron
   may already be posting today independent of this pack, and the account is capped at 2 feed
   posts/day with 3h spacing.
6. Drive it through `POST /api/admin/reel-canary` (`start` → `advance` → `qa`) to get an actual
   rendered, QA-gated asset — and only call `{action:"publish"}` with a live go-ahead for this specific
   asset, per both skill files' hard rule.
