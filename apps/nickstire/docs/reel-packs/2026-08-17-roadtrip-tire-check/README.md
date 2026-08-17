# Reel production pack — "The ten-minute check before a road trip" (2026-08-17)

Scheduled-task run · 2026-08-17 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **TIRES**
· source: `server/services/shadowPlanner.ts` `SHADOW_CAMPAIGNS` entry
`roadtrip_check` (code-committed, not a live DB read — see §1)

**No generation, DB read, or publish call was made against production this run.**
This is a scheduled/automated firing with no live operator present. Per the
operator skill's hard rule (mirroring root `AGENTS.md`'s protected-operations
list), a stored scheduled prompt does not authorize a `reel-canary` call, a
spend, or a publish — and a live-DB repetition/quality-score read is itself a
production action, not a free one. None of those were attempted this run.

**⚠️ Standing pipeline-health finding — now a second flag, not a new one.**
PR #1624 (the 2026-08-17 07:46 UTC run, "summer-heat-tire-pressure") already
surfaced this: scheduled runs were producing roughly one pack per hour with
none merged. At that time there were 10 open pack PRs. As of this run there
are **21 open, unmerged draft PRs** (#1614–#1637, spanning 2026-08-16 22:38
through 2026-08-17 20:31 — nearly 22 hours, roughly hourly cadence, zero
merged) plus 5 already-merged packs — **26 packs produced in under 4 days**,
none fed into a real `/api/admin/reel-canary` run per any pack's own receipt.
This run did not change the schedule or touch any other PR — that decision
belongs to the operator — but is escalating it via a direct notification
alongside this receipt, since one prior in-PR flag has not visibly changed
the cadence.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops short
of any `/api/admin/reel-canary` call and short of any live read against
production TiDB.

**Capabilities — not probed this run, stated as such rather than assumed:**

| Capability | Status this run | Why |
|---|---|---|
| `getHiggsfieldAccountHealth()` (creds/balance) | Not called | Requires a live server process + `HIGGSFIELD_API_KEY`; `env` in this session has no `HIGGSFIELD_*`, `REEL_*`, `ADMIN_API_KEY`, or `DATABASE_URL` set at all (confirmed by grep this run) |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` documents prod pinned to **`template_stock`** (last written); not re-confirmed live |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | Not read live | If `REEL_AUTOPOST_ENABLED=true`, the daily cron may already have posted or reserved today's slot independent of this pack |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session |
| `/api/admin/reel-canary` | Not called | Blocked by the hard rule for a scheduled firing |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action; requires a live, in-the-moment operator instruction every time, which this run does not have |
| `ffmpeg` / `ffprobe` (local render/verify) | Not present | Checked this run — neither binary is on `PATH` in this session |
| CapCut | Not integrated | Desktop app, no connector exists here |

Net: nothing on the source instructions' requested tool list (ChatGPT / TTS /
Higgsfield / Meta posting / CapCut / shell-render) is connected to this
session. Per that instruction's own step 5 ("if tools are missing, produce a
production-ready pack instead"), defaulting to the pack — consistent with
every prior run in this series.

**Repetition context — checked BOTH required sources, per the skill (the
merged directory alone only shows reviewed work):**

- `ls apps/nickstire/docs/reel-packs/` → 5 merged: penny-test (tread/penny
  check), tire-expiration (rubber aging/DOT date), tread-fingerprint (wear
  patterns → alignment), battery-summer-heat, squealing-vs-grinding-brakes.
- Open PRs titled "reel production pack" (`gh`/GitHub search, 21 results,
  #1614–#1637): coolant-color, spare-tire-mileage, balance-vs-alignment,
  check-engine-light, wheel-bearing-hum, repair-authorization-questions,
  cabin-vs-engine-air-filter, "noises that mean stop driving now",
  oil-change-intervals, why-car-pulls, summer-heat-tire-pressure,
  strut-bounce-test, exhaust-smoke-color, tire-rotation, wiper-blade-check,
  pothole-damage, transmission-fluid-color-test, plug-vs-patch tire repair,
  tread-depth rain-vs-snow, serpentine-belt-squeal, and one unrelated PR
  (#1632, Higgsfield API key admin UI — not a content pack).

None of those 26 known packs/PRs run the pre-trip multi-point-check /
booking angle this pack uses — see §2 for how this differs from the
single-system deep-dives (tread, pressure, wipers, belts) that already exist
individually. This is a file/PR check, not the live `reel_jobs` ledger — a
job that never produced a written pack would not show up here, so "not
found" is directional, not a guarantee.

---

## 2 · Candidate scores and selection

Scored `shadowPlanner.ts`'s `SHADOW_CAMPAIGNS` for August-active entries not
yet covered by topic (same method PR #1624 used):

| Campaign id | Keyword | Months | Urgency | Covered already? | Selected? |
|---|---|---|---|---|---|
| `roadtrip_check` | TIRES | 5,6,7,8 | 10 | No — closest neighbors are tread-depth, tire-rotation, and tire-pressure packs, but all three are single-system deep-dives, not a bundled pre-trip check | ✅ **Selected** |
| `echeck_deadline` | ECHECK | year-round | 7 | Adjacent to "check-engine-light" (#1615); parked to avoid overlap | Parked |
| `vibration_highway` | VIBRATION | year-round | 6 | Overlaps "why-car-pulls" (#1622) and "balance-vs-alignment" territory | Parked |
| `brake_noise` | BRAKES | year-round | 11 | Directly covered — "squealing-vs-grinding-brakes" is merged | Rejected (duplicate) |
| `tpms_light` | TPMS | year-round | 8 | Adjacent to "summer-heat-tire-pressure" (#1624); parked to avoid the same TPMS-light angle that pack already used | Parked |

`roadtrip_check` selected: highest urgency (10) among in-season, genuinely
uncovered campaigns, `objective: "booking"` (a stronger business action than
the mostly `save`/`message`-objective topics already produced), and
`marginClass: "high"`.

**Honest overlap disclosure:** this pack's four checklist beats (tread,
pressure/spare, belts/hoses, fluid levels) individually touch subject matter
that tread-fingerprint, summer-heat-tire-pressure, spare-tire-mileage, and
serpentine-belt-squeal each cover in depth. This pack does not re-explain
any of those mechanics — it stays at the "here's what a single ten-minute
shop check catches, all at once, before you leave town" level, using the
`fast_countdown_list` archetype (a format none of those four packs use) and
ending on a **booking** CTA rather than a **DIY-check-it-yourself** CTA. If
an operator finds this too close to the existing library on review, the
correct fix is dropping to 3 beats and leaning harder on the "one visit vs.
four separate trips" framing rather than discarding the concept.

### Concept scoring (manual, not a live critic-panel run)

| | hook | truth | save | local | absurdity | fit | **/60** |
|---|---|---|---|---|---|---|---|
| Selected — countdown checklist | 7 | 8 | 6 | 5 | 4 | 9 | **39** |

Below the skill's informal `≥57/60` "winning concept" bonus threshold —
flagged honestly, not hidden (see §5's real quality-score estimate too).

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| Worn tread combined with sustained highway heat raises blowout risk | General tire-engineering fact (heat + low tread + speed increases failure risk); not shop-specific | **UNKNOWN against this repo's evidence store** — no live `EvidenceRecord` from `evidenceResolver.ts` (not queried, prod DB). Phrased as risk ("waiting on a schedule"), not a certainty. |
| A spare tire is commonly left unchecked between uses | Common-knowledge framing, matches the merged `spare-tire-mileage` pack's own premise | **Corroborated by repo precedent** — not a new/unverified claim for this account |
| A hairline crack in a belt or hose can fail without warning | General mechanic fact (rubber fatigue under heat cycling); not shop-specific | **UNKNOWN against this repo's evidence store** — same caveat as above |
| Low fluid is cheap to catch in a driveway; empty is expensive on a highway shoulder | Common-sense cost-avoidance framing, not a specific numeric or shop claim | **N/A — deliberately general**, no price stated |
| No price, warranty, or shop-specific policy claim is made anywhere in this script | `businessFacts.ts` `SEED_FACTS` grepped for an "inspection"/"multi-point check" fact — none found scoped for public/reel use | **N/A — deliberately avoided**, consistent with the repo's `FactChannel` gap (`"sms" \| "voice" \| "web"` only, no `"reel"` channel yet) |

Every line uses the approved soft-language bank from
`client/src/lib/facelessReelStudio.ts` (*can point to · worth checking · one
clue*) — no claim states a diagnosis as certain, and no guarantee or price is
implied for the check itself.

---

## 4 · Full production pack

**Archetype:** `fast_countdown_list` ("3-2-1 ranked clues with kinetic
typography," `client/src/lib/facelessReelStudio.ts` `REEL_ARCHETYPES`) — not
used by any of the 26 known prior packs in this series, per §1.
**Motion lens:** `forensic_evidence_scan` for the four checklist beats
(diagnostic/inspection framing fits a "here's what gets found" checklist),
`product_ad_macro` for the closing garage-counter CTA beat.

### Script — word-for-word, timed (28s, 6 beats)

| Beat | Window | Narration (word-for-word) | On-screen text (ffmpeg overlay, never AI-generated) |
|---|---|---|---|
| 1 · HOOK | 0:00–0:03 | "Most road-trip breakdowns start as a ten-minute check somebody skipped." | — |
| 2 · #4 | 0:03–0:08 | "Four: tread depth. Worn tread on hot highway miles is a blowout waiting on a schedule." | "4 · TREAD" |
| 3 · #3 | 0:08–0:13 | "Three: pressure — all five tires, including the spare nobody's looked at since it came off the truck." | "3 · PRESSURE + SPARE" |
| 4 · #2 | 0:13–0:18 | "Two: belts and hoses. A hairline crack you can't feel is exactly what quits at mile two hundred." | "2 · BELTS + HOSES" |
| 5 · #1 | 0:18–0:23 | "One: fluid levels. Low is cheap to catch in the driveway. Empty is expensive on the shoulder." | "1 · FLUIDS" |
| 6 · CTA | 0:23–0:28 | "All four, one visit, before you go. Nick's Tire and Auto — link in bio." | "ONE VISIT. BEFORE YOU GO." |

Standing negative prompt for every beat, matching the pipeline's real M10
preflight contract: `faces, hands, human figures, on-screen text, logos,
watermarks, subtitles` — all on-screen words above are ffmpeg overlays added
at assembly, never asked of the video generator. No real person's name
appears anywhere in this script.

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes, self-estimated score): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per
beat.** Per-beat prompts are in `brief.json`.

**Fallback / actual-prod route — `template_stock`** (free, local ffmpeg, the
route `docs/operations/REEL-PIPELINE.md` documents as currently pinned in
prod). Manual stock-search terms (no specific clip URLs asserted — none
verified live this run):

- Beat 2 (tread): "tire tread depth gauge closeup" / "tire tread wear macro"
- Beat 3 (pressure/spare): "tire pressure gauge on valve stem" / "spare tire trunk well"
- Beat 4 (belts/hoses): "engine bay serpentine belt closeup" / "radiator hose macro"
- Beat 5 (fluids): "engine oil dipstick check" / "coolant reservoir level macro"
- Beat 6 (CTA): "auto repair garage bay interior daylight"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; the script above is exactly what gets
fed to it, already timed to the 28s budget (~68 spoken words ≈ 2.4 words/sec,
in range for both TTS lanes' default pacing).

### Captions

[`captions.srt`](./captions.srt) — 9 cards, phrase-grouped, timed to the
narration above. Style: white bold sans, black outline/shadow, bottom-third
safe zone — burn in via ffmpeg `subtitles` filter, never as a generated
in-frame element.

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background clip per beat → optional
   ambient SFX → voiceover track → burned-in caption track → countdown-number
   overlay (beats 2–5 only) → end-card CTA text (beat 6).
2. **Assembly:** concatenate the 6 beat clips in order, hard cut on each
   boundary — a countdown format reads better on sharp cuts than dissolves.
3. **Captions:** burn in per `captions.srt`, bottom-third safe zone, sized
   for 9:16 mobile legibility.
4. **Countdown numerals:** large "4," "3," "2," "1" kinetic-type overlay,
   top-third, entering with a quick scale-in on each beat's first frame —
   the archetype's defining visual device.
5. **Color:** consistent neutral daylight/shop-lighting grade across all six
   beats (unlike the battery pack's day/night contrast, this concept reads
   as one continuous inspection, not a time-of-day story).
6. **Output contract** (the pipeline's real render-integrity gate,
   `reelAssembly.ts` "#800/#801," not executed this run — verify with
   `ffprobe` once a real file exists): container duration within 0.75s of
   28s, video-stream duration within 0.75s (don't trust container duration
   alone), ≥80% of expected 30fps frame count, ≥3 distinct MD5 hashes among 5
   sampled frames (motion proof — no static/looped-nothing beat).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 28s (within the 15–60s target range, matches the account's
  own 25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed 7:00 AM or 2:00 PM ET cadence
  per `REEL-SLATE-2026-07-31.md` — do not post ad hoc
- **CTA type:** BOOKING (this campaign's own `objective` field) — distinct
  from the mostly SAVE/SEND-oriented CTAs in the rest of this series
- **Caption/hashtags:** see §8

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live
balance check):

| Route | Per-unit cost | 6-beat estimate |
|---|---|---|
| `template_stock` (current prod pin per REEL-PIPELINE.md) | $0/clip, local ffmpeg | **$0** |
| `seedance_clip` | $0.25/clip (labeled ASSUMPTION in source — unverified) | ~$1.50 |
| `veo_second_720p` | $0.10/sec | ~$2.80 (6 clips × ~4.7s avg) |
| Voiceover (`elevenlabs_vo`) | $0.05 | $0.05 |
| Brief compile (`gemini_brief`) | $0.01 | $0.01 |

**Estimated total on the actual prod-pinned route:** ~$0.06 (VO + brief
only). Operator-tunable estimate, not a metered price.

**Daily budget ceiling / account balance:** `UNKNOWN` — neither
`maxGenerationCostPerDayUsd` (latest `autonomy_policy_versions` row) nor
`getHiggsfieldAccountHealth().balanceCredits` was read this run (both are
live reads this session has no path to).

**Guardrail order at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. With
21 packs produced by scheduled runs in roughly the last 22 hours (see the
opening pipeline-health note), if any were actually enqueued for real,
today's feed cap and spacing window are very likely already consumed — this
pack should wait for an open slot rather than assume one is free, and an
operator triaging the backlog should check `content_reservations` before
assuming today has capacity at all.

**Self-estimated quality score against the real 75-point gate**
(`calculateReelQualityScore()`, not invoked live — see `brief.json` for the
per-dimension breakdown): **≈60/75**, below the pipeline's 70/75 auto-pass
floor. Weakest dimensions: `loop` (a countdown format doesn't loop as
cleanly as a mirrored open/close) and `sourcedFact` (general engineering
claims, no live `EvidenceRecord` citations). Flagged, not hidden.

---

## 6 · Audio/music rights status

**No music-rights ledger exists in this repo** — confirmed real gap,
consistent with every prior pack in this series. This pack defaults to **no
licensed music bed**: voiceover (Google TTS / ElevenLabs, both working lanes
with no rights question) plus captions, with an optional single royalty-free
ambient garage/tool-clink SFX layer under the countdown beats. If the
operator wants a music bed, the lowest-friction option remains Meta's own
built-in royalty-free audio library inside the Reels composer (pre-cleared
for that platform) — not selected or verified here, since this session has
no live access to browse it.

---

## 7 · QA matrix

No rendered asset exists yet — every render-time gate is `BLOCKED` pending an
actual render, not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Claim-safety wording (no prices, no guarantees, approved soft language) | `facelessReelStudio.ts` phrase bank | **PASS (manual)** | Every line checked against the approved list — no diagnosis stated as certain, no price/guarantee |
| Brand-voice kill list (`shared/voice.ts`) | linter | **PASS (manual)** | Manually checked, not run through the live linter (no path to it this session) |
| Faceless / standing negative prompt compliance | prompt pack in §4/`brief.json` | **PASS (by design)** | Standing negative prompt on every beat; no faces/hands/human figures in storyboard |
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | **BLOCKED** | Not invoked live; self-estimate (§5, `brief.json`) is ≈60/75 and explicitly not this function's real output |
| Repetition ledger (21-day, live DB) | `getRecentReelSignals()` | **UNKNOWN** | Not queried — no live DB access this session |
| Render-integrity (#800/#801) | `reelAssembly.ts` | **BLOCKED** | No file rendered — nothing to `ffprobe` |
| Rendered QA / vision critic | `renderedQa.ts` | **BLOCKED** | No frames exist to critique |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | **BLOCKED** | Not invoked — must return `proceed` before any real publish |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | **BLOCKED** | Not reached — no asset to approve |

---

## 8 · IG/FB copy — 2 ad-ready variants

Format follows the account's house style (`docs/REEL-SLATE-2026-07-31.md`):
short punchy lines, hashtags capped at 4.

### Variant A — booking-first (primary, matches this campaign's own objective)

> Most road-trip breakdowns start as a ten-minute check somebody skipped.
>
> Tread depth. Pressure — all five tires, including the spare. Belts and
> hoses. Fluid levels. One visit catches all four before you're the one
> pulled over on the shoulder.
>
> Book it before you go, not after the dashboard lights up on the highway.
>
> #roadtrip #cartips #clevelandohio #euclidohio

### Variant B — countdown-hook style (matches the archetype's own device)

> 4 things that end road trips early — and all four take one visit to check:
>
> 4. Tread depth. 3. Pressure, including the spare. 2. Belts and hoses. 1.
> Fluid levels.
>
> Ten minutes now beats a tow truck on the highway.
>
> Stop by before you leave town. 17625 Euclid Ave, Cleveland.
>
> #roadtrip #cartips #clevelandohio #euclidohio

Both variants pass the manual kill-list check in §7. No specific price is
stated in either — consistent with the `FactChannel` gap noted in §3.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (≈60/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor, weakest
on `loop` and `sourcedFact` (§5). Not `PUBLISHED WITH READ-BACK` — no
`reel-canary` call, no `igPostId`, nothing was generated, rendered, or
posted. Not `BLOCKED` outright — the pack is complete and usable: an operator
(or a live-authorized session) can hand it to the real pipeline via
`/api/admin/reel-canary {action:"start", topic:"road trip pre-check"}`, let
the server re-score and re-render for real, and only then move toward
publish.

**Before any real render/publish, an operator needs to:**

1. Decide what to do with the growing backlog (21 open PRs as of this run,
   up from 10 at PR #1624 four hours ago) — merge the best of them (pure
   docs additions, zero app-code risk) or reduce the schedule's firing
   frequency. This pack does not change the schedule itself.
2. Pick a visual-sourcing route (§4) and, if using `template_stock`, confirm
   the free lane's abstract Ken-Burns style still reads for a checklist
   format (it likely reads better here than for the battery pack's dashboard
   world, since this concept is macro-object-focused, not scene-based).
3. Run this concept through the real Studio/critic tooling for a live score,
   or accept the ≈60/75 estimate and punch up the `loop` and `sourcedFact`
   dimensions by hand first.
4. Check `REEL_AUTOPOST_ENABLED` and today's post count/reservation state
   before scheduling manually.
5. Drive it through `POST /api/admin/reel-canary` (`start` → `advance` →
   `qa`) for an actual rendered, QA-gated asset — and only call
   `{action:"publish"}` with a live go-ahead for this specific asset.
