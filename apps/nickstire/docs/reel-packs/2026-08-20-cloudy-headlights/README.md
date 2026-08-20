# Reel production pack — "Cloudy headlights: not just looks" (2026-08-20)

Scheduled-task run · 2026-08-20 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **HEADLIGHTGLOW**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**Backlog note (read before triaging this PR):** the previous pack
(2026-08-19, "won't start") flagged 52 open reel-pack PRs and 10 consecutive
runs unable to justify a new topic. This run's own check (§1) found only
**12 open PRs** — the backlog has been substantially triaged since then.
This pack adds one confirmed-new topic; it does not re-raise the earlier
"pause the trigger" concern, but the operator should keep an eye on whether
the queue starts growing again.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | `curl -m 2 http://localhost:3000/api/health` returned nothing (curl exit 7, connection refused) — no server process in this session's container. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` credentials | **Not present** | `env \| grep -iE "higgsfield\|admin_api_key\|database_url\|reel_"` returned nothing. Only `apps/nickstire/.env.example` (template, placeholder values) exists in this checkout — no real `.env`. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md:32` states prod is pinned to **`template_stock`** (verified there 2026-08-11) — the free local-ffmpeg lane, not Higgsfield/Seedance/Veo. Last-known, not live-reconfirmed this run. |
| `REEL_GENERATION_ENABLED` | Not read live | No server process to query; gate lives on the cron pulse job. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is.

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/                                  → 25 merged pack directories
    gh-equivalent: search_pull_requests "reel pack in:title" is:open    → 12 open draft PRs

Merged packs on disk (25, spanning 2026-08-14 to 2026-08-19): penny test,
tire expiration date, tread-wear fingerprint, battery-summer-heat,
check-engine-light, squealing-vs-grinding-brakes, wheel-bearing hum,
balance-vs-alignment, cabin-air-filter, coolant color, exhaust-smoke color,
oil-change intervals, plug-vs-patch, pothole damage, repair-authorization
questions, road-salt brake lines, road-trip tire check, serpentine-belt
squeal, sidewall bulge, spare-tire mileage, stop-driving-now noises, strut
bounce-test, summer-heat tire pressure, tire rotation, transmission-fluid
color test, tread-depth rain-vs-snow, why-car-pulls, wiper-blade check,
AC-not-blowing-cold, all-season-vs-winter tires, brake-fluid moisture test,
cold-weather tire light, CV-joint click, power-steering whine, TPMS sensor
battery, uneven-tire-wear patterns, won't-start (battery/starter/alternator).

Open draft PRs (12, all 2026-08-19/20): tailpipe condensation vs. coolant
leak, engine overheating (first 60 seconds), metallic rattle on
acceleration (heat shield), timing belt with no dashboard warning light,
windshield chip repair-before-it-spreads, dashboard warning-light colors
(red vs. amber), Ohio E-Check readiness monitors, steering wheel shakes
when braking (warped rotors), shakes at a stoplight (spark plugs vs. motor
mount), spongy brake pedal, that smell while driving (coolant/rubber/
electrical), clunk over bumps (sway bar link vs. ball joint).

**"Cloudy / yellowed headlights" is not among any of the above.** It is
adjacent to the wiper-blade-check pack (both are pre-drive visual-safety
checks) and to the dashboard-warning-light-colors pack (both are
visibility/dashboard-adjacent), but is a distinct failure mode — a physical
lens-material defect, not a bulb, wiper, or dashboard-indicator issue — and
was not found in either search. Selected on that basis.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Cloudy / yellowed headlights — visibility, not cosmetics | Strong — visual, relatable, most drivers have seen this on their own or a friend's car | Yes | No | ✅ **Selected** |
| Headlight bulb color temperature (blue-white vs. yellow OEM) | Moderate — more of a preference/upgrade topic than a safety-diagnostic one | Yes | No, but weaker fit for the account's "diagnose a problem" format | Parked |
| Muffler/exhaust getting louder over time | Moderate — overlaps thematically with the open "smell while driving" and "metallic rattle" PRs even though the specific symptom differs | Yes | Not found in title list, but close enough to two open PRs to risk audience fatigue this run | Parked |

"Cloudy headlights" was selected for confirmed non-overlap with all 37
existing topics (merged + open), a clean single-cause diagnostic hook that
fits the account's 5-beat shape without inventing structure, and strong
visual/B-roll potential (macro lens texture, beam comparison) that doesn't
require any price or warranty claim to land.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "That yellow haze can cut headlight output by more than half at night" | General automotive-safety knowledge (oxidized polycarbonate lens light-transmission loss is a widely documented phenomenon, not shop-specific) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. |
| "It's UV damage to the lens coating, not the bulb" | Same — standard material-science fact about polycarbonate clearcoat, not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning as above. |
| "A wipe won't fix it" | Same | **UNKNOWN against this repo's evidence store.** Phrased as a plain statement rather than a shop-specific service claim — no price or outcome guarantee attached. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** CTA says "can take a look," not "we offer headlight restoration for $X," which sidesteps the channel gap below. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack, but it would block any future reel script that
wants to quote a price or service-guarantee line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (29s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Your headlights look cloudy? That's not just looks." |
| 2 · SETUP | 0:04–0:10 | "That yellow haze can cut headlight output by more than half at night." |
| 3 · VALUE | 0:10–0:17 | "It's UV damage to the lens coating, not the bulb, and a wipe won't fix it." |
| 4 · VALUE | 0:17–0:23 | "It changes how fast you spot the road, and how fast other drivers spot you." |
| 5 · CTA | 0:23–0:29 | "Don't drive half-blind. Nick's Tire and Auto can take a look. Send this to someone whose headlights look foggy." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes, self-estimated score): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per
beat.** Per-beat prompts are in `brief.json`. Standing negative prompt for
every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no
API spend).** Per `docs/operations/REEL-PIPELINE.md`, this is what prod
currently renders on. Search terms for free stock (Pexels/Pixabay/Coverr —
search manually; no specific clip URLs are asserted here since none were
verified live this run):

- Beat 1: "cloudy yellow headlight lens closeup" / "car headlight dusk parked driveway"
- Beat 2: "car headlight beam night road" / "dim headlight beam comparison"
- Beat 3: "oxidized plastic headlight texture macro" / "headlight restoration before"
- Beat 4: "night driving windshield POV road" / "dark road headlights ahead"
- Beat 5: "auto repair shop garage bay interior open door"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; the script above is exactly what
gets fed to it, already timed to the 29s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration
above. Style: white bold sans, black outline/shadow, bottom-third safe
zone — burn in via ffmpeg `subtitles` filter, never as a generated in-frame
element (Seedance/Higgsfield can't spell reliably, and the M10 preflight
blocks generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat →
   optional soft "whoosh" SFX on the beat 2 beam-comparison cut → voiceover
   track → burned-in caption track → end-card CTA text (beat 5 only, shop
   name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each
   beat boundary (no crossfade — matches the render-integrity gate's
   expectation of distinct per-beat frames, not a dissolve-blurred
   transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** slightly desaturated, cool-neutral grade on beats 1–4
   (diagnostic mood, night/dusk lighting already does most of the work),
   warm shift on beat 5 (CTA, inviting shop-interior light).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 29s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow camera move,
   never a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 29s (within the 15–60s target range and the account's own
  ~25–30s CTA-block convention, per prior packs)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and check whether today's feed
  slot is already consumed by the daily autonomous cron before scheduling
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone whose headlights look
  foggy"), matching the account's corrected objective (a SAVE-oriented CTA
  measured `saved = 0.00` across the account's first 8 reels, per an earlier
  pack's finding)

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live
balance check):

| Route | Per-unit cost | 5-beat estimate |
|---|---|---|
| `template_stock` (**current prod pin** per REEL-PIPELINE.md) | $0/clip, local ffmpeg | **$0** |
| `seedance_clip` | $0.25/clip (labeled ASSUMPTION in source — unverified) | ~$1.25 |
| `veo_second_720p` | $0.10/sec | ~$3.00 (5 clips × ~6s avg) |
| Voiceover (`elevenlabs_vo`) | $0.05 | $0.05 |
| Brief compile (`gemini_brief`) | $0.01 | $0.01 |

**Estimated total for this pack on the actual prod-pinned route:** ~$0.06
(VO + brief only; clips are free on `template_stock`). Operator-tunable
estimate, not a metered price — directional only.

**Daily budget ceiling:** `UNKNOWN` — `maxGenerationCostPerDayUsd` lives in
the latest `autonomy_policy_versions` row, not reachable this run (no
`DATABASE_URL`, no live server). Account balance
(`getHiggsfieldAccountHealth().balanceCredits`) is likewise `UNKNOWN`.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. If
today's feed cap or spacing window is already consumed by the daily
autonomous cron (`dailyReelPost.ts`, if `REEL_AUTOPOST_ENABLED=true`), this
pack should wait for the next open slot rather than force a same-day post.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, same one
noted in every prior pack — not a new finding). This pack sidesteps it
deliberately rather than asserting a track is cleared: **no music bed is
assigned.** The reel is voiceover + captions + one optional royalty-free
"whoosh" SFX on the beat 2 beam-comparison cut, which also scores well on
the pipeline's muted-first requirement since captions alone carry full
meaning. If the operator wants a music bed, that requires a specific track
with asset ID, source, license scope, territory, and expiry tracked by
hand — this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED`
pending an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (51/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Your headlights look cloudy? That's not just looks.
>
> That yellow haze can cut headlight output by more than half at night.
> It's UV damage to the lens coating — not the bulb, and a wipe won't fix
> it. It changes how fast you spot the road, and how fast other drivers
> spot you.
>
> Don't drive half-blind. Send this to someone whose headlights look foggy.
>
> #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Cloudy headlights aren't just ugly — they can cut your night
> visibility in half."
> Caption: Yellow haze on your lens is UV damage, not a dirty bulb. No
> amount of wiping fixes it.
> CTA: Not sure if yours can be saved? Call (216) 862-0005 or stop by
> 17625 Euclid Ave — we'll take a look.

**Ad-ready variant B (question-forward):**

> Hook: "When's the last time you actually looked at your headlights — not
> through them, AT them?"
> Caption: That foggy yellow tint is cutting how far your lights reach at
> night, and how far other drivers see you.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (51/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a shop garage bay,
doesn't feed back into the HOOK frame, a headlight lens closeup — no loop
plan was designed), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the lens-oxidation/light-loss claims,
and that store wasn't and couldn't be queried live this run — no DB
access), and **winning concept ≥57/60** (`scoreReelConcept()` was not
invoked, so this dimension is scored 0 rather than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"cloudy headlights: visibility not just cosmetics"}`,
let the server re-score and re-render for real, and only then move toward
publish.

**Backlog status (see the note at the top of this file):** the open
reel-pack PR count dropped from 52 (as of the 2026-08-19 pack) to 12 as of
this run — meaningful triage has happened since the last flag. This session
did not merge, close, or otherwise touch any other PR; that remains outside
this run's assigned scope. No renewed "pause the trigger" recommendation
this run, but worth a periodic recheck if the queue starts climbing again.
