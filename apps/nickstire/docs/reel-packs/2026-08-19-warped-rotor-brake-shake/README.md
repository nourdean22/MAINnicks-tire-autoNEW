# Reel production pack — "Steering wheel shakes when you brake" (2026-08-19)

Scheduled-task run · 2026-08-19 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword
**ROTORSHAKE**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | `curl -m 3 localhost:3000/api/health` returned nothing — no server process in this session's container. This is a fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` credentials | **Not present** | `env \| grep -iE "higgsfield\|database_url\|reel_"` returned nothing in this shell. |
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

    ls apps/nickstire/docs/reel-packs/                                → 37 merged packs
    gh search_pull_requests "reel pack in:title" is:open (this repo)  → 2 open PRs

Unlike the backlog flagged in the 2026-08-19 "won't start" pack (52 open PRs
at that time), the open-PR count has since dropped to **2**: #1701
("windshield chip repair — before it spreads") and #1702 ("timing belt — no
dashboard warning light"), both opened today. The prior backlog appears to
have been reviewed/merged or closed by the operator between that pack and
this run — good; that means a fresh pack this run is not adding to an
unreviewed pile.

**Topics already covered (37 merged + 2 open, checked against this one):**
penny test, tire expiration, tread-wear fingerprint, battery-heat-in-summer,
check-engine-light, squealing-vs-grinding brakes, wheel-bearing hum,
balance-vs-alignment, cabin air filter, coolant color, exhaust-smoke color,
oil-change intervals, plug-vs-patch, pothole damage, repair-authorization
questions, road-salt brake-line corrosion, road-trip pre-check, serpentine
belt squeal, sidewall bulge, spare-tire mileage, stop-driving noises, strut
bounce-test, summer-heat tire pressure, tire rotation, transmission-fluid
color test, tread-depth rain-vs-snow, why-car-pulls, wiper-blade check, AC
not blowing cold, all-season-vs-winter tires, brake-fluid moisture test,
cold-weather tire light, CV-joint click, power-steering whine, TPMS sensor
battery, uneven tire-wear patterns, won't-start (battery/starter/
alternator), windshield chip repair (open PR), timing belt warning light
(open PR).

**"Steering wheel shakes when you brake" (warped rotor pulsation) is not
among any of the above.** It is adjacent to but distinct from three merged
topics: squealing-vs-grinding brakes (audible symptom, not a physical pulse
you feel), strut bounce-test (suspension bounce, not a braking-specific
vibration), and brake-fluid moisture test (fluid condition, not rotor
geometry). It is also not on `docs/REEL-SLATE-2026-07-31.md`'s 20-item list
(checked — items 2, 8, and 15 are the closest, and are the three just
distinguished above). Selected as a genuinely new, non-duplicate topic.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Steering wheel shakes when you brake (warped rotors) | Strong — physical, felt-not-just-heard symptom; common comeback-repair confusion (new pads on warped rotors still shakes) | Yes | No | ✅ **Selected** |
| Car overheating / temp gauge in the red | Strong — visceral, high-stakes | Yes | Not on disk/PR list, but deprioritized this run in favor of the brake-shake angle to keep this run's topic distinct from the "won't start" pack's under-the-hood-warning theme | Parked |
| Fuel cap check-engine light (loose gas cap) | Weak — one-note, low visual variety across 5 beats | Yes | Overlaps thematically with check-engine-light (merged) | Rejected — too close to an existing pack |

"Steering wheel shakes when you brake" was selected for a felt-not-heard
physical symptom (distinct sensory hook from the account's existing
noise-based brake pack), a clean myth-correction structure ("new pads alone
won't fix it" — a genuine comeback-repair trap that gives the CTA real
stakes), and confirmed non-overlap with all 39 existing/in-flight topics.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A pulse in the pedal or wheel when braking can point to a warped rotor" | General automotive diagnostic knowledge (rotor-runout-causing-pedal-pulsation is a standard, widely taught mechanical fact, not shop-specific) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run — would be a prod DB read, and no `DATABASE_URL` is present in this session. No `EvidenceRecord` citation is attached. Phrasing uses "can point to" (approved soft-language pattern, `client/src/lib/facelessReelStudio.ts:580`) rather than an absolute. |
| "New pads on a warped rotor can bring the shake right back" | Same — standard mechanical fact | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing avoids "you need" / "definitely" per the banned-pattern list at `facelessReelStudio.ts:552-561`. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, which sidesteps the channel gap noted below. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack.

---

## 4 · Full production pack

### Script — word-for-word, timed (27s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Steering wheel shaking when you brake? That's not you being nervous." |
| 2 · SETUP | 0:04–0:10 | "A pulse through the pedal or the wheel can point to a warped rotor — not worn pads." |
| 3 · VALUE | 0:10–0:16 | "Keep driving on it, and that pulse wears the new pads unevenly too." |
| 4 · VALUE | 0:16–0:22 | "New pads on a warped rotor? The shake can come right back." |
| 5 · CTA | 0:22–0:27 | "Worth checking before your next stop. Nick's Tire and Auto checks rotor thickness free. Link in bio." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes, self-estimated score): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per
beat.** Per-beat prompts are in `brief.json`. Standing negative prompt —
read directly from the current generator code
(`client/src/lib/facelessReelStudio.ts:1284`), which differs from the
shorter placeholder string in this skill's own doc — code wins per the
source-of-truth hierarchy:

> `human face, person, hands, gloves, arms, talking head, low-res, blurry, extra fingers, plastic glow, oversaturated AI look, warped engine parts, [lens-specific avoid terms]`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no
API spend).** Per `docs/operations/REEL-PIPELINE.md`, this is what prod
currently renders on. Search terms for free stock (Pexels/Pixabay/Coverr —
search manually; no specific clip URLs are asserted here since none were
verified live this run):

- Beat 1: "steering wheel closeup vibrating hands-free" / "dashboard speedometer city driving"
- Beat 2: "car brake disc rotor closeup macro" / "brake caliper wheel closeup garage"
- Beat 3: "brake pedal closeup foot pressing" / "worn brake pad macro closeup"
- Beat 4: "mechanic hand tool brake rotor inspection macro" (object/tool-only framing, no visible face per faceless rule)
- Beat 5: "auto repair shop garage bay interior open door"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; the script above is exactly what
gets fed to it, already timed to the 27s budget.

### Captions

[`captions.srt`](./captions.srt) — 9 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration
above. Style: white bold sans, black outline/shadow, bottom-third safe
zone — burn in via ffmpeg `subtitles` filter, never as a generated in-frame
element (Seedance/Higgsfield can't spell reliably, and the M10 preflight
blocks generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat →
   ambient road/garage room-tone (optional, see §6) → voiceover track →
   burned-in caption track → end-card CTA text (beat 5 only, shop name +
   "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each
   beat boundary (no crossfade — matches the render-integrity gate's
   expectation of distinct per-beat frames, not a dissolve-blurred
   transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** cooler, slightly desaturated grade on beats 1–4 (diagnostic
   tension), warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 27s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow camera move or
   subtle vibration, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 27s (within the 15–60s target range and the account's own
  25–30s CTA-block convention, per prior packs)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and check the day's feed-post
  cap/spacing before assuming an open slot (§5)
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone who's felt this"),
  matching the account's corrected objective (a SAVE-oriented CTA measured
  `saved = 0.00` across the account's first 8 reels, per the brakes pack's
  finding)

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts:28-36` `COST_ESTIMATES_USD` (code-read, not a live
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

**Daily budget ceiling:** `docs/runbooks/reel-pipeline.md:179` cites
`limits.maxGenerationCostPerDayUsd` default **$10**, but the *live* value in
the latest `autonomy_policy_versions` row is `UNKNOWN` this run (no
`DATABASE_URL`, no live server). Account balance
(`getHiggsfieldAccountHealth().balanceCredits`) is likewise `UNKNOWN`.

**Guardrail order to expect at real enqueue time**
(`docs/runbooks/reel-pipeline.md:175-179`, not evaluated this run):
preflight → `RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING`
(3h) → `REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`
($10/day default). If today's feed cap or spacing window is already
consumed by the daily autonomous cron (`dailyReelPost.ts`, if
`REEL_AUTOPOST_ENABLED=true`), this pack should wait for the next open slot
rather than force a same-day post.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, same one
noted in every prior pack — not a new finding). This pack sidesteps it
deliberately rather than asserting a track is cleared: **no music bed is
assigned.** The reel is voiceover + captions + optional ambient road/garage
room-tone, which also scores well on the pipeline's muted-first requirement
since captions alone carry full meaning. If the operator wants a music bed,
that requires a specific track with asset ID, source, license scope,
territory, and expiry tracked by hand — this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED`
pending an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (54/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Steering wheel shaking when you brake? That's not you being nervous.
>
> A pulse through the pedal or the wheel can point to a warped rotor — not
> worn pads. Keep driving on it and that pulse wears the new pads unevenly
> too. New pads on a warped rotor? The shake can come right back.
>
> Worth checking before your next stop. Send this to someone who's felt
> this.
>
> #brakes #cartips #clevelandohio #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Wheel shaking when you brake? Pads aren't the whole story."
> Caption: A pulse in the pedal or wheel can point to a warped rotor. New
> pads alone won't fix it — and the shake wears them unevenly right back.
> CTA: Not sure which? Call (216) 862-0005 or stop by 17625 Euclid Ave —
> we check rotor thickness free.

**Ad-ready variant B (question-forward):**

> Hook: "Ever had new brake pads and the shake came right back?"
> Caption: If nobody checked the rotors, that's why. Pads and rotors are a
> pair, not a swap-one-and-done job.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (54/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a shop garage bay,
doesn't feed back into the HOOK frame, a driver's hands on a moving
steering wheel — no loop plan was designed), **sourced fact** (no
`EvidenceRecord` in `evidenceResolver.ts` currently backs the
rotor-pulsation claims, and that store wasn't and couldn't be queried live
this run — no DB access), and **winning concept ≥57/60**
(`scoreReelConcept()` was not invoked, so this dimension is scored 0 rather
than assumed passing).

Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"steering wheel shakes when you brake: warped rotor
vs worn pads"}`, let the server re-score and re-render for real, and only
then move toward publish.

**Backlog note, updated from the prior pack:** the open-PR count for
"reel pack" titles dropped from 52 (as of the "won't start" pack, earlier
today) to 2 by the time this run checked — evidence the operator has been
actively reviewing/merging the backlog. This pack adds a third open PR on a
confirmed non-duplicate topic; it does not reopen the backlog concern. If
future runs find the open-PR count climbing again without merges, that is
the signal to re-flag it rather than keep producing packs into a pile.
