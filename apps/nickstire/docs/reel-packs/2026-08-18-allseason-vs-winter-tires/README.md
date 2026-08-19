# Reel production pack — "All-season stops working at 45°F" (COMPOUND45)

Scheduled-task run · 2026-08-18 · mode `INTELLIGENCE`/`PRODUCTION` (research + pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **COMPOUND45**
· source: [`REEL-SLATE-2026-07-31.md`](../../REEL-SLATE-2026-07-31.md) item #11 (brand-voice-approved
caption already exists)

This pack follows the reel-operator skill's 9-point receipt shape and the account's real,
data-corrected posting format from `docs/REEL-SLATE-2026-07-31.md` (Hook 0-2s → Setup 2-5s →
Value 5-25s → CTA 25-30s, SEND-oriented CTA, no in-frame AI-generated text). **No generation, DB
read, or publish call was made against production this run** — see §1 and §9.

---

## 0 · Backlog note (read this before adding pack #26+)

As of this run, **25 open draft PRs** already exist for prior scheduled firings of this exact
workflow (`#1614`–`#1642`, none merged), plus 5 merged packs in this directory. Cross-referencing
titles against `REEL-SLATE-2026-07-31.md`'s 20 items shows **all 20 slate items now have a pack or
open PR except item #11** (this one) — every remaining open PR covers either a slate item a second
time under a different slug, or a topic outside the original slate. The scheduled task is firing
roughly hourly with no merge step in between, so the backlog of unreviewed, unpublished drafts is
growing faster than any human could review it. That is an operator-facing observation, not something
this run can fix — flagged here rather than silently adding one more unreviewed PR to the pile.

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
`DATABASE_URL` is production TiDB, and this session has no live path to it. Paper substitute used
instead:

- `apps/nickstire/docs/reel-packs/` (5 merged) + 25 open draft PRs (§0) — none titled for slate item
  #11. The closest neighbor is `2026-08-16-.../tread-depth-rain-vs-snow` (open PR #1636), which
  covers **tread pattern** channeling water/snow — a different mechanic fact from this pack's
  **rubber compound hardness vs. temperature**. Both could air in the same season without repeating
  the underlying claim, but an operator should still space them by more than a few days if both get
  scheduled for real.
- `apps/nickstire/client/src/lib/facelessReelStudioSamples.ts` — 3 reference samples (PRESSURE,
  POTHOLE, BRAKES). This pack's "the number is way higher than you think" reveal shares the
  `myth_vs_reality` archetype with the PRESSURE sample and with the merged BATTERY pack
  (2026-08-16) — third use of that archetype found in local paper records. **Flagged for the
  operator to confirm against the live ledger before enqueuing** — three myth-reveal reels in one
  month risks the repetition ledger's `REPEAT_CTA`/topic-shape fatigue even though the literal topic
  differs each time.

**Seasonal note, stated plainly:** today is 2026-08-18 (August, Cleveland) — several months before
this topic's actual relevance window (temperatures drop below 45°F). The slate item's own caption
says "save this for when the forecast turns," which is itself the correct CTA for an August posting
date: this is deliberately a **save-for-later** reel, not a right-now-actionable one. That changes
the honest read of "sourced fact" and "save" scoring in §5 — a save-oriented CTA is the intended
design here, not a weakness to fix.

---

## 2 · Candidate concepts and scores

Two concepts considered, scored 0–10 per dimension on the sample briefs' rubric (hook / truth /
save / local / absurdity / fit). **These are my own manual estimates, not a live
`calculateReelQualityScore()` or critic-panel run** — flagged honestly in §5.

### Concept A — "It's not about snow" temperature-threshold reveal (SELECTED)

Cold open on a thermometer/gauge reading near 45°F; VO opens by naming the wrong assumption (snow)
before revealing the real trigger (temperature, dry pavement included), then an x-ray/macro
comparison of a hardening vs. staying-soft tread block.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 8 | 9 | 9 | 7 | 5 | 10 | **48** |

Below the skill's `≥57/60` sub-threshold for "winning concept" — see §5's honest accounting.

### Concept B — Straight slate-caption read (parked)

Render the slate's existing caption verbatim as VO with no reveal structure: states the 45-degree
threshold directly as a fact, no myth-flip. Parked because it's flatter as a hook, even though it
carries the lowest repetition risk (no shared archetype with recent packs).

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 5 | 9 | 8 | 7 | 3 | 10 | **42** |

---

## 3 · Claim evidence

No live `evidenceResolver.ts` / `EvidenceRecord` lookup ran (no DB access this session) — every
entailment below is **`not_evaluated`** in the pipeline's own vocabulary, not `supported`. Sourcing
follows the samples' own pattern: label-only proof citations, no fabricated URLs.

| Claim in this reel | Source note (label only) | Kind | Entailment |
|---|---|---|---|
| All-season tire rubber compounds begin to stiffen below roughly 45°F (7°C), reducing grip | Already brand-voice-approved wording, `docs/REEL-SLATE-2026-07-31.md` item #11; consistent with widely published tire-industry consumer guidance (Tire Rack, Consumer Reports buying-guide literature on all-season vs. winter compounds) | proof (pre-approved) | not_evaluated |
| The grip loss below that threshold happens on dry pavement too, not only snow/ice | Already brand-voice-approved wording, same slate item | proof (pre-approved) | not_evaluated |
| Winter-tire compounds use a softer, more silica-heavy formulation that stays flexible at low temperatures | Common tire-industry engineering explanation (why winter compounds exist at all); general knowledge, not shop-specific | proof | not_evaluated |
| Most drivers only think about winter tires in terms of snow traction, not temperature | Common-knowledge framing (widely held driver assumption; not a shop-specific claim) | pain_point | not_evaluated |

No `businessFacts.ts` row was pulled — this script states no shop price, warranty, or hours, so the
"no `reel`/`social` channel in `FactChannel` yet" gap the skill flags doesn't apply here by design.

**No claim in this pack states a diagnosis as certain.** Every line uses the approved soft-language
bank from `client/src/lib/facelessReelStudio.ts`: *can point to · worth checking*. The script never
tells a viewer their specific tires are unsafe — it states the general threshold and lets the
viewer self-assess.

---

## 4 · Production pack

### Storyboard (30s: Hook 0-2 → Setup 2-5 → Value 5-25 → CTA 25-30 + 3s freeze = 33s runtime)

Archetype: **myth_vs_reality** (reveal structure — flagged for repetition overlap in §1). Motion
lenses: **product_ad_macro** (tread block close-ups) for the hook, reveal, and comparison beats;
**xray_cutaway** for the compound-hardening beat; a simple **gauge/dial world** for the
temperature-threshold beat.

| Beat | Time | Visual | On-screen overlay (ffmpeg, not AI-generated) | Voiceover (word-for-word) |
|---|---|---|---|---|
| 1 · Hook | 0:00–0:02 | Macro shot of a tire tread block, dry pavement in soft focus behind it, no snow anywhere in frame | — | "This has nothing to do with snow." |
| 2 · Setup | 0:02–0:05 | A dial/gauge world, needle resting near a marked threshold line | "45°F" | "All-season tires stop working around 45 degrees." |
| 3 · Value 1 | 0:05–0:10 | X-ray cutaway into the tread block, internal rubber structure visibly stiffening as a cold-blue tint creeps in | "COMPOUND HARDENS" | "Below that, the rubber compound stiffens up." |
| 4 · Value 2 | 0:10–0:15 | Split-frame product-ad macro: same tread block, one half staying supple (warm tone), one half rigid (cold-blue tint), both pressed against dry pavement texture | "GRIP DROPS — EVEN ON DRY ROADS" | "And grip drops — on dry pavement too, not just snow." |
| 5 · Value 3 | 0:15–0:20 | Product-ad macro: a winter-tire tread block, warm-toned, staying flexible and supple under the same cold-blue ambient light | "WINTER COMPOUND STAYS SOFT" | "Winter tires use a softer compound that stays flexible." |
| 6 · Value 4 | 0:20–0:25 | Back to the gauge/dial world, needle drifting past the 45°F line as ambient light cools | "THAT'S THE WHOLE DIFFERENCE" | "That's the whole difference — not the tread pattern, the rubber itself." |
| 7 · CTA | 0:25–0:30 | Macro tread-block shot again, mirrors beat 1's framing (loop seam), warms back to neutral | "SAVE THIS." then CTA card fades in | "Save this for when the forecast turns." |
| 8 · SAVE freeze | 0:30–0:33 | Static hold on the CTA card | "Send this to whoever still runs all-seasons through January.\nStop by when it's time — we'll help you decide.\nNick's Tire & Auto · 17625 Euclid Ave, Cleveland · (216) 862-0005" | (silent — ambient tone only) |

Standing negative prompt for every beat, per the pipeline's real M10 preflight contract: **faces,
hands, human figures, on-screen text, logos, watermarks, subtitles** (all on-screen words are
ffmpeg overlays added at assembly, never asked of the video generator — matches the hard constraint
in `REEL-SLATE-2026-07-31.md`: *"No text or branding in-frame. M10 preflight blocks it [Seedance
cannot spell]"*). No real person's name appears anywhere in this script.

### Full voiceover script, timed

```
[0:00–0:02] This has nothing to do with snow.
[0:02–0:05] All-season tires stop working around 45 degrees.
[0:05–0:10] Below that, the rubber compound stiffens up.
[0:10–0:15] And grip drops — on dry pavement too, not just snow.
[0:15–0:20] Winter tires use a softer compound that stays flexible.
[0:20–0:25] That's the whole difference — not the tread pattern, the rubber itself.
[0:25–0:30] Save this for when the forecast turns.
[0:30–0:33] (silent hold — CTA card only)
```

~62 spoken words over 30s (≈2.1 words/sec) — comfortable at both the Google Neural2-J and
ElevenLabs "Roger" default paces the real `reelVoice.ts` uses.

### Visual sourcing — pick ONE route before rendering

The prod pipeline's currently-pinned free lane (`template_stock`, per
`docs/operations/REEL-PIPELINE.md`) generates **abstract Ken-Burns camera moves over a solid/gradient
backdrop** — it does not shoot literal tread macros, gauges, or x-ray cutaways. Three real options,
in recommended order:

1. **Shop-shot footage (recommended, and the strongest fit for this concept).** A real tire on the
   shop counter/bench gives an authentic macro tread-block shot for beats 1, 5, and 7 with zero
   licensing questions and the most on-brand look. Beats 2, 3, 4, and 6 (gauge world, x-ray cutaway,
   split-frame comparison) are not practically shootable on a phone and need route 2 or 3.
2. **Higgsfield/Seedance clip generation** (currently NOT the prod-pinned route — would need
   `REEL_VIDEO_PROVIDER` flipped back and costs an estimated `$0.25/clip × 6 clips ≈ $1.50`, per
   `generationLedger.ts`'s `COST_ESTIMATES_USD`). Per-beat prompt pack below if this route is chosen.
3. **Licensed stock/motion-graphics footage** — fallback only if neither of the above is available.
   I have not sourced or verified any specific stock asset or URL (I don't fabricate URLs); the
   operator would search a licensed library for "tire tread macro cold weather" and "rubber
   compound cutaway diagram animation" and confirm commercial-use rights before use.

**Higgsfield-style prompt pack (route 2, if activated):**

| Beat | Prompt | Negative prompt |
|---|---|---|
| 1 | Extreme macro shot of a tire tread block on dry asphalt, soft natural daylight, shallow depth of field, no snow or ice visible anywhere | faces, hands, human figures, on-screen text, logos, watermarks, subtitles |
| 2 | A minimalist analog temperature gauge world, needle resting near a marked threshold line, clean studio lighting, cool-toned background | (same) |
| 3 | Technical x-ray cutaway visualization of a tire tread block, internal rubber structure visibly stiffening, a cold blue tint creeping through the material, precise engineering aesthetic | (same) |
| 4 | Split-frame macro comparison of two tire tread blocks pressed against dry asphalt texture, one warm-toned and supple, one cold-blue-toned and rigid, studio product lighting | (same) |
| 5 | Premium product macro of a winter tire tread block, warm amber lighting, staying visibly flexible and supple, shallow depth of field, dark seamless background | (same) |
| 6 | The same analog temperature gauge world, the needle drifting slowly past the marked threshold line as the ambient light cools | (same) |
| 7 | Extreme macro shot of a tire tread block on dry asphalt, mirroring the beat-1 opening framing for a loop seam, light warming back to neutral | (same) |

### Assembly (ffmpeg — matches `reelAssembly.ts`'s real technique)

1. **Canvas:** 1080×1920 (9:16), 30fps target.
2. **Concatenate** the 6 motion clips (beats 1, 3, 4, 5, 6, 7 — beat 2 reuses beat 1's clip with a
   slow push-in, since the setup line just states the number without a new visual world) with hard
   cuts at each beat boundary, matching the samples' documented style (`"hard cuts on beats 2/4"`). A
   slow dissolve, not a hard cut, works better on the beat 2→3 transition (tread macro → x-ray
   cutaway) since it's a world-change, not a beat-to-beat cut.
3. **Caption burn-in:** word-level ASS subtitles synced to the VO timing above (karaoke-style
   word-highlight if the ElevenLabs TTS lane with alignment timestamps is used; otherwise beat-synced
   caption blocks off the Google TTS SSML pacing). `PlayResX/Y 1080x1920`, safe zone: keep all text
   inside the middle 60% of frame width and clear of the bottom 20% (UI overlap zone).
4. **Overlay text** (drawtext, NOT part of the generated video): "45°F," "COMPOUND HARDENS," "GRIP
   DROPS — EVEN ON DRY ROADS," "WINTER COMPOUND STAYS SOFT," "THAT'S THE WHOLE DIFFERENCE," "SAVE
   THIS," and the CTA card in beat 8.
5. **Audio mix:** VO track centered; no music bed by default — see §6 (rights gap). A soft ambient
   tone under the gauge-world beats is a short SFX cue, not a licensed music track, and carries no
   rights question.
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
| Shop-shot footage (beats 1, 5, 7 only) | **$0** | Covers only 3 of 6 motion beats; beats 2, 3, 4, 6 (gauge world, x-ray cutaway, split comparison) aren't practically shootable and need route 2 or 3 |
| `template_stock` (prod default) | **$0/clip** | Free, but produces abstract backdrops — unsuitable for this concept's gauge/x-ray/comparison beats as-is (see §4) |
| Higgsfield/Seedance (currently inactive route) | **≈$0.25 × 6 clips ≈ $1.50**, labeled an ASSUMPTION in the source comment, not a metered price | Would need `REEL_VIDEO_PROVIDER` flipped — an operator/config decision, not mine to make |
| TTS (Google Neural2-J or ElevenLabs) | Not itemized in the cost table read | Google lane is free-quota; ElevenLabs is the paid fallback only if Google fails |

**Honest self-score against the real 75-point gate** (see §2's per-concept table): estimating this
pack manually against `calculateReelQualityScore()`'s known weights —

first-frame 7/10 (a dry-pavement tread macro is a decent but not exceptional scroll-stop; it doesn't
telegraph "tire video" quite as sharply as a wetter or snowier opener would) · muted-first 7/10 (the
gauge and x-ray visuals carry some meaning muted, but the "45°F" and "COMPOUND HARDENS" overlay text
is doing real work here, more than usual) · beat structure 5/5 · length 5/5 · loop 5/5 (fixed via the
beat-7 mirror) · sourced fact 9/10 (both core claims are pre-approved slate wording) · faceless
10/10 · claim safety 10/10 · keyword 5/5 · winning-concept bonus 0/5 (Concept A scored 48/60 in §2,
below the skill's stated `≥57/60` sub-threshold) — **estimated total ≈63/75**, below the real gate's
70/75 floor.

That's a genuine finding, not false modesty: the "hook" and "muted-first" dimensions are the softest
spots — a viewer scrolling past a tread-block macro in August, months before this topic is
actionable, may not stop for it the way a right-now-relevant hook would. The slate's own framing
("save this for when the forecast turns") already anticipates this by designing for a save, not an
immediate stop-and-watch — worth an editor's judgment call on whether to post now (long save window)
or hold for a seasonal posting date (stronger immediate hook, shorter save window) before spending
render budget.

---

## 6 · Audio/music rights status

**No music-rights ledger exists in this repo** — confirmed real gap, not an oversight on my part.
This pack defaults to **no licensed music bed**: VO (Google TTS / ElevenLabs, both real working
lanes with no rights question) plus a short ambient SFX cue mixed under the gauge-world beats. If
the operator wants a music bed, the lowest-friction, zero-rights-question option is Meta's own
built-in royalty-free audio library inside the Instagram/Facebook Reels composer (pre-cleared for
that platform) — I have not selected or verified a specific track, since I have no live access to
browse it.

---

## 7 · QA matrix

| Gate | Verdict | Backed by |
|---|---|---|
| Claim-safety wording (no prices, no guarantees, approved soft language) | **PASS** | Manual check against `client/src/lib/facelessReelStudio.ts`'s approved phrase list — script states a general threshold, never diagnoses a specific viewer's tires |
| Brand-voice kill list (`shared/voice.ts`) | **PASS (manual)** | Manually checked every VO/caption/hashtag line against the kill-list categories described in prior packs — no obvious hits; **not run through the live linter**, since this session has no path to it |
| Faceless / standing negative prompt compliance | **PASS (by design of the prompts)** | Prompt pack in §4 carries the standing negative prompt on every beat; storyboard has no faces/hands/human figures |
| Repetition ledger (21-day, live DB) | **UNKNOWN** | Not queried — no live DB access this session (see §1); paper check found no other pack titled for this exact slate item, but flagged a third `myth_vs_reality` archetype use this month |
| Render-integrity gate (`reelAssembly.ts` #800/#801: duration, frame count, motion-proof MD5 check) | **UNKNOWN / N/A** | Nothing was rendered — no file exists to `ffprobe` |
| Rendered QA vision critic (`renderedQa.ts`) | **UNKNOWN** | Not run — requires an actual rendered file and a live call |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED** | Never called — no `reel-canary` access this session, and publish requires live operator authorization regardless (§9) |
| Quality score vs. live 70/75 floor | **FAIL (estimated)** | My own manual estimate in §5 is ≈63/75 — below the stated floor. Flagged, not hidden. |

---

## 8 · IG/FB copy — 2 ad-ready variants

Format follows the account's current, data-corrected house style
(`docs/REEL-SLATE-2026-07-31.md`): short punchy lines, a SEND/SAVE-oriented CTA (this account's
posted reels have measured `saved = 0.00`; the corrected objective is watch time and sends, not
saves — this concept's own "save for later" framing is a deliberate test of whether an explicit save
CTA moves that number, per the slate's own stated measurement goal). Hashtags capped at 4
(Instagram's Dec-2025 hard cap of 5, minus headroom), lowercase per the current slate's convention.

### Variant A — SAVE-first (primary recommendation, tests the slate's own open measurement question)

> This has nothing to do with snow.
>
> All-season tires stop working around 45 degrees. Below that, the rubber compound stiffens up —
> and grip drops on dry pavement too, not just snow.
>
> Winter tires use a softer compound that stays flexible. That's the whole difference.
>
> Save this for when the forecast turns.
>
> #wintertires #allseasontires #clevelandohio #ohioweather

### Variant B — Comment-keyword style (matches the older Studio samples' `campaignKeyword` convention)

> Think all-seasons are fine until it snows?
>
> They actually stop gripping around 45 degrees — before any snow falls, and on dry roads too. It's
> the rubber compound, not the tread pattern.
>
> Comment COMPOUND and we'll help you figure out what you're running when the forecast turns.
>
> #wintertires #allseasontires #clevelandohio #ohioweather

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

1. Pick a visual-sourcing route (§4) — shop-shot footage alone only covers 3 of 6 beats; this
   concept likely needs Higgsfield/Seedance or licensed stock for the gauge/x-ray/comparison beats.
2. Either run this concept through the real Studio/critic tooling to get a live quality score (the
   manual estimate in §5 suggests it needs a punch-up pass on the hook, or a seasonal hold until
   closer to the actual temperature-drop window), or accept the estimate and iterate by hand.
3. Check `REEL_AUTOPOST_ENABLED` and today's post count before scheduling manually — the daily cron
   may already be posting today independent of this pack, and the account is capped at 2 feed
   posts/day with 3h spacing.
4. Drive it through `POST /api/admin/reel-canary` (`start` → `advance` → `qa`) to get an actual
   rendered, QA-gated asset — and only call `{action:"publish"}` with a live go-ahead for this
   specific asset, per both skill files' hard rule.
5. **Separately from this pack:** review and either merge or close the 25 open draft reel-pack PRs
   noted in §0 — the scheduled task has no merge step, so the backlog is accumulating faster than it
   can be reviewed.
