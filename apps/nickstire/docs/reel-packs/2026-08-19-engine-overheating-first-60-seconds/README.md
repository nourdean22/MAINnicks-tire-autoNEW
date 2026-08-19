# Reel production pack — "Engine overheating: the first 60 seconds" (2026-08-19)

Scheduled-task run · 2026-08-19 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **OVERHEAT**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**Backlog check, done live this run (not copied from a prior pack's stale
number):** `list_pull_requests(state=open)` against this repo returned
exactly **3 open PRs total**, all three already reel packs (#1701 windshield
chip, #1702 timing belt, #1708 steering-wheel shake/warped rotors), plus one
reel pack merged earlier today (`ffb8c58`, "put approved Reel packs into
rotation," #1699, which folded in `2026-08-19-wont-start-battery-starter-alternator`).
A prior pack in this directory (`2026-08-18-cv-joint-click`) reported a
35-open-PR backlog and recommended a human triage pass before more packs were
generated — that triage has visibly happened since (3 open now, one merged
today). No sprawl flag is warranted this run; this is the 5th topic queued
today (4 distinct, non-duplicate topics ahead of this one), which is a normal
cadence, not a crisis.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | `curl -m 2 http://localhost:3000/api/health` returned no body — no server process in this session's container. This is a fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` credentials | **Not present** | `env \| grep -iE "higgsfield\|admin_api_key\|database_url\|reel_"` returned nothing. Only `apps/nickstire/.env.example` (template, placeholder values) exists in this checkout — no real `.env`. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `apps/nickstire/docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (verified there 2026-08-11) — the free local-ffmpeg lane, not Higgsfield/Seedance/Veo. Last-known, not live-reconfirmed this run. |
| `REEL_GENERATION_ENABLED` / `REEL_PUBLISH_ENABLED` | Not read live | No server process to query; these gate the cron pulse job, not this session. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |

**Repetition-ledger context (`getRecentReelSignals()`):** not queried — that
function reads the live `reel_jobs` table on production TiDB, and a DB read
is itself a production action per the skill's hard rule. Used the file/PR
proxies instead (directional, not a substitute for the real ledger):

- `ls apps/nickstire/docs/reel-packs/` — 37 prior directories (now 38 with
  this one), spanning 2026-08-14 through 2026-08-19: penny test, tire
  expiration, tread fingerprint, battery/summer-heat, check-engine light,
  squealing-vs-grinding brakes, wheel-bearing hum, balance-vs-alignment,
  cabin air filter, coolant color, exhaust smoke color, oil-change
  intervals, plug-vs-patch, pothole damage, repair-authorization questions,
  road-salt brake lines, road-trip tire check, serpentine-belt squeal,
  sidewall bulge, spare-tire mileage, stop-driving noises, strut bounce
  test, summer-heat tire pressure, tire rotation, transmission-fluid color,
  tread-depth rain-vs-snow, why-car-pulls, wiper-blade check,
  ac-not-blowing-cold, allseason-vs-winter tires, brake-fluid moisture test,
  cold-weather tire light, cv-joint click, power-steering whine, tpms
  sensor battery, uneven tire wear, won't-start (battery/starter/
  alternator).
- `mcp__github__list_pull_requests(state=open)` — 3 open PRs, titles listed
  above in the backlog check. None mention overheating, coolant temperature,
  radiator, or steam.

**Engine overheating / steam-emergency-response is not among any of the
above.** The closest existing topic, `coolant-color`, is about interpreting
coolant *color* as a diagnostic once you're already looking at the reservoir
— a maintenance-check framing. This pack is a *safety-emergency-response*
framing (what to do in the first 60 seconds when the gauge climbs or steam
appears while driving) — a distinct intent, distinct hook, distinct footage
needs. It clears the repetition check on both proxies.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already packed? | Selected? |
|---|---|---|---|---|
| Engine overheating — first 60 seconds | Strong — high-stakes, safety-driven, universally relatable (every driver fears this) | Yes | No | ✅ **Selected** |
| Exhaust rattle / heat shield noise | Moderate — narrower symptom | Yes | No | Parked — weaker hook than overheating, saved for a future run |
| Misfire / rough idle | Moderate — diagnosis is genuinely ambiguous without a scan tool, higher claim-safety risk | Yes | No | Parked — harder to keep inside approved soft-language without sounding like a certain diagnosis |
| Any of the 37 already-packed topics | — | — | **Yes** | Excluded outright — would duplicate an existing open or merged pack |

Overheating was selected because it survives the repetition check cleanly,
carries the strongest hook of the open candidates (a scary dashboard moment
every driver recognizes), and is entirely proceduralized around safety
instructions rather than a specific parts diagnosis — the lowest claim-safety
risk of the three candidates considered.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Pull over safely first — overheating can damage an engine in minutes, not miles" | General automotive safety knowledge (continued driving while overheated causes head-gasket/warping damage rapidly) — not shop-specific | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` not queried live this run (would be a prod DB read). No `EvidenceRecord` citation attached. |
| "Do not open the radiator cap — pressurized coolant can burn you" | Same — standard, widely-published automotive safety warning, not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing is an imperative safety instruction rather than a diagnostic claim, which is the lowest-risk category here. |
| "A low coolant level or a puddle under the car can point to a leak" | Same — general mechanical fact | **UNKNOWN against this repo's evidence store.** Uses the approved soft-language pattern "can point to" (`facelessReelStudio.ts` line 580) rather than an absolute. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** Sidesteps the channel gap noted below. |

**Gap, stated plainly (repeated from every prior pack, still unresolved):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
no `"reel"` channel exists. This script doesn't lean on that store for any
priced or warranty fact, so the gap doesn't block this pack. The shop name
used in the CTA ("Nick's Tire and Auto") is the public storefront identity
from `SEED_FACTS.legal.entity` (channel `web` only, not `reel`) — treated as
allowlisted public-facing information per root `AGENTS.md` ("the public shop
phone/address may be allowlisted only deliberately"), not as a cleared reel
fact. No phone number or street address is spoken in the script itself.

---

## 4 · Full production pack

### Script — word-for-word, timed (30s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "Temp gauge climbing? Steam under the hood? Do not keep driving." |
| 2 · SETUP | 0:03–0:09 | "Pull over safely first — overheating can damage an engine in minutes, not miles." |
| 3 · VALUE | 0:09–0:16 | "Turn the engine off and do not open the radiator cap — pressurized coolant can burn you." |
| 4 · VALUE | 0:16–0:24 | "Once it's cool, a low coolant level or a puddle under the car can point to a leak — worth checking before you drive again." |
| 5 · CTA | 0:24–0:30 | "Overheat once, it's a warning. Overheat twice, it can total the engine. Nick's Tire and Auto — link in bio." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per
beat.** Per-beat prompts are in `brief.json`. Standing negative prompt for
every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no API
spend).** Per `REEL-PIPELINE.md`, this is what prod currently renders on.
Search terms for free stock (Pexels/Pixabay/Coverr — search manually; no
specific clip URLs are asserted here since none were verified live this run):

- Beat 1: "car dashboard temperature gauge closeup red zone"
- Beat 2: "car pulled over shoulder hazard lights steam hood"
- Beat 3: "radiator cap engine bay closeup" / "car hood open engine bay"
- Beat 4: "coolant reservoir tank low level" / "antifreeze reservoir closeup"
- Beat 5: "auto repair garage bay interior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; script above is exactly what gets fed
to it, already timed to the 30s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration above.
Style: white bold sans, black outline/shadow, bottom-third safe zone — burn
in via ffmpeg `subtitles` filter, never as a generated in-frame element
(Seedance/Higgsfield can't spell reliably, and M10 preflight blocks generated
text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat → ambient
   road/engine-bay room-tone or SFX (optional, see §6) → voiceover track →
   burned-in caption track → end-card CTA text (beat 5 only, shop name +
   "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each beat
   boundary (no crossfade — matches the render-integrity gate's expectation
   of distinct per-beat frames, not a dissolve-blurred transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** slightly warm/amber tint on beats 1–2 (heat/urgency cue),
   neutral-cool on beats 3–4 (technical/procedural), warm shift on beat 5
   (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 30s, video-stream duration
   also within 0.75s (container duration alone can lie via the audio track),
   ≥80% of expected 30fps frame count, ≥3 distinct MD5s among 5 sampled
   frames — every beat here is a slow camera move/push-in, not a static
   still, satisfying the motion-proof requirement.
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 30s (within the 15–60s target range)
- **Posting slot:** hold to the account's fixed 7:00 AM or 2:00 PM ET cadence
  per `REEL-SLATE-2026-07-31.md` conventions — do not post ad hoc. With only
  3 open reel-pack PRs right now, this pack does not need to queue behind a
  large backlog, but should still go through the normal
  approve-then-schedule flow, not a same-run publish.
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND (not SAVE) — matches the account's SEND-oriented
  objective used in packs since the brakes pack

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
the latest `autonomy_policy_versions` row, not read this run (live DB).
Account balance (`getHiggsfieldAccountHealth().balanceCredits`) is likewise
`UNKNOWN` — not probed.

**Guardrail order to expect at real enqueue time** (from
`apps/nickstire/docs/runbooks/reel-pipeline.md`, not evaluated this run):
preflight → `RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h)
→ `REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. With
5 topics queued today and 3 open PRs, the feed cap will bind well before the
topic-repeat window does — normal, not a warning sign at this volume.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, repeated
from every prior pack, still unresolved). This pack sidesteps it
deliberately rather than asserting a track is cleared: **no music bed is
assigned.** The reel is voiceover + captions + optional single royalty-free
ambient/SFX layer (road/engine-bay room-tone, one soft steam-hiss cue), which
also scores well on the pipeline's muted-first requirement since the
captions alone carry full meaning. If the operator wants a music bed, that
requires a specific track with asset ID, source, license scope, territory,
and expiry tracked by hand — this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED` pending
an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (61/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption:**

> Temp gauge climbing? Steam under the hood? Do not keep driving.
>
> Pull over safely first — overheating can damage an engine in minutes, not
> miles. Turn the engine off, and do not open the radiator cap —
> pressurized coolant can burn you.
>
> Once it's cool, a low coolant level or a puddle under the car can point to
> a leak.
>
> Send this to whoever's dashboard just lit up.
>
> #enginecare #cartips #clevelandohio #carmaintenance

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Gauge in the red? Steam from the hood? Pull over — right now."
> Caption: Overheating for even a few more minutes can warp an engine.
> Shut it off, let it cool, don't touch that radiator cap.
> CTA: Not sure why it's running hot? Bring it by — free look, no pressure.
> Link in bio.

**Ad-ready variant B (question-forward):**

> Hook: "Know what to do the moment your car starts overheating?"
> Caption: Pull over, shut it off, and never open a hot radiator cap.
> Then check for a coolant leak once it's safe.
> CTA: Save this before you need it. Nick's Tire and Auto — link in bio.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (61/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor, mainly on
**loop** (the CTA frame doesn't loop cleanly back into the hook frame) and
**sourced fact** (no `EvidenceRecord` in `evidenceResolver.ts` currently
backs the overheating-safety claims, and that store wasn't queried live this
run). Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the pack
is complete and usable.

**Operator action recommended:** none urgent — the backlog is healthy (3
open PRs, one merged today) unlike the situation two prior packs in this
series flagged. Normal next step is the usual approve/reject pass on the
open PRs (#1701, #1702, #1708, and this one once opened) on whatever cadence
already works, not an emergency triage.
