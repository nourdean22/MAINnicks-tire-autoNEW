# Reel production pack — "That rattle isn't your engine" (heat shield) (2026-08-19)

Scheduled-task run · 2026-08-19 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **RATTLE**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present.
The operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | This is a Claude Code session working in a fresh repo checkout, not the running app — no server process, no way to call this function live. |
| Higgsfield / TTS / render CLI in this session | **Not available** | `which ffmpeg`, `which hf`, `which capcut` all returned nothing in this session's shell. No TTS tool, no Meta/Instagram posting tool is connected to this session (checked the full connected/deferred tool list — none present). |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md:32` states prod is pinned to **`template_stock`** (verified there 2026-08-11) — the free local-ffmpeg lane, not Higgsfield/Seedance. Last-known, not live-reconfirmed this run. |
| `REEL_GENERATION_ENABLED` / `HIGGSFIELD_CREDENTIALS_JSON` / `DATABASE_URL` | Not read live | No server process to query in this checkout; no credentials or prod DB URL are present in this session's shell. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server reachable, and blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| Adobe-for-creativity MCP (video_render, animate_design, media_enhance_speech, etc.) | **Connected but deliberately not used** | These are real generation tools available to this session, but invoking them would be an unauthorized real generation/spend action from an unattended run — the same hard rule that blocks `reel-canary` applies here, not just to this repo's own pipeline. |

**Conclusion: this run has zero authorized motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is.

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/            → 36 merged packs
    list_pull_requests(state=open)                → 5 open PRs total, 4 are reel packs

Merged packs on disk (36): penny test, tire expiration, tread-wear
fingerprint, battery-summer-heat, check-engine-light,
squealing-vs-grinding-brakes, wheel-bearing-hum, balance-vs-alignment,
cabin-air-filter, coolant color, exhaust-smoke color, oil-change intervals,
plug-vs-patch, pothole damage, repair-authorization questions,
road-salt-brake-lines, roadtrip tire check, serpentine-belt squeal,
sidewall bulge, spare-tire mileage, stop-driving-noises, strut bounce-test,
summer-heat tire pressure, tire rotation, transmission-fluid color test,
tread-depth rain-vs-snow, why-car-pulls, wiper-blade check,
ac-not-blowing-cold, allseason-vs-winter tires, brake-fluid moisture test,
cold-weather tire light, CV-joint click, power-steering whine, TPMS sensor
battery, uneven-tire-wear patterns, won't-start (battery/starter/alternator).

Open PR titles (4, all today): engine overheating (#1712), steering wheel
shakes when braking / warped rotors (#1708), timing belt with no warning
light (#1702), windshield chip repair (#1701). **The backlog a prior run
flagged (52 open PRs, 37+ topics) has since been resolved down to 5 open
PRs total** — the operator appears to have already batch-reviewed it; this
run adds one pack, not a contribution to a stuck queue.

**"Metallic rattle on acceleration → loose/rusted heat shield" is not among
any of the 40 topics above.** It is adjacent to but distinct from
squealing-vs-grinding-brakes (brake-specific noise) and
strut-bounce-test (suspension bounce test, not an exhaust rattle) — a
different symptom, different cause, different fix. Selected on that basis.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Metallic rattle on acceleration — heat shield | Strong — near-universal annoyance noise, low-stakes enough to be shareable/funny, high curiosity ("what IS that sound") | Yes | No | ✅ **Selected** |
| Burning smell after driving downhill (overheated brakes) | Moderate — narrower scenario (hills/heavy braking) | Yes | Adjacent to brake-fluid-moisture-test but not a duplicate | Parked |
| Clunking over speed bumps (worn sway-bar links) | Moderate — overlaps thematically with strut-bounce-test's suspension-noise territory | Yes | Not an exact duplicate, but too close to strut-bounce-test to run same week | Parked |

"Heat shield rattle" was selected for universal relatability (almost every
driver has heard an unexplained metal rattle), a clean single-cause
diagnostic hook that doesn't require a multi-branch decision tree, and
confirmed non-overlap with the existing 40-topic backlog.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Gets louder as you speed up, quiets at idle → can point to loose exhaust" | General automotive diagnostic knowledge (standard, widely taught symptom-to-cause heuristic — exhaust rattles correlate with engine RPM/vibration, not road speed alone) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run — would be a prod DB read, and no `DATABASE_URL` is present in this session. No `EvidenceRecord` citation is attached. Phrasing uses "can point to" (approved soft-language pattern, `client/src/lib/facelessReelStudio.ts:580`). |
| "Most of the time, it's the heat shield — rusts loose and rattles against the pipe" | Same — standard mechanical fact (thin sheet-metal heat shields are a well-documented common failure point, not shop-specific) | **UNKNOWN against this repo's evidence store**, same reasoning. Avoided "this means" / "is broken" phrasing (flagged by `OVERDIAGNOSIS_PATTERNS` in the same file) in favor of "most of the time." |
| "Leave it long enough and the shield wears through — worth checking before it does" | Same | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "worth checking" (`facelessReelStudio.ts:582`). Deliberately avoided "dangerous to drive" — that exact phrase trips `NO_UNSAFE_SCARE` (`facelessReelStudio.ts:553`) — the script only says the part wears down, never that driving on it is unsafe. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, sidestepping the channel gap noted below. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack.

**Validator note:** this script's phrasing was checked by hand against the
regex patterns in `facelessReelStudio.ts` (`NO_UNSAFE_SCARE`,
`OVERDIAGNOSIS_PATTERNS`, `no-you-need`) — none of the flagged phrases
("dangerous to drive," "this means your X is bad/shot/gone/broken/failing,"
"you definitely need," "your X is broken," "you need") appear in the final
script. The actual `validateReelScript`-style function was not run live
(no server), so this is a manual read against the source, not a tool pass.

---

## 4 · Full production pack

### Script — word-for-word, timed (30s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:05 | "That metal rattle when you hit the gas? Here's the one clue that tells you why." |
| 2 · SETUP | 0:05–0:11 | "Gets louder as you speed up, quiets down at idle? That can point to loose exhaust." |
| 3 · VALUE | 0:11–0:18 | "Most of the time, it's the heat shield — a thin metal cover that rusts loose and rattles against the pipe." |
| 4 · VALUE | 0:18–0:24 | "Leave it long enough and the shield wears through — worth checking before it does." |
| 5 · CTA | 0:24–0:30 | "Do not guess. Nick's Tire and Auto takes a look underneath, free. Link in bio." |

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

- Beat 1: "car undercarriage exhaust pipe dusk garage" / "under car low angle exhaust"
- Beat 2: "car driving away rear view residential street" / "car exhaust pipe rear driving"
- Beat 3: "rusted metal exhaust heat shield closeup" / "car exhaust pipe rust macro"
- Beat 4: "rusted metal flaking closeup macro" / "corroded car part detail"
- Beat 5: "auto repair shop garage bay interior open door"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; the script above is exactly what
gets fed to it, already timed to the 30s budget.

**SFX:** one optional light metallic-rattle sound bed under beats 2–4,
fading out before beat 5 — royalty-free rattle/clank SFX, not music, so it
doesn't touch the rights gap in §6.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration
above. Style: white bold sans, black outline/shadow, bottom-third safe
zone — burn in via ffmpeg `subtitles` filter, never as a generated in-frame
element (Seedance/Higgsfield can't spell reliably, and the M10 preflight
blocks generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat → light
   metallic-rattle SFX bed on beats 2–4 (optional, see §6) → voiceover
   track → burned-in caption track → end-card CTA text (beat 5 only, shop
   name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each
   beat boundary (no crossfade — matches the render-integrity gate's
   expectation of distinct per-beat frames, not a dissolve-blurred
   transition).
3. **End freeze:** hold the beat-5 frame + CTA text card for **3 extra
   seconds** after narration ends (SAVE-prompt convention — see
   `brief.json`'s `endFreezeSeconds`), matching the render-integrity gate's
   expected container duration of beats (30s) + 3s freeze = 33s total.
4. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
5. **Color:** slightly cool/desaturated grade on beats 1–4 (diagnostic
   mood), warm shift on beat 5 (CTA, inviting).
6. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 33s (30s beats + 3s freeze),
   ≥80% of expected 30fps frame count, visibly distinct frames across the
   runtime (no static/looped single image — every beat here is a slow
   camera move or subtle vibration, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 33s total with end freeze (narration 30s), within the
  15–60s target range and the account's own ~25–33s CTA-block convention,
  per prior packs
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and check the day's feed-post
  cap/spacing guardrail (§5) before scheduling
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to whoever's car has been
  rattling"), matching the account's corrected objective (a SAVE-oriented
  CTA measured `saved = 0.00` across the account's first 8 reels, per the
  brakes pack's finding)

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
metallic-rattle SFX (not music) on beats 2–4, which also scores well on the
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
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (49/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> That metal rattle when you hit the gas? Here's the one clue that tells
> you why.
>
> Gets louder as you speed up, quiets at idle — that can point to loose
> exhaust. Most of the time, it's the heat shield: a thin metal cover that
> rusts loose and rattles against the pipe. Leave it long enough and the
> shield wears through.
>
> Do not guess. Send this to whoever's car has been rattling.
>
> #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "That rattle when you hit the gas? It's probably not your engine."
> Caption: Louder as you speed up, quiet at idle — that's a loose heat
> shield, not something scarier. It's a cheap, fast fix if you catch it
> early.
> CTA: Not sure what you're hearing? Call (216) 862-0005 or stop by 17625
> Euclid Ave — we take a look underneath free.

**Ad-ready variant B (question-forward):**

> Hook: "Do you actually know what that under-car rattle is, or are you
> just hoping it goes away?"
> Caption: A rusted heat shield is the most common cause — and it only
> gets worse the longer you wait.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (49/75, see
`brief.json`) sits well below the pipeline's real 70/75 auto-pass floor on
three dimensions specifically — **loop** (the CTA frame, a shop garage bay,
doesn't feed back into the HOOK frame, an under-car dusk shot — no loop
plan was designed), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the heat-shield claim, and that store
wasn't and couldn't be queried live this run — no DB access), and
**winning concept ≥57/60** (`scoreReelConcept()` was not invoked, so this
dimension is scored 0 rather than assumed passing).

Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted, and this session deliberately
did not use the connected Adobe-for-creativity generation tools either
(§1) — an unattended scheduled run is not a live operator instruction to
spend or generate.

Not `BLOCKED` outright — the pack is complete and usable; an operator (or a
live-authorized session) can hand it to the real pipeline via
`/api/admin/reel-canary {action:"start", topic:"metallic rattle on
acceleration: heat shield"}`, let the server re-score and re-render for
real, and only then move toward publish.
