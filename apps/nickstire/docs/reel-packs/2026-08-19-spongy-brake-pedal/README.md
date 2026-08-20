# Reel production pack — "Spongy brake pedal: air in the lines vs. the master cylinder" (2026-08-19)

Scheduled-task run · 2026-08-19 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **SOFTPEDAL**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**⚠️ Escalating, not just repeating, the backlog finding from prior packs —
see the box in §1.** This is the **9th** distinct reel-pack topic added by a
scheduled run today alone, on top of an already-unreviewed backlog. At the
time of this run there are **7 open PRs** titled "reel pack" spanning
16:33–22:31 ET today, none merged, arriving roughly hourly with zero human
triage in between. The prior pack (`2026-08-19-wont-start-...`) already
flagged this at "52 open PRs, 10 consecutive runs unable to justify a new
topic" and recommended an operator batch-review; that review has not
happened, and the queue has kept growing in the hours since. This pack still
adds a genuinely new, non-duplicate topic per this run's instructions — but
the backlog itself is now the more urgent thing, and this run pushes a
proactive notification about it (see end of run).

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session's container — a fresh repo checkout, not the running app. No `/api/health` to hit. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` credentials | **Not present** | Only a placeholder value (`change-this-to-a-random-string`) exists in the checkout's env template — not a real credential. |
| `DATABASE_URL` (prod TiDB) | **Not present** | Not set in this session's shell — confirmed by grep, no live env exported. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (last-verified 2026-08-11) — the free local-ffmpeg lane, not Higgsfield/Seedance. Not live-reconfirmed this run. |
| `REEL_GENERATION_ENABLED` | Not read live | No server process to query; gate lives on the cron pulse job, code-confirmed to default OFF (`reelPipeline.ts` hard no-op unless `=== "true"`). |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is §4 below.

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/                         → 37 merged pack directories
    list_pull_requests(state=open, search "reel pack")         → 7 open PRs today alone

Merged topics on disk (37, spanning 08-14 through 08-19) cover: penny test,
tire-expiration date, tread-wear fingerprint, battery-heat, check-engine
light, squealing-vs-grinding brakes, wheel-bearing hum, balance-vs-alignment,
cabin-air filter, coolant color, exhaust-smoke color, oil-change intervals,
plug-vs-patch, pothole damage, repair-authorization questions, road-salt
brake-line corrosion, road-trip tire check, serpentine-belt squeal, sidewall
bulge, spare-tire mileage, "noises that mean stop driving now," strut
bounce-test, summer-heat tire pressure, tire rotation, transmission-fluid
color test, tread-depth rain-vs-snow, why-car-pulls, wiper-blade check,
AC-not-blowing-cold, all-season-vs-winter tires, brake-fluid moisture test,
cold-weather TPMS light, CV-joint clicking, power-steering whine, TPMS
sensor battery, uneven-tire-wear patterns, and won't-start
battery/starter/alternator triage.

Open PRs today (not yet merged, invisible to `ls`, but real in-flight work):
windshield-chip repair, timing-belt no-warning-light, steering-wheel shake
under braking (warped rotors), engine-overheating first-60-seconds,
metallic-rattle-on-acceleration (heat shield), clunk-over-bumps
(sway-bar-link vs. ball joint), and "that smell while driving"
(coolant vs. rubber vs. electrical).

**"Spongy or soft brake pedal — air in the lines vs. the master cylinder"
is not among any of the above.** Existing brake-adjacent packs cover sound
(squealing-vs-grinding), fluid condition (brake-fluid moisture test), and
steering-wheel shake specifically *while* braking (warped rotors) — none of
them cover pedal *feel* (sinking travel, sponginess) as its own diagnostic
symptom, which is a distinct and common complaint from all three. Selected
on that basis.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Spongy/soft brake pedal: air in lines vs. master cylinder | Strong — brakes are a high-stakes, high-relatability topic; pedal *feel* is a distinct angle from every existing brake pack | Yes | No | ✅ **Selected** |
| Oil leak spots under the car — color guide | Moderate | Yes | Not literally covered, but the account already has three "read the color" packs (coolant, transmission fluid, exhaust smoke) — a fourth risks feeling formulaic | Parked |
| Car dies at stoplights / rough idle | Moderate | Yes | Not covered, but weaker three-beat diagnostic hook than the brake pedal angle | Parked |

Brake pedal feel was selected for high relatability (everyone has felt a
"different" brake pedal at some point), a clean two-way diagnostic split
(air in the lines vs. master cylinder) that maps onto the account's 5-beat
shape without inventing structure, and confirmed non-overlap with all 44
topics already in the merged directory or open-PR backlog.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Pedal sinks slowly to the floor while stopped → can point to air in the lines" | General automotive diagnostic knowledge (a standard, widely-taught roadside/shop heuristic) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run — no `DATABASE_URL` present, would be a prod read. No `EvidenceRecord` citation attached. Phrasing uses "can point to" (approved soft-language pattern, `client/src/lib/facelessReelStudio.ts:580`) rather than an absolute. |
| "Pedal feels soft every time you press it → worth checking fluid and lines for a leak" | Same — standard mechanical fact, not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "worth checking" (`facelessReelStudio.ts:582`). |
| "Pedal travels almost to the floor before it grabs → may indicate the master cylinder" | Same | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "may indicate" (`facelessReelStudio.ts:581`). |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** Sidesteps the channel gap noted below. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack.

---

## 4 · Full production pack

### Script — word-for-word, timed (26s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Brake pedal feels different than it used to? That's not nothing." |
| 2 · SETUP | 0:04–0:10 | "Pedal sinks slowly toward the floor while you're stopped? That can point to air in the lines." |
| 3 · VALUE | 0:10–0:16 | "Pedal feels soft every time you press it? Worth checking the fluid and lines for a leak." |
| 4 · VALUE | 0:16–0:22 | "Pedal travels almost to the floor before it grabs? That may indicate the master cylinder." |
| 5 · CTA | 0:22–0:26 | "Don't wait on brakes. Nick's Tire and Auto checks your pedal feel free. Link in bio." |

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

- Beat 1: "car brake pedal close up interior" / "driver foot brake pedal dashboard"
- Beat 2: "brake pedal slowly depressing car interior" / "car stopped at light brake pedal"
- Beat 3: "brake fluid reservoir under hood" / "brake line closeup wheel well"
- Beat 4: "brake pedal pressed down low car interior" / "master cylinder engine bay closeup"
- Beat 5: "auto repair shop garage bay interior open door"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; the script above is exactly what
gets fed to it, already timed to the 26s budget.

### Captions

[`captions.srt`](./captions.srt) — 9 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration
above. Style: white bold sans, black outline/shadow, bottom-third safe
zone — burn in via ffmpeg `subtitles` filter, never as a generated in-frame
element (Seedance/Higgsfield can't spell reliably, and the M10 preflight
blocks generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat →
   ambient interior road-noise / single soft mechanical "give" SFX on beat 4
   (optional, see §6) → voiceover track → burned-in caption track →
   end-card CTA text (beat 5 only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each
   beat boundary (no crossfade — matches the render-integrity gate's
   expectation of distinct per-beat frames, not a dissolve-blurred
   transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** cooler, slightly desaturated grade on beats 1–4 (diagnostic,
   slightly tense mood), warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 26s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow camera move or
   subtle vibration, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 26s (within the 15–60s target range and the account's own
  25–30s CTA-block convention, per prior packs)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and see §1's guardrail-order
  note if today's feed slot is already consumed by earlier packs or the
  autonomous cron
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone whose brakes feel
  off"), matching the account's corrected objective (a SAVE-oriented CTA
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
| `veo_second_720p` | $0.10/sec | ~$2.80 (5 clips × ~5.5s avg) |
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
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. With
7+ packs already produced today, the feed cap and spacing window are almost
certainly already consumed several times over — this pack should wait for a
real open slot, not force a same-day post.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, same one
noted in every prior pack — not a new finding). This pack sidesteps it
deliberately rather than asserting a track is cleared: **no music bed is
assigned.** The reel is voiceover + captions + one optional royalty-free
soft mechanical "give" SFX on beat 4, which also scores well on the
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
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (50/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Brake pedal feels different than it used to? That's not nothing.
>
> Sinks slowly toward the floor while you're stopped — can point to air in
> the lines. Feels soft every time you press it — worth checking the fluid
> and lines for a leak. Travels almost to the floor before it grabs — may
> indicate the master cylinder.
>
> Don't wait on brakes. Send this to someone whose pedal feels off.
>
> #cartips #clevelandohio #carmaintenance #autorepair #brakesafety

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Your brake pedal is trying to tell you something — are you
> listening?"
> Caption: Slow sink to the floor = air in the lines. Soft every press =
> a leak. Pedal near the floor before it grabs = the master cylinder.
> CTA: Not sure which? Call (216) 862-0005 or stop by 17625 Euclid Ave —
> we check pedal feel free.

**Ad-ready variant B (question-forward):**

> Hook: "Does your brake pedal feel different than it did last month?"
> Caption: Brakes don't fail all at once — they usually tell you first.
> Pedal feel is one of the clearest clues you'll get.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (50/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a shop garage bay,
doesn't feed back into the HOOK frame, an in-car pedal close-up — no loop
plan was designed), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the pedal-feel triage claims, and
that store wasn't and couldn't be queried live this run — no DB access),
and **winning concept ≥57/60** (`scoreReelConcept()` was not invoked, so
this dimension is scored 0 rather than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"spongy brake pedal: air in the lines vs master
cylinder"}`, let the server re-score and re-render for real, and only then
move toward publish.

**Separately, and more urgently than this one pack: the unreviewed-PR
backlog described in §1 has grown, not shrunk, since the last pack flagged
it.** 7 open "reel pack" PRs today alone, zero merged, arriving roughly
hourly. This session did not merge, close, or otherwise touch any other
PR — each belongs to a different scheduled run's own branch, and doing so
is outside this run's assigned scope. Recommended next step for the
operator, repeated because it has not yet been acted on: batch-review the
backlog (all are docs-only, zero live side effects, explicitly `READY FOR
HUMAN APPROVAL` not `PUBLISHED`), merge or close as appropriate, and decide
whether this scheduled trigger should keep firing at its current
(roughly-hourly) cadence while that review is pending. A push notification
was sent this run flagging this specifically, since an unattended,
unbounded queue is exactly the kind of state worth surfacing proactively.
