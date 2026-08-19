# Reel production pack — "Summer heat is lying to your tire light" (2026-08-17)

Scheduled-task run · 2026-08-17 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **PRESSURE**
· source: `server/services/shadowPlanner.ts` `SHADOW_CAMPAIGNS` entry `summer_pressure`
(code-committed, not a live DB read — see §2)

**No generation, DB read, or publish call was made against production this run.**
This is a scheduled/automated firing with no live operator present — the operator
skill's hard rule is explicit that a stored scheduled prompt does not authorize
`reel-canary` generation or publish calls, and that repetition-ledger/quality-score
reads against the live database are themselves a production read, not a free
action. This session made none of those calls. See §1 and §9.

**⚠️ Pipeline-health finding from this run, surfaced up front:** before writing
this pack, this run checked (per the skill's required pre-write step)
`apps/nickstire/docs/reel-packs/` (5 merged packs) **and** open PRs matching
"reel pack" in title — **10 open, unmerged, still-draft PRs** (#1614–#1623),
created roughly hourly between 2026-08-16 22:38 UTC and 2026-08-17 07:46 UTC,
none merged, all producing a pack nobody has reviewed yet. That is a real
operational problem independent of topic duplication (none of those 10
overlapped this pack's topic, so this run proceeded) — see the closing note
below the receipt for what it means and what a human may want to do about it.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops short
of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`) and
short of any live read against the production TiDB database.

**Capabilities — not probed this run, stated as such rather than assumed:**

| Capability | Status this run | Why |
|---|---|---|
| `getHiggsfieldAccountHealth()` (creds/balance) | Not called | Requires a live server process + `HIGGSFIELD_API_KEY`; this is a Claude Code repo session, not the running app. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (last documented), i.e. the free local-ffmpeg lane, not Higgsfield/Seedance. Treat as last-known, not live-confirmed. |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | Not read live | Gate on the cron pulse job; not queried this run. If `REEL_AUTOPOST_ENABLED=true`, the daily cron may already have posted or reserved today's slot independent of this pack. |
| Voiceover TTS (`reelVoice.ts` → Google Neural2 / ElevenLabs) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | Blocked by the hard rule above for a scheduled firing. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |

**Repetition context (`getRecentReelSignals()`):** not queried — that function
reads the live `reel_jobs` table on production TiDB. Instead, checked the
file-based + PR-based record of prior runs (both required by the skill, since
the directory alone only shows merged work):

- `ls apps/nickstire/docs/reel-packs/` → 5 merged packs: penny test, tire
  expiration, tread fingerprint, battery/summer-heat (battery-specific, not
  tire-pressure), squealing-vs-grinding brakes.
- Open PRs titled "reel pack": coolant color, spare-tire mileage, balance vs.
  alignment, check-engine-light, wheel-bearing-hum, repair-authorization
  questions, cabin-vs-engine-air-filter, "noises that mean stop driving now",
  oil-change intervals, why-car-pulls (10 total, #1614–#1623).

None of those 15 known packs/PRs cover tire pressure or heat-swing PSI
behavior. This is a file/PR-system check, not a substitute for the real
ledger — an actual `reel_jobs` row that never produced a written pack would
not show up here, so treat "not found" as directional, not a guarantee of
zero repetition.

---

## 2 · Candidate scores and selection

Rather than pull from `REEL-SLATE-2026-07-31.md` (whose remaining unpacked
items are either already claimed by an open PR or seasonally off — e.g. item
#3 "cold weather and the tire light" and item #11 "all-season vs. winter
tires" are winter-scoped, item #10 "pothole damage" is scoped to
`shadowPlanner.ts`'s `pothole_thaw` entry at `months: [1,2,3,4]`, i.e. also
off-season in August), this run scored the code-committed seasonal campaign
calendar in `shadowPlanner.ts` `SHADOW_CAMPAIGNS` for entries active in the
current month (8 = August) and not yet covered:

| Campaign id | Keyword | Months | Urgency | Covered already? | Selected? |
|---|---|---|---|---|---|
| `summer_pressure` | PRESSURE | 6,7,8 | 9 | No | ✅ **Selected** |
| `roadtrip_check` | TIRES | 5,6,7,8 | 10 | No (close to "penny test"/tread topics but distinct angle — trip-readiness, not tread depth) | Parked |
| `echeck_deadline` | ECHECK | year-round | 7 | Yes — "check-engine-light" PR #1615 is adjacent but not identical; parked to avoid overlap | Parked |
| `vibration_highway` | VIBRATION | year-round | 6 | No, but overlaps heavily with open "why-car-pulls" PR #1622 and merged "balance vs. alignment" territory | Parked |
| `tpms_light` | TPMS | year-round | 8 | Partially — this pack's topic is adjacent (pressure/TPMS) but takes the heat-swing angle specifically, not the "ignored light" angle from slate #3 | Selected topic subsumes the useful, non-duplicate slice of this |

`summer_pressure` was selected: highest urgency among topics with an August
window and zero coverage in either the merged-pack directory or the 10 open
PRs, with a genuinely counter-intuitive hook (most drivers assume heat only
*adds* air, not that a hot-checked reading hides a cold-morning underinflation).

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Air expands with heat — about 1 PSI for every 10 degrees" | `docs/REEL-SLATE-2026-07-31.md` item #3 (brand-voice-lint-approved, already-published-caption copy): *"Every 10 degrees the temperature drops takes about 1 PSI out of every tire."* Same physical ratio, reversed direction (rising vs. falling temperature) — this is the same standard thermal-expansion relationship, not a new or unverified number. | **Corroborated by repo source, not `UNKNOWN`.** Not a live `EvidenceRecord` from `evidenceResolver.ts` (not queried — prod DB read), but a code-committed, already-approved reel caption using the identical ratio is the strongest evidence this run can produce without a live query. |
| "Underinflated on a hot highway is exactly when a tire is most likely to overheat" | General tire-engineering fact (underinflation → increased flex → heat buildup; well-established, not shop-specific) | **UNKNOWN against this repo's evidence store** — no `EvidenceRecord` citation attached. Phrased with "most likely to," not an absolute, per the approved soft-language pattern (`facelessReelStudio.ts`). |
| No price, warranty, or shop-specific policy claim is made anywhere in this script | `businessFacts.ts` `SEED_FACTS` grepped for a pressure-check fact (read-only, code file, not a live DB read) — none found | **N/A — deliberately avoided.** No pressure-specific business fact exists in this store to cite even if the reel channel gap (below) didn't already block it. |

**Gap, stated plainly (same as every prior pack in this series):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
no `"reel"` channel exists yet. This script doesn't lean on that store, so the
gap doesn't block this pack, but it would block any future reel script that
wants to quote a price or warranty line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (28s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "That tire light in August might be heat, not a warning." |
| 2 · SETUP | 0:03–0:09 | "Air expands with heat — about 1 PSI for every 10 degrees. Drive on hot asphalt and your reading climbs." |
| 3 · VALUE | 0:09–0:16 | "Check it hot midday and it looks fine. Check it again cold the next morning, and it can read several PSI low." |
| 4 · VALUE | 0:16–0:22 | "Underinflated on a hot highway is exactly when a tire is most likely to overheat." |
| 5 · CTA | 0:22–0:28 | "Check pressure cold, before you drive. Or stop by and we'll take a look. Nick's Tire and Auto — link in bio." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per
beat.** Per-beat prompts are in `brief.json`. Standing negative prompt for
every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no API
spend).** Per `docs/operations/REEL-PIPELINE.md`, this is what prod currently
renders on. Search terms for free stock (Pexels/Pixabay/Coverr — search
manually; no specific clip URLs are asserted here since none were verified
live this run):

- Beat 1: "car dashboard tire pressure warning light"
- Beat 2: "tire pressure gauge closeup" / "checking tire pressure sunny day"
- Beat 3: "tire valve stem macro" / "tire pressure gauge morning"
- Beat 4: "tire sidewall driving closeup" / "wheel well highway driving"
- Beat 5: "auto repair garage bay interior daylight"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; script above is exactly what gets fed
to it, already timed to the 28s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration above.
Style: white bold sans, black outline/shadow, bottom-third safe zone — burn
in via ffmpeg `subtitles` filter, never as a generated in-frame element
(Seedance/Higgsfield can't spell reliably, and M10 preflight blocks generated
text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat → ambient
   room-tone/SFX (optional, see §6) → voiceover track → burned-in caption
   track → end-card CTA text (beat 5 only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each beat
   boundary (no crossfade — matches the render-integrity gate's expectation
   of distinct per-beat frames, not a dissolve-blurred transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** warm, high-key summer daylight grade throughout (this is a
   daytime-heat story, unlike the cooler garage-mood packs before it);
   slightly desaturate only the beat-3 "next morning" half-shot to sell the
   time-of-day contrast.
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 28s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no static/looped
   single image — every beat here is a slow camera move or lighting
   transition, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 28s (within the 15–60s target range and the account's own
  25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed 7:00 AM or 2:00 PM ET cadence
  per `REEL-SLATE-2026-07-31.md` — do not post ad hoc
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND / SHOP-VISIT (not SAVE) — per the slate's corrected
  objective; a "save this" CTA measured `saved = 0.00` across the account's
  first 8 reels

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live
balance check):

| Route | Per-unit cost | 5-beat estimate |
|---|---|---|
| `template_stock` (**current prod pin** per REEL-PIPELINE.md) | $0/clip, local ffmpeg | **$0** |
| `seedance_clip` | $0.25/clip (labeled ASSUMPTION in source — unverified) | ~$1.25 |
| `veo_second_720p` | $0.10/sec | ~$2.80 (5 clips × ~5.6s avg) |
| Voiceover (`elevenlabs_vo`) | $0.05 | $0.05 |
| Brief compile (`gemini_brief`) | $0.01 | $0.01 |

**Estimated total for this pack on the actual prod-pinned route:** ~$0.06
(VO + brief only; clips are free on `template_stock`). This is an
operator-tunable estimate, not a metered price — treat as directional.

**Daily budget ceiling:** `UNKNOWN` — `maxGenerationCostPerDayUsd` lives in
the latest `autonomy_policy_versions` row, which was not read this run (live
DB). Account balance (`getHiggsfieldAccountHealth().balanceCredits`) is
likewise `UNKNOWN` — not probed.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. Given
10 packs were produced by scheduled runs in roughly the last 9 hours alone
(see the pipeline-health note above), if any of them were actually enqueued
for real, today's feed cap and spacing window are very likely already
consumed — this pack should wait for the next open slot rather than assume
one is free.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, consistent
with every prior pack in this series). This pack sidesteps it deliberately
rather than asserting a track is cleared: **no music bed is assigned.** The
reel is voiceover + captions + optional single royalty-free ambient/SFX layer
(light traffic / garage room tone), which also scores well on the pipeline's
muted-first requirement since the captions alone carry full meaning. If the
operator wants a music bed, that requires a specific track with asset ID,
source, license scope, territory, and expiry tracked by hand — this pack does
not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED` pending
an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (62/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (matches slate's corrected SEND-oriented objective):**

> That tire light in August might be heat, not a warning.
>
> Air expands with heat — about 1 PSI for every 10 degrees. Drive on hot
> asphalt and your reading climbs.
>
> Check it hot midday and it looks fine. Check it again cold the next
> morning, and it can read several PSI low.
>
> Underinflated on a hot highway is exactly when a tire is most likely to
> overheat.
>
> Check pressure cold, before you drive.
>
> #tirepressure #summerdriving #clevelandohio #cartips

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Your tire light isn't wrong. Your timing is."
> Caption: Heat adds air. A hot reading looks fine and hides a cold-morning
> underinflation — right when a tire is most likely to overheat on the
> highway.
> CTA: Check it cold, before you drive. Not sure what "cold" means for your
> tires? Stop by — free check, no pressure. (216) 862-0005.

**Ad-ready variant B (question-forward):**

> Hook: "When did you last check your tire pressure — hot or cold?"
> Caption: Those two readings can differ by several PSI in August heat
> swings. Checking hot hides the number that actually matters.
> CTA: Not sure? Bring it by, 17625 Euclid Ave — we'll check it for you,
> free.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (62/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on two
dimensions specifically — **loop** (the CTA frame doesn't loop cleanly back
into the hook frame) and **sourced fact** (the core PSI/temperature ratio is
corroborated by an already-approved slate caption, but no live
`EvidenceRecord` in `evidenceResolver.ts` backs it, and that store wasn't
queried live this run). Not `PUBLISHED WITH READ-BACK` — no `reel-canary`
call, no `igPostId`, nothing was generated, rendered, or posted. Not
`BLOCKED` outright — the pack is complete and usable; an operator (or a
live-authorized session) can hand it to the real pipeline via
`/api/admin/reel-canary {action:"start", topic:"summer heat tire pressure"}`,
let the server re-score and re-render for real, and only then move toward
publish.

---

## Pipeline-health note (not part of the 9-point receipt, flagged separately)

This run found **10 open, unmerged draft PRs** (#1614–#1623) produced by this
same scheduled task over roughly the prior 9 hours, plus 5 already-merged
packs — **15 packs in under 3 days**, none yet fed into a real
`/api/admin/reel-canary` run per any of their own receipts. Every individual
run correctly avoided topic duplication (that is what the skill's
directory-plus-open-PR check is for, and it worked here). But the volume
itself looks like a scheduling-cadence problem, not a content problem: at
roughly one pack per hour with zero packs being merged or advanced into
real production, this queue will keep growing indefinitely with no pack ever
reaching an actual rendered, QA'd, published reel. Two independent things an
operator may want to look at, separate from this pack's own content:

1. **Cadence vs. throughput** — the account's own posting cadence is 2
   reels/day (`REEL-SLATE-2026-07-31.md`). Producing packs roughly hourly
   guarantees a backlog no manual review process can keep up with.
2. **Merge or prune the open queue** — 10 open draft PRs sitting unreviewed
   is itself a signal worth acting on: either merge the best of them (they
   are strictly documentation/pack additions, zero app-code risk) and let
   the backlog drain, or pause/reduce the schedule's firing frequency.

This session did not change the schedule or touch any other open PR — that
decision belongs to the operator, and is being surfaced via notification
alongside this receipt.
