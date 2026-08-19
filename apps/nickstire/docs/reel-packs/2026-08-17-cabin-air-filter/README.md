# Reel production pack — "Two filters, only one gets blamed" (AIRFLOW)

Scheduled-task run · 2026-08-17 · mode `INTELLIGENCE`/`PRODUCTION` (research + pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **AIRFLOW**

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
| `getHiggsfieldAccountHealth()` | **NOT QUERIED** — no shell path to the running server or its credentials from this session; `env` here has no `HIGGSFIELD_*`, `REEL_*`, `ADMIN_API_KEY`, or `DATABASE_URL` set at all (checked directly this run) |
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

- `apps/nickstire/docs/reel-packs/` — 5 prior packs exist locally (penny test, tire expiration,
  tread fingerprint, battery/summer-heat, squealing-vs-grinding brakes). None cover filters or AC.
- **Open PRs, checked before writing anything** (`search_pull_requests` against this repo,
  `is:pr reel pack in:title`): 5 currently open — coolant color (#1618), spare-tire mileage (#1617),
  balance vs. alignment (#1616), check-engine light (#1615), wheel-bearing hum (#1614) — plus 10
  more merged/closed covering penny test (×3), tire expiration, tread-wear fingerprint, battery
  (×2), sidewall bulge, squealing-vs-grinding brakes, and "one location for reel packs." **None of
  the 16 existing PRs touch cabin/engine air filters or AC airflow.** This is genuinely new ground,
  not a 17th pass at an already-covered topic.
- `apps/nickstire/docs/REEL-SLATE-2026-07-31.md` — 20 planned topics. Item #14, **"Cabin filter vs
  engine air filter,"** already carries a brand-voice-approved caption (two filters, different jobs
  — engine filter protects the engine, cabin filter cleans cabin air, and a clogged one is usually
  why the heat or AC feels weak — "save this if your vents lost their punch"). This pack builds the
  full production treatment for that item, reusing its approved facts and extending them into a
  hook/reveal structure the caption alone doesn't carry.
- `apps/nickstire/client/src/lib/facelessReelStudioSamples.ts` — 3 reference samples (PRESSURE,
  POTHOLE, BRAKES) plus this session's own read of two archived concepts (`avoidedForRepetition`
  notes mention a "check-engine smoke-alarm character" and a "road-salt villain" topic, both
  unrelated). No filter/airflow topic among any of them. **Archetype check:** `myth_vs_reality` has
  now been used twice in this pack series (PRESSURE sample, then the 2026-08-16 battery pack) — this
  pack deliberately uses a different shape (below) rather than a third pass at the same reveal
  structure.

**Seasonal note:** today is 2026-08-17 (August, Cleveland). Weak AC/heat-blast complaints spike in
August heat — this is a stronger seasonal fit than the slate's more neutral original framing, and
better timed than the winter-only items on the same slate (#3, #11).

---

## 2 · Candidate concepts and scores

Two concepts considered, scored 0–10 per dimension on the sample briefs' rubric (hook / truth /
save / local / absurdity / fit). **These are my own manual estimates, not a live
`calculateReelQualityScore()` or critic-panel run** — flagged honestly in §5.

### Concept A — "Two filters, only one gets blamed" (SELECTED)

Opens on weak AC vents in August heat, sets up the twist that the car has two separate air filters
and only one of them is anyone's mental model, then macro-reveals a caked cabin filter as the real
culprit behind weak airflow — not the AC system itself.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 8 | 9 | 9 | 8 | 5 | 10 | **49** |

Below the skill's `≥57/60` sub-threshold for "winning concept" — flagged honestly in §5, same as
the prior pack in this series.

### Concept B — Straight slate-caption read (parked)

Render the slate's existing caption verbatim as VO with no reveal structure: states both filters'
jobs directly, no "which one is the AC culprit" hook. Parked because it's flatter as a hook (no
tension/reveal) even though it carries zero repetition risk on any archetype.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 5 | 9 | 8 | 6 | 3 | 10 | **41** |

---

## 3 · Claim evidence

No live `evidenceResolver.ts` / `EvidenceRecord` lookup ran (no DB access this session) — every
entailment below is **`not_evaluated`** in the pipeline's own vocabulary, not `supported`. Sourcing
follows the samples' own pattern: label-only proof citations, no fabricated URLs.

| Claim in this reel | Source note (label only) | Kind | Entailment |
|---|---|---|---|
| A car has two separate air filters — engine and cabin — with different jobs | Already brand-voice-approved wording, `docs/REEL-SLATE-2026-07-31.md` item #14 | proof (pre-approved) | not_evaluated |
| The cabin filter cleans the air coming through the vents, and a clogged one is usually why heat or AC feels weak | Already brand-voice-approved wording, `docs/REEL-SLATE-2026-07-31.md` item #14 | proof (pre-approved) | not_evaluated |
| A clogged cabin filter physically restricts airflow volume, so blower output drops even when the AC/heat system itself is working correctly | General automotive-service common knowledge (HVAC airflow-restriction mechanics); not a shop-specific or price-bearing claim | proof | not_evaluated |
| Cabin filters are typically accessible without special tools (commonly behind the glovebox on many models) | General automotive common knowledge — phrased as "commonly," not asserted for every vehicle | proof (qualified) | not_evaluated |
| Drivers who notice weak AC tend to assume a refrigerant/AC-system problem first | Common-knowledge framing (widely held driver assumption, not a shop-specific claim) | pain_point | not_evaluated |

No `businessFacts.ts` row was pulled — checked this run (`grep` across `businessFacts.ts` and
`server/data/*.ts` for filter/AC/airflow terms; no matching row exists). This script states no shop
price, labor time, or warranty figure, so the "no `reel`/`social` channel in `FactChannel` yet" gap
the skill flags doesn't block this pack by design — nothing dynamic is being asserted.

**No claim in this pack states a diagnosis as certain.** Every line uses the approved soft-language
bank from `client/src/lib/facelessReelStudio.ts`: *worth checking · usually · can point to*. The
script deliberately avoids "your AC is broken" — it says weak airflow "can mean" the filter, never
that it definitely is. The "commonly behind the glovebox" line is explicitly hedged (not every car),
matching the skill's own no-overclaim rule.

---

## 4 · Production pack

### Storyboard (30s: Hook 0-2 → Setup 2-5 → Value 5-25 → CTA 25-30 + 3s freeze = 33s runtime)

Archetype: **confused_pair_clarified** (two commonly-mixed-up objects, clarified — same family as
the slate's own "alignment vs. balance" item, distinct from the `myth_vs_reality` reveal shape
already used twice in this pack series). Motion lenses: **cabin_interior_heat_haze** (car interior,
vents, heat shimmer) for the hook and CTA; **product_teardown_macro** (two filters side by side,
clean vs. dirty) for the value beats — neither lens has appeared in a prior pack in this series.

| Beat | Time | Visual | On-screen overlay (ffmpeg, not AI-generated) | Voiceover (word-for-word) |
|---|---|---|---|---|
| 1 · Hook | 0:00–0:02 | Car interior world, dashboard AC vents blasting visible heat-haze shimmer instead of cool air, sunlight glare through the windshield | — | "Vents on full blast and it's still not cold?" |
| 2 · Setup | 0:02–0:05 | Split-screen forms: engine bay silhouette on one side, cabin/vent silhouette on the other, a filter icon glowing in each | "TWO FILTERS. ONE JOB EACH." | "Your car has two air filters, and only one ever gets blamed." |
| 3 · Value 1 | 0:05–0:10 | Macro teardown: a clean engine air filter held up, then set aside — pleated paper, dry, dust-free | "ENGINE FILTER — PROTECTS THE ENGINE" | "The engine filter protects the engine. That one's not your problem." |
| 4 · Value 2 | 0:10–0:15 | Macro teardown: a visibly caked, dust-and-debris-packed cabin filter pulled out, side by side with a clean replacement | "CABIN FILTER — CLEANS YOUR AIR" | "The cabin filter cleans the air coming through your vents — and this one's usually caked." |
| 5 · Value 3 | 0:15–0:20 | Cutaway-style diagram: air trying to push through the clogged filter, visibly restricted, then the same air flowing freely through the clean one | "CLOGGED = LESS AIRFLOW" | "A clogged filter chokes the airflow, so even good AC feels weak." |
| 6 · Value 4 | 0:20–0:25 | Product-ad macro: hands-free framing on a filter slot behind a glovebox-style panel, clean filter sliding into place | "OFTEN A 10-MINUTE SWAP" | "It's often a ten-minute swap, commonly right behind the glovebox." |
| 7 · CTA | 0:25–0:30 | Back to the car-interior world from beat 1, vents now blowing clean cool air (heat-haze gone) — mirrors beat 1's framing (loop seam) | "WORTH CHECKING." then CTA card fades in | "Worth checking before you blame the AC system." |
| 8 · SAVE freeze | 0:30–0:33 | Static hold on the CTA card | "Save this if your vents lost their punch.\nStop by and we'll take a look, no charge.\nNick's Tire & Auto · 17625 Euclid Ave, Cleveland · (216) 862-0005" | (silent — ambient tone only) |

Standing negative prompt for every beat, per the pipeline's real M10 preflight contract: **faces,
hands, human figures, on-screen text, logos, watermarks, subtitles** (all on-screen words are
ffmpeg overlays added at assembly, never asked of the video generator). Beat 6's script note "a
filter slot" and "sliding into place" is written to be shot as a hands-free product move (rig/motion
only) — if the real Higgsfield route is used, the prompt below explicitly excludes hands per the
standing negative prompt; a shop-shot alternative (route 1, §4 below) can show a gloved hand
performing the swap since real shop footage isn't subject to the AI-generator's faceless/no-hands
constraint the same way — flagged so an operator picks knowingly. No real person's name appears
anywhere in this script.

### Full voiceover script, timed

```
[0:00–0:02] Vents on full blast and it's still not cold?
[0:02–0:05] Your car has two air filters, and only one ever gets blamed.
[0:05–0:10] The engine filter protects the engine. That one's not your problem.
[0:10–0:15] The cabin filter cleans the air coming through your vents — and this one's usually caked.
[0:15–0:20] A clogged filter chokes the airflow, so even good AC feels weak.
[0:20–0:25] It's often a ten-minute swap, commonly right behind the glovebox.
[0:25–0:30] Worth checking before you blame the AC system.
[0:30–0:33] (silent hold — CTA card only)
```

~62 spoken words over 30s (≈2.1 words/sec) — comfortable at both the Google Neural2-J and
ElevenLabs "Roger" default paces the real `reelVoice.ts` uses.

### Visual sourcing — pick ONE route before rendering

The prod pipeline's currently-pinned free lane (`template_stock`, per
`docs/operations/REEL-PIPELINE.md`) generates **abstract Ken-Burns camera moves over a solid/gradient
backdrop** — it does not shoot literal car interiors or filter teardowns. This concept needs the
interior-heat-haze and filter-macro visuals to actually read, so `template_stock` alone will not
carry it. Three real options, in recommended order:

1. **Shop-shot footage (recommended, and the strongest fit of any pack in this series).** Two real
   filters (one visibly dirty, one clean) laid on the shop counter is exactly the kind of shot a
   phone camera does well, and it is the single most persuasive visual this concept has — cheapest,
   zero licensing questions, most on-brand, and arguably more credible than a generated filter
   would be. Beat 1/2/7 (car-interior heat-haze, split-screen graphic) still need route 2 or 3, or a
   simpler in-car phone shot of the actual vents plus a graphic overlay for beat 2's split-screen.
2. **Higgsfield/Seedance clip generation** (currently NOT the prod-pinned route — would need
   `REEL_VIDEO_PROVIDER` flipped back and costs an estimated `$0.25/clip × 4 generated clips
   (beats 1, 5, 6, 7) ≈ $1.00`, per `generationLedger.ts`'s `COST_ESTIMATES_USD`; beats 3/4 use real
   shop-shot filters instead of generated clips regardless of route, per point 1). Per-beat prompt
   pack below if this route is chosen.
3. **Licensed stock/motion-graphics footage** — fallback only if neither of the above is available.
   I have not sourced or verified any specific stock asset or URL (I don't fabricate URLs); the
   operator would search a licensed library for "car AC vent heat shimmer interior" and confirm
   commercial-use rights before use.

**Higgsfield-style prompt pack (route 2, for the 4 beats not covered by shop-shot filters):**

| Beat | Prompt | Negative prompt |
|---|---|---|
| 1 | Car interior world, dashboard air vents in close macro, visible heat-haze shimmer distortion in the air instead of cool mist, harsh sunlight glare through the windshield, warm oppressive lighting | faces, hands, human figures, on-screen text, logos, watermarks, subtitles |
| 5 | Technical cutaway diagram visualization, air particles pushing through a clogged pleated filter and visibly restricting, then flowing freely through a clean pleated filter beside it, clean schematic lighting on a dark field | (same) |
| 6 | Product commercial macro shot, a clean automotive cabin filter sliding smoothly into an open panel slot, mechanical rig motion only, studio-grade key lighting, dark seamless background | (same) |
| 7 | Car interior world, dashboard air vents in close macro, cool mist now visible instead of heat-haze shimmer, soft comfortable lighting, mirroring the beat-1 opening for a loop seam | (same) |

---

### Assembly (ffmpeg — matches `reelAssembly.ts`'s real technique)

1. **Canvas:** 1080×1920 (9:16), 30fps target.
2. **Concatenate** the 6 motion clips (beats 1, 2, 3, 4, 5, 6, 7 — note beat 2 is its own
   split-screen graphic clip, not a reuse of beat 1) with hard cuts at each beat boundary, matching
   the samples' documented style. A quick whip-pan or hard cut works on the beat 1→2 transition
   (interior → split-screen graphic), since it's a world-change moment the hook needs to feel snappy,
   not slow.
3. **Caption burn-in:** word-level ASS subtitles synced to the VO timing above (karaoke-style
   word-highlight if the ElevenLabs TTS lane with alignment timestamps is used; otherwise beat-synced
   caption blocks off the Google TTS SSML pacing). `PlayResX/Y 1080x1920`, safe zone: keep all text
   inside the middle 60% of frame width and clear of the bottom 20% (UI overlap zone).
4. **Overlay text** (drawtext, NOT part of the generated video): "TWO FILTERS. ONE JOB EACH.,"
   "ENGINE FILTER — PROTECTS THE ENGINE," "CABIN FILTER — CLEANS YOUR AIR," "CLOGGED = LESS AIRFLOW,"
   "OFTEN A 10-MINUTE SWAP," "WORTH CHECKING," and the CTA card in beat 8.
5. **Audio mix:** VO track centered; no music bed by default — see §6 (rights gap). A soft AC-fan
   hum under beats 1 and 7 (opposite tone: strained/weak on beat 1, smooth/full on beat 7) is a short
   SFX texture, not a licensed music track, and carries no rights question.
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
| Shop-shot footage (beats 1, 3, 4, 7 at minimum) | **$0** | This concept has the strongest shop-shot coverage of any pack in this series — real filters and a real car interior cover most of the emotional weight |
| `template_stock` (prod default) | **$0/clip** | Free, but produces abstract backdrops — unsuitable for this concept's filter-macro and interior-heat-haze beats as-is (see §4) |
| Higgsfield/Seedance (currently inactive route) | **≈$0.25 × 4 clips ≈ $1.00**, labeled an ASSUMPTION in the source comment, not a metered price | Only needed for beats 1, 5, 6, 7 if shop-shot doesn't cover them; would need `REEL_VIDEO_PROVIDER` flipped — an operator/config decision, not mine to make |
| TTS (Google Neural2-J or ElevenLabs) | Not itemized in the cost table read | Google lane is free-quota; ElevenLabs is the paid fallback only if Google fails |

**Honest self-score against the real 75-point gate** (see §2's per-concept table): estimating this
pack manually against `calculateReelQualityScore()`'s known weights —

first-frame 7/10 (heat-haze-in-vents is a decent but not spectacular scroll-stop; a literal caked
filter reveal at beat 4 is the stronger hook candidate and could be considered for the opener
instead) · muted-first 9/10 (the "two filters" split-screen and caked-filter macro both read clearly
with sound off) · beat structure 5/5 · length 5/5 · loop 5/5 (fixed via the beat-7 mirror on beat 1)
· sourced fact 9/10 (three of five claims are pre-approved slate wording or clearly hedged
common-knowledge) · faceless 10/10 · claim safety 10/10 · keyword 5/5 · winning-concept bonus 0/5
(Concept A scored 49/60 in §2, below the skill's stated `≥57/60` sub-threshold) — **estimated total
≈65/75**, below the real gate's 70/75 floor.

That's a genuine finding, not false modesty: the weakest dimension is the hook (7/10) — a heat-haze
vent shot is a fine setup but not a strong scroll-stop on its own. An editor's pass that opens
directly on the caked filter reveal (moving today's beat 4 to the front, à la a "you won't believe
what's in your vents" cold open) is worth testing against this ordering before spending render
budget — flagged as a concrete next step, not buried.

---

## 6 · Audio/music rights status

**No music-rights ledger exists in this repo** — confirmed real gap, not an oversight on my part.
This pack defaults to **no licensed music bed**: VO (Google TTS / ElevenLabs, both real working
lanes with no rights question) plus short SFX texture (AC fan hum, strained vs. smooth) mixed under
it. If the operator wants a music bed, the lowest-friction, zero-rights-question option is Meta's
own built-in royalty-free audio library inside the Instagram/Facebook Reels composer (pre-cleared
for that platform) — I have not selected or verified a specific track, since I have no live access
to browse it.

---

## 7 · QA matrix

| Gate | Verdict | Backed by |
|---|---|---|
| Claim-safety wording (no prices, no guarantees, approved soft language) | **PASS** | Manual check against `client/src/lib/facelessReelStudio.ts`'s approved phrase list — script uses "worth checking" / "usually" / "often," never states a diagnosis as certain, and hedges the glovebox-location claim with "commonly" |
| Brand-voice kill list (`shared/voice.ts`) | **PASS (manual)** | Manually checked every VO/caption/hashtag line against the kill-list categories described in prior packs — no obvious hits; **not run through the live linter**, since this session has no path to it |
| Faceless / standing negative prompt compliance | **PASS (by design of the prompts)** | Prompt pack in §4 carries the standing negative prompt on every generated beat; beat 6's hands-vs-no-hands routing choice is flagged explicitly rather than left ambiguous |
| Repetition ledger (21-day, live DB) | **UNKNOWN** | Not queried — no live DB access this session (see §1); paper-substitute check against all 16 existing reel-pack PRs (open + closed) found no topic overlap |
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

> Vents on full blast and it's still not cold?
>
> Your car has two air filters, and only one ever gets blamed. The engine filter protects the
> engine — that's not your problem. The cabin filter cleans the air coming through your vents, and
> it's usually caked.
>
> A clogged filter chokes the airflow, so even good AC feels weak. Often a ten-minute swap.
>
> Worth checking before you blame the AC system.
>
> #cartips #carmaintenance #clevelandohio #euclidohio

### Variant B — Comment-keyword style (matches the older Studio samples' `campaignKeyword` convention)

> Think your AC is broken?
>
> It might just be buried air. Your cabin filter cleans everything coming through your vents, and a
> caked one chokes the airflow before the AC ever gets a chance — even when the system itself is
> fine.
>
> Comment AIRFLOW and we'll check it when you stop by, no charge.
>
> #cartips #carmaintenance #clevelandohio #euclidohio

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

1. Pick a visual-sourcing route (§4) — this concept has the strongest shop-shot coverage in the
   series (two real filters + a real car interior), but beats 1/5/6/7 still need a route 2/3 decision
   or a simpler in-car phone-shot substitute.
2. Consider testing the reordered hook flagged in §5 (opening on the caked-filter reveal instead of
   the heat-haze vent shot) before spending render budget — the manual estimate suggests the current
   hook ordering is this pack's weakest dimension.
3. Check `REEL_AUTOPOST_ENABLED` and today's post count before scheduling manually — the daily cron
   may already be posting today independent of this pack, and the account is capped at 2 feed
   posts/day with 3h spacing.
4. Drive it through `POST /api/admin/reel-canary` (`start` → `advance` → `qa`) to get an actual
   rendered, QA-gated asset — and only call `{action:"publish"}` with a live go-ahead for this
   specific asset, per both skill files' hard rule.
