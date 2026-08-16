> **ALTERNATE TAKE.** A second scheduled run (#1610, 20:36) produced this pack for
> the same concept as the one in `README.md` (#1607, 18:32) — it could not see the
> first, because at 20:36 that pack was still an unmerged draft and the
> "check the directory before writing" rule only reveals MERGED packs.
>
> Kept rather than discarded: on the three things that matter it is the stronger
> script, and whoever produces this concept should choose deliberately.
>
> | | README.md (#1607) | this take (#1610) |
> |---|---|---|
> | hook | "Everyone blames winter for this." | **"You'll blame winter for this."** — second person |
> | structure | 7 beats / 33s | **5 beats / 30s** — fewer, longer beats, less choppy |
> | CTA | "Worth checking before it strands you." | **"Free check before the first cold morning strands you."** — names the offer |
>
> The `brief.json` and `captions.srt` in this directory belong to the README take.
> This take's captions are alongside as `ALTERNATE-TAKE.captions.srt`.

# Reel production pack — "Summer already did the damage" (BATTERY)

Scheduled-task run · 2026-08-16 · mode `INTELLIGENCE`/`PRODUCTION` (research + pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **BATTERY**

**No video was rendered, no database was read, and nothing was posted.** This is a
production-ready pack per the skill's fallback path — see §1 for exactly why, and §4 for how an
operator turns it into a real MP4. Machine-readable version: [`brief.json`](./brief.json) (matches
the app's real `ReelBrief`/`ReelConcept`/`StoryboardBeat`/`HiggsfieldBeatPrompt` shapes in
`apps/nickstire/client/src/lib/facelessReelStudio.ts`). Captions: [`captions.srt`](./captions.srt).

---

## 1 · Mode, capabilities, repetition context

**Mode:** This session was fired by a stored scheduled prompt, not a live operator instruction.
Per the reel-operator skill's hard rule, a scheduled firing is never publish (or generation)
authorization — this run stops at `INTELLIGENCE` (topic research + scoring) and `PRODUCTION`
(pack authoring), with zero calls toward `/api/admin/reel-canary`.

**Capability check (probed this session, not assumed):**

| Tool the source instructions asked about | Status this session | Evidence |
|---|---|---|
| Script/brief generation ("ChatGPT") | ✅ Available | Written below in the app's real `ReelBrief` shape |
| TTS (Google Neural2 / ElevenLabs) | ❌ Not connected | No TTS tool surfaced to this session; `server/services/reelVoice.ts` needs `GOOGLE_SERVICE_ACCOUNT_EMAIL/KEY` or `ELEVENLABS_API_KEY`, neither reachable here |
| Higgsfield (AI clip generation) | ❌ Not connected | No Higgsfield MCP/tool in this session; `getHiggsfieldAccountHealth()` was **not queried** — no path to call it |
| Meta/Instagram posting | ❌ Deliberately not used | Protected customer-facing action per root `AGENTS.md`; a scheduled task is explicitly excluded from being authorization, per the reel-operator skill's hard rule |
| Shell/render (ffmpeg) | ❌ Not available | `ffmpeg` is not installed in this container (`which ffmpeg` → not found) |
| `ADMIN_API_KEY` / `/api/admin/reel-canary` | ❌ Not available | `printenv` shows no `REEL_*`, `HIGGSFIELD*`, `ADMIN_API_KEY`, or `DATABASE_URL` in this session's environment — no path to the real pipeline even read-only |
| CapCut or similar editor | ❌ Not integrated | No connector exists in this environment or the app |

Net: none of the tools the source instructions asked about (ChatGPT/TTS/Higgsfield/Meta
posting/shell render/CapCut) are connected to this session. Per the source instructions'
own rule #5 and the skill's "producing a pack when the motion route is unavailable" section,
that means: **full production-ready pack, not a claimed render.**

**Repetition ledger (`getRecentReelSignals`, real 21-day DB read):** **NOT QUERIED** — the repo's
only `DATABASE_URL` is production TiDB and this session has no credential for it anyway. Paper
substitute performed instead (grep-verified this run):

- `apps/nickstire/docs/reel-packs/` currently holds 3 prior full packs: `2026-08-14-penny-test`
  (TREAD / penny_test_inspector), `2026-08-14-tire-expiration` (tire date-code angle),
  `2026-08-15-tread-fingerprint` (TREAD / tread-wear-pattern angle). None use the `BATTERY`
  keyword or the `battery_heat_victim` object character.
- `apps/nickstire/client/src/lib/facelessReelStudioSamples.ts` ships 3 reference concepts
  (`PRESSURE`/`tire_pressure_balloonist`, `POTHOLE`/`pothole_gremlin`,
  `BRAKES`/`brake_pad_lifeguard` + `rotor_alarm_bell`). `grep -r "BATTERY|battery_heat_victim"` across
  `apps/nickstire/**/*.ts` returns only the enum *definitions* in `facelessReelStudio.ts` — zero
  prior *usage* of this keyword/character pair anywhere in the repo.
- `docs/REEL-SLATE-2026-07-31.md` item #12 ("Battery warnings before it strands you") is the
  closest prior art — a symptom-listing angle (slow crank, dim headlights, jump-start history).
  This pack's angle is a myth-correction (heat vs cold as the real cause), not a reskin of #12,
  and it deliberately reuses #12's brand-voice-approved sentence "Most batteries last three to
  five years... Cleveland winters/heat are hard on them" as sourced precedent rather than
  inventing a new unverified lifespan claim (see §3).

An operator should still run the real `getRecentReelSignals()` before enqueue — this is a
paper check, not a live clearance.

---

## 2 · Candidate concepts and scores

Two concepts considered, scored 0–10 per dimension on the app's real `ReelConceptScores` rubric
(hook / truth / save / local / absurdity / fit, max 60). **These are manual estimates, not a live
`calculateReelQualityScore()` or critic-panel run** — flagged honestly, not inflated.

### Concept A — "Myth vs Reality x-ray" (SELECTED)

Split-screen winter-vs-summer open, push into an x-ray reveal of the battery corroding under
summer heat, then a payoff back on the cold-morning symptom the driver actually notices.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 9 | 9 | 9 | 8 | 8 | 10 | **53** |

### Concept B — "Diorama heat-stroke victim" (parked)

Tilt-shift miniature battery visibly wilting under a diorama sun all summer while a driver comes
and goes obliviously, `part_as_character_drama` archetype.

| hook | truth | save | local | absurdity | fit | **total /60** |
|---|---|---|---|---|---|---|
| 8 | 8 | 7 | 6 | 9 | 8 | **46** |

**Selected: Concept A.** Stronger truth/save/local/fit; the x-ray reveal is a sharper visual
payoff for the mechanism than a diorama metaphor, and the CTA lands more directly. Full detail
for both is in `brief.json`'s `concepts` array — Concept B is preserved there, not discarded.

**Honesty note:** neither concept clears the real 57/60 "winning concept" bonus band in
`calculateReelQualityScore()`. See §5 for what that costs the total score.

---

## 3 · Claim evidence

| Claim | Status | Source |
|---|---|---|
| "Batteries usually last three to five years" (+ Cleveland heat/cold shortens it) | **Precedent-approved copy**, not fresh entailment | Verbatim from `docs/REEL-SLATE-2026-07-31.md` item #12, brand-voice-approved 2026-07-31 per that doc's own header |
| "Heat accelerates internal battery corrosion and evaporates electrolyte fluid, and is a leading cause of failure" | **UNKNOWN — not live-evaluated** | Standard automotive-education claim (category matches `APPROVED_SOURCES` entries like "Car Care Council" in `facelessReelStudio.ts`), but this session had no path to `evidenceResolver.ts` or a live `EvidenceRecord`. Kept as a general mechanism statement, not a diagnosis of the viewer's specific car, to stay inside the approved soft-language bank either way. |
| "Free check" service offer in the CTA | **BLOCKED — pending human clearance** | Wording matches `businessFacts.ts` `factKey: "repair.pricing_policy"` verbatim, but that fact's `channels` array is `["sms","voice","web"]` only — there is no `"reel"`/`"social"` `FactChannel` yet (a real, documented gap in this repo, not this pack's invention). The phrasing happens to match approved brand voice; that is not the same as this specific fact being cleared for social/video use. **An operator must explicitly clear "free check" for reel copy before this ships**, or swap it for a channel-neutral CTA ("come by before the first cold morning"). |
| Local/weather ("Cleveland's first cold snap") | **UNKNOWN, not asserted as current** | No live weather/event source is wired into this pipeline; phrased as a recurring seasonal pattern, not a claim about *this* week's forecast. |

No `UNKNOWN` was silently dropped — the CTA's "free check" line in particular should be treated as
**blocking** until cleared, not merely noted.

---

## 4 · Full production pack

### 4.1 Script — word-for-word, timed

```
[0:00-0:02] You'll blame winter for this.
[0:02-0:05] But summer already did the damage.
[0:05-0:14] Heat speeds up the chemical reaction inside a battery. It corrodes the
            plates and evaporates the fluid — quietly, all summer, under a hot
            engine hood.
[0:14-0:24] The first sign shows up on a cold morning — a slow crank, dim
            headlights at idle. But by then the battery had been weakening
            since July.
[0:24-0:30] Batteries usually last three to five years. Cleveland heat shortens
            that. Free check before the first cold morning strands you.
```

Total runtime: 30s (5 beats: 2s / 3s / 9s / 10s / 6s), plus a 3s loop-freeze on the final frame
per the render-integrity contract below → 33s container.

**Claim-safety self-check** (manual pass against `FORBIDDEN_CLAIM_PATTERNS` /
`OVERDIAGNOSIS_PATTERNS` / `FEARMONGER_PATTERNS` in `facelessReelStudio.ts` — zero regex hits found
on this script): no bare "free" (only "free check", the one approved form), no guarantee/warranty
language, no "you need", no exact wait times, no "this means your X is broken" diagnosis, no
fear-leverage phrasing ("could kill", "time bomb", etc). This is a manual read, not the app's live
linter — an operator should still run `scripts/lint-brand-voice.ts` before enqueue.

### 4.2 Asset list — per-beat generation prompts

Motion lens: **x-ray cutaway** (`xray_cutaway` in `facelessReelStudio.ts`) —
grammar: *"Technical x-ray cutaway visualization, translucent layered materials, cool schematic
glow, clean dark field, precise engineering aesthetic."* Avoid: *"film grain, bokeh, photorealistic
product-ad lighting."*

**Standing negative prompt on every beat** (per the skill's no-motion-route fallback instructions):
`faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

| Beat | 0–2s | Prompt |
|---|---|---|
| 1 | Hook | Split-screen: left, snowy pre-dawn driveway, sedan with dashboard battery-warning glow through the windshield, cold blue light. Right, same sedan's open engine bay under blazing midday sun, visible heat shimmer above the battery. Technical x-ray cutaway visualization, translucent layered materials, cool schematic glow, clean dark field, precise engineering aesthetic. No people, no plates, no readable badges. |
| 2 | Turn | Fast push-in through summer engine-bay heat shimmer into a translucent x-ray cutaway of the battery casing, internal plates and electrolyte fluid visible in cool schematic glow. |
| 3 | Mechanism | Extreme detail x-ray cutaway of battery plates: visible corrosion crawling across plate surfaces, electrolyte fluid line slowly receding, subtle heat-glow pulsing around the casing exterior. Slow continuous real-time reveal. |
| 4 | Payoff | Match-cut to the winter half of the split-screen: pre-dawn driveway, sedan dashboard through the windshield, dimming dashboard glow implying a slow crank, cold blue exterior light. Photoreal but restrained, no film grain. |
| 5 | CTA/loop | Slow pull-back to the full split-screen frame from the opener, a single thin glowing schematic thread now visibly connecting the two halves. Composition matches beat 1 for the loop cut. |

*(Full per-beat objects with `styleKit`/`safeZoneGuidance`/`conditioningMode` are in
`brief.json → promptPack`.)*

**Stock-footage fallback** (if `REEL_VIDEO_PROVIDER=template_stock`, per §5 — the app's free,
no-generation lane): search terms for a stock library — "car engine bay heat shimmer summer",
"snowy driveway car won't start dashboard", "battery corrosion close up macro", "car dashboard
warning light cold morning". No specific stock URLs are provided here — this session has no
licensed stock connector; an operator sources and licenses clips manually or via the app's Adobe
Stock search integration if available in their session.

**Music bed:** low, non-lyrical schematic/tension bed, ducked to roughly -8dB under the
voiceover. **No specific track is named or cleared** — see §6, this repo has no music-rights
ledger; treat any track as unlicensed until an operator confirms usage rights.

### 4.3 Caption timing — [`captions.srt`](./captions.srt)

11 caption cues covering the full 0:00–0:30 VO, phrase-grouped for on-screen burn-in (roughly
2–4s per cue, matched to natural speech breaks). Per-beat `onScreenText` (shorter punch versions
for the muted-first pass) is in `brief.json → storyboardBeats`.

### 4.4 Editing instructions

1. Normalize all 5 rendered/sourced beat clips to 1080×1920 (9:16), 30fps.
2. Concatenate in beat order at storyboard durations (2s / 3s / 9s / 10s / 6s = 30s): hard cut
   beat 1→2, fast push-cut beat 2→3, hard cut beat 3→4, ~0.3s cross-dissolve into beat 5 for the
   loop feel.
3. Burn in on-screen text per beat (see `storyboardBeats[].onScreenText`), center-safe, clear of
   the bottom ~20% (IG UI safe zone).
4. Lay the voiceover (§4.1) under a low schematic/tension music bed, VO up front, music ducked.
5. Add a 3s hard-freeze on the final loop frame (the "SAVE-freeze" convention this repo's render
   pipeline expects) so the loop reads cleanly on repeat → 33s final container.
6. Before treating this as a finished asset, it must clear the app's real render-integrity gate
   (`reelAssembly.ts` "#800/#801", enforced server-side, not just described here): container
   duration within 0.75s of 33s, video-stream duration matching (container duration can lie via
   the audio track), ≥80% of expected 30fps frame count, and ≥3 distinct MD5s among 5 sampled
   frames (motion proof — a still image or frozen loop fails this).

### 4.5 Posting specs

- **Platform:** Instagram Reels (primary), Facebook Reels (cross-post) — `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, 30fps, H.264/AAC MP4
- **Runtime:** 33s (30s content + 3s loop-freeze)
- **Caption (IG/FB copy):**

  > Everyone blames the first cold morning. The real damage happened all summer.
  >
  > Heat speeds up the chemical reaction inside a battery — it corrodes the plates and
  > evaporates the fluid, quietly, all season, under a hot engine hood. The cold morning is
  > just when it finally shows.
  >
  > Most batteries last three to five years, and Cleveland heat shortens that. If yours is
  > close, come by for a free check before the first cold snap.
  >
  > 17625 Euclid Ave, Cleveland OH · (216) 862-0005
  >
  > #carbattery #clevelandohio #cartips #euclidohio #carmaintenance

  ⚠️ Contains the "free check" line flagged **BLOCKED** in §3 — swap or clear before posting.

- **Hashtags:** `#carbattery #clevelandohio #cartips #euclidohio #carmaintenance`
- **Posting slot:** per `docs/REEL-SLATE-2026-07-31.md`'s cadence (7:00 AM ET or 2:00 PM ET,
  fixed slots) — not scheduled by this run.

---

## 5 · Credit-risk and fallback routing

Estimates only — no live read of `getHiggsfieldAccountHealth()` or `REEL_VIDEO_PROVIDER` this
session (neither reachable, per §1).

| Route | Per-clip cost (from `generationLedger.ts` `COST_ESTIMATES_USD`) | 5-beat estimate |
|---|---|---|
| `template_stock` (free local lane) | `$0` (`template_stock_clip`) | **$0.00** — documented as prod's current pin in `docs/operations/REEL-PIPELINE.md`, not re-verified live this run |
| Seedance/Higgsfield | `$0.25`/clip (`seedance_clip`, source comment: *"ASSUMPTION (unverified)... operator-tunable"*) | **~$1.25** |
| Veo | `$0.10`/second (`veo_second_720p`, Google-published) × 30s | **~$3.00** |

Real guardrails an enqueue would hit, in order (from `docs/runbooks/reel-pipeline.md`, not
re-read live this run): `RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h between
feed posts) → `REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`
(`maxGenerationCostPerDayUsd`, current value not read this session). This pack's BATTERY keyword
and topic have no known collision against those windows per the paper repetition check in §1, but
that is not the same as a live guardrail pass.

---

## 6 · Audio/music rights status

**Real gap, not this pack's invention:** no music-rights ledger exists anywhere in this repo. No
track is named or cleared for this pack. Treat any music bed as **UNKNOWN/BLOCKED** until an
operator sources and confirms a licensed (or royalty-free-for-commercial-use) track. Voiceover
audio, separately, would go through `server/services/reelVoice.ts` (Google Neural2 / ElevenLabs)
if generated for real — not run this session (§1).

---

## 7 · QA matrix

| Gate | Result | Backing |
|---|---|---|
| Rendered QA / vision critic (`renderedQa.ts`) | **BLOCKED** | No render exists to critique |
| Repair routing (`repairRouter.ts`) | **N/A** | Nothing generated to repair |
| 7-way decision (`qualityAutomation.ts`) | **N/A** | No job row exists |
| Consolidated publish gate (`qualityGate.ts` / `evaluateReelPublishGate`) | **N/A — never invoked** | No enqueue happened this run |
| Manual `calculateReelQualityScore()` estimate | **65/75 (estimated) — below the real 70/75 pass floor** | See breakdown below; this is a manual read, not the live function |
| Render-integrity gate (duration/frame-count/motion-MD5, `reelAssembly.ts` "#800/#801") | **BLOCKED** | No render exists to check |
| Claim-safety pattern banks (manual regex read) | **PASS (manual)** | §4.1 — zero hits across all three pattern banks on the final script |

**Manual quality-score breakdown (65/75 estimated, real weights from `facelessReelStudio.ts`):**

| Dimension | Max | Estimate | Why |
|---|---|---|---|
| First-frame scroll-stop | 10 | 7 | Split-screen hook is solid, not top-tier shock value |
| Muted-first clarity | 10 | 9 | Every beat's `onScreenText` carries the full idea without audio |
| Beat structure | 5 | 5 | 5 beats, within the valid 4–6 range, clean hook/setup/value/CTA shape |
| Length | 5 | 5 | 33s container is within the 15–60s target |
| Loop | 5 | 4 | Loop idea defined and matched in the prompt pack, not render-verified |
| Sourced fact | 10 | 5 | Precedent-approved lifespan line, but the heat mechanism is unverified this run (§3) |
| Faceless | 10 | 10 | No people/hands/faces in any beat |
| Claim safety | 10 | 10 | Manual pattern-bank pass (§4.1) |
| Keyword | 5 | 5 | `BATTERY` is a valid `CampaignKeyword` |
| Winning concept ≥57/60 bonus | 5 | 0 | Concept A scored 53/60 manually — under the bonus threshold |
| **Total** | **75** | **65** | **Below the real 70/75 auto-gate floor** |

This is reported honestly rather than rounded up: as scored, this concept would not clear the
app's real quality gate without either a live evidence check on the heat-corrosion claim, a
stronger opening hook, or both.

---

## 8 · IG/FB copy + ad-ready variants

Primary copy is in §4.5. Two additional hook/caption/CTA variants for ad testing:

**Variant 1 — direct myth-correction hook**
- Hook: "You've been blaming the wrong season."
- Caption: "Cold weather doesn't kill batteries — heat does. Cleveland summers cook the plates all
  season; the cold morning just reveals it. Most batteries last three to five years. If yours is
  close, come by before the first cold snap."
- CTA: "Come by before the first cold snap."

**Variant 2 — self-check angle**
- Hook: "Slow crank on a cold morning? The damage started in July."
- Caption: "Heat speeds up battery corrosion all summer long — the failure just shows up on the
  first cold morning. Slow crank, dim headlights at idle: both point the same direction. Most
  batteries last three to five years, less in Cleveland heat."
- CTA: "Worth checking before the first cold morning."

Both variants avoid the "free check" line flagged BLOCKED in §3, so they are safe to use without
that specific clearance — only the primary caption in §4.5 needs the operator sign-off.

---

## 9 · Final status

**READY FOR HUMAN APPROVAL** — not `PRODUCTION-READY`.

Reasons, stated plainly rather than rounded up:

1. No motion route was available this session (§1) — this is a pack, not a rendered asset, by
   design, not by failure to try.
2. The manual quality-score estimate (65/75, §7) lands below the app's real 70/75 pass floor —
   an operator should either accept the gap knowingly or punch up the concept (stronger hook,
   live evidence check on the heat-corrosion claim) before enqueueing for real.
3. The "free check" CTA line is **BLOCKED** pending explicit operator clearance for reel/social
   use (§3) — a real, specific gap in `businessFacts.ts`'s channel scoping, not a hypothetical one.
4. The repetition check in §1 is a paper substitute for the live `getRecentReelSignals()` read —
   real, but not sufficient on its own to authorize an enqueue.

No generation, database read, or publish call was made against production this run.
