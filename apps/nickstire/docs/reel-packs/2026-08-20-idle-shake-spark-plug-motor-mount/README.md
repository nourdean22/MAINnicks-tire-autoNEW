# Reel production pack — "Shakes at a stoplight: spark plugs vs. motor mount" (2026-08-20)

Scheduled-task run · 2026-08-20 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **IDLESHAKE**

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
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this container — fresh repo checkout, not the running app. `which ffmpeg` also returned nothing, so no local render lane exists either. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` | **Not present** | `env \| grep -Ei "DATABASE_URL\|ADMIN_API_KEY\|REEL_\|HIGGSFIELD\|OPENAI\|ANTHROPIC"` returned no matching credential or config vars in this session's shell. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (verified there 2026-08-11) — the free local-ffmpeg lane, not Higgsfield/Seedance. Last-known, not live-reconfirmed this run. |
| TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is.

**Repetition-ledger context — directory + open-PR check (not the live
`reel_jobs` table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/                                        → 37 merged packs
    search_pull_requests "repo:.../MAINnicks-tire-autoNEW is:pr is:open reel pack in:title"  → 11 open draft PRs

Merged topics on disk (37): penny test, tire expiration date, tread-wear
fingerprint, battery-heat-in-summer, check-engine-light,
squealing-vs-grinding-brakes, wheel-bearing hum, balance-vs-alignment,
cabin-air-filter, coolant-color, exhaust-smoke-color, oil-change-intervals,
plug-vs-patch, pothole-damage, repair-questions, road-salt-brake-lines,
roadtrip-tire-check, serpentine-belt-squeal, sidewall-bulge,
spare-tire-mileage, stop-driving-noises, strut-bounce-test,
summer-heat-tire-pressure, tire-rotation, transmission-fluid-color-test,
tread-depth-rain-vs-snow, why-car-pulls, wiper-blade-check,
ac-not-blowing-cold, allseason-vs-winter-tires, brake-fluid-moisture-test,
cold-weather-tire-light, cv-joint-click, power-steering-whine,
tpms-sensor-battery, uneven-tire-wear-patterns,
wont-start-battery-starter-alternator.

Open draft PRs not yet merged (11): tailpipe condensation vs. coolant leak
(#1726), dashboard warning-light colors (#1725), Ohio E-Check readiness
monitors (#1724), spongy brake pedal (#1723), that smell while driving
(#1722), clunk over bumps / sway bar link (#1721), metallic rattle / heat
shield (#1717), steering wheel shakes when braking / warped rotors (#1708),
engine overheating first 60 seconds (#1712), timing belt no warning light
(#1702), windshield chip repair (#1701).

**Note: the backlog shrank a lot since the 2026-08-19 pack** (that run
reported 52 open PRs; this run finds 11), so the operator appears to be
actively triaging — this run adds one new topic on that improving trend,
rather than piling onto an unreviewed pile.

**"Shakes at a stoplight: spark plugs vs. motor mount" is not among any of
the above.** The closest neighbors are "steering wheel shakes when you
brake" (#1708, a braking-speed rotor-warp vibration, not an idle vibration)
and "clunk over bumps" (#1721, a bump-triggered noise, not a steady idle
shake) — both are a different trigger and a different failure family from
an at-idle/at-a-stoplight shake caused by a misfire or a worn motor mount.
Selected on that basis.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Overlap risk w/ existing 48 topics | Selected? |
|---|---|---|---|---|
| Shakes at a stoplight: spark plugs vs. motor mount | Strong — common, felt-not-just-heard symptom, clean 2-way diagnostic hook | Yes | Low — nearest neighbors (#1708 braking shake, #1721 bump clunk) are different triggers | ✅ **Selected** |
| Rotten-egg exhaust smell — catalytic converter | Moderate — recognizable but single-cause, thinner diagnostic structure | Yes | Medium — "smell while driving" (#1722) and "tailpipe condensation vs. coolant leak" (#1726) are both open and tailpipe/smell-adjacent; risk of thematic crowding | Parked |
| Fuel gauge reads wrong / runs out early (sending unit) | Weak — niche failure, low relatability | Yes | Low | Parked |

"Shakes at a stoplight" was selected for the strongest hook (a felt
physical symptom, not just a sound), a clean two-cause diagnostic structure
that maps onto the account's 5-beat shape, and the lowest overlap risk
against both the merged set and the still-open PRs.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Shake shows up only at idle, fades once you're moving → can point to a spark plug or misfire" | General automotive diagnostic knowledge (idle-only vibration vs. speed-dependent vibration is a standard, widely taught roadside-diagnosis heuristic) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. Phrasing uses "can point to" (approved soft-language pattern, `client/src/lib/facelessReelStudio.ts:580`) rather than an absolute. |
| "Worse in Drive or Reverse than in Park → worth checking the motor mounts" | Same — standard mechanical fact, not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "worth checking" (`facelessReelStudio.ts:582`). |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read); confirmed current shop address/phone: "Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112, (216) 862-0005" | **N/A — deliberately avoided.** No dollar figure appears anywhere in script or captions (checked against `PRICE_CLAIM_PATTERN` in `facelessReelStudio.ts` by hand); only the name/address/phone fact is used, and only in the CTA. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script leans on the name/address/phone
fact only for the shop identity in the CTA, which sidesteps the channel gap
for anything more specific (price, warranty, hours).

---

## 4 · Full production pack

### Script — word-for-word, timed (28s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Your car shakes at a stoplight? The pattern is the clue." |
| 2 · SETUP | 0:04–0:10 | "Only shakes at idle, and fades once you're moving? That can point to a spark plug or a misfire." |
| 3 · VALUE | 0:10–0:16 | "Feel it more in Drive or Reverse than in Park? Worth checking the motor mounts." |
| 4 · VALUE | 0:16–0:22 | "Either way, a small shake now can turn into a rough-running engine later." |
| 5 · CTA | 0:22–0:28 | "Don't guess. Nick's Tire and Auto checks it free. Link in bio." |

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

- Beat 1: "car dashboard steering wheel red light dusk" / "idling car interior dashboard vibration"
- Beat 2: "car engine bay spark plug closeup" / "ignition coil engine bay macro"
- Beat 3: "car engine mount underside closeup" / "engine bay vibration idle macro"
- Beat 4: "coins loose change cup holder car interior" / "car interior dashboard shallow focus"
- Beat 5: "auto repair shop garage bay interior open door"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; the script above is exactly what
gets fed to it, already timed to the 28s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration
above. Style: white bold sans, black outline/shadow, bottom-third safe
zone — burn in via ffmpeg `subtitles` filter, never as a generated in-frame
element (Seedance/Higgsfield can't spell reliably, and the M10 preflight
blocks generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat →
   ambient garage room-tone / subtle idle-engine rumble under beats 1–4
   (optional, see §6) → voiceover track → burned-in caption track →
   end-card CTA text (beat 5 only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each
   beat boundary (no crossfade — matches the render-integrity gate's
   expectation of distinct per-beat frames, not a dissolve-blurred
   transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** cooler, slightly desaturated grade on beats 1–4 (diagnostic
   mood), warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 28s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — beat 4's vibrating loose-change prop and
   the subtle camera drift on every other beat are the motion proof, not a
   still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 28s (within the 15–60s target range and the account's own
  25–30s CTA-block convention, per prior packs)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and see §1's guardrail-order
  note if today's feed slot is already consumed
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone whose car shakes at a
  light"), matching the account's corrected objective (a SAVE-oriented CTA
  measured `saved = 0.00` across the account's first 8 reels, per an
  earlier pack's finding)

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
assigned.** The reel is voiceover + captions + one optional low-level
idle-engine rumble/room-tone under beats 1–4, which also scores well on the
pipeline's muted-first requirement since captions alone carry full meaning.
If the operator wants a music bed, that requires a specific track with
asset ID, source, license scope, territory, and expiry tracked by hand —
this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED`
pending an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (55/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Your car shakes at a stoplight? The pattern is the clue.
>
> Only shakes at idle, fades once you're moving — that can point to a spark
> plug or a misfire. Feel it more in Drive or Reverse than in Park — worth
> checking the motor mounts.
>
> Don't guess. Send this to someone whose car shakes at a light.
>
> #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Car shakes at a red light? Two very different parts can cause
> that — and they don't cost the same."
> Caption: Shake only at idle = spark plug or misfire. Shake worse in gear
> than in Park = motor mount. Guess wrong and you pay for the wrong fix
> first.
> CTA: Not sure which? Call (216) 862-0005 or stop by 17625 Euclid Ave —
> we check it free.

**Ad-ready variant B (question-forward):**

> Hook: "Does your car shake at every stoplight — and you've just gotten
> used to it?"
> Caption: A shake you've learned to ignore is still telling you
> something. It's cheaper to check now than after it gets worse.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (55/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a shop garage bay,
doesn't feed back into the HOOK frame, a dashboard at a stoplight — no loop
plan was designed), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the spark-plug/motor-mount triage
claims, and that store wasn't and couldn't be queried live this run — no DB
access), and **winning concept ≥57/60** (`scoreReelConcept()` was not
invoked, so this dimension is scored 0 rather than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"car shakes at a stoplight: spark plugs vs. motor
mount"}`, let the server re-score and re-render for real, and only then
move toward publish.

This session did not merge, close, or otherwise touch any other PR — the
open-PR review noted in §1 belongs to the operator, not to this scheduled
run.
