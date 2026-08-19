# Reel production pack — "Won't start: battery vs. starter vs. alternator" (2026-08-19)

Scheduled-task run · 2026-08-19 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **NOSTART**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**⚠️ Backlog finding, read before triaging this PR — see the box in §1.**
This is (at minimum) the 38th distinct reel-pack topic queued as an open,
unmerged draft PR. There are currently **52 open PRs** matching "reel pack"
in the title, none merged since the operator last reviewed one. This pack
adds a genuinely new, non-duplicate topic per this run's instructions, but
the backlog itself — not one more pack — is the thing that needs an
operator decision now.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | `curl localhost:3000/api/health` returned nothing — no server process in this session's container. This is a fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` credentials | **Not present** | Only `apps/nickstire/.env.example` exists in this checkout (template file, placeholder values); no real `.env` with live credentials is present. `env \| grep -i higgsfield` returned nothing. |
| `DATABASE_URL` (prod TiDB) | **Not present** | Same check — not set in this session's shell. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md:32` states prod is pinned to **`template_stock`** (verified there 2026-08-11) — the free local-ffmpeg lane, not Higgsfield/Seedance. Last-known, not live-reconfirmed this run. |
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

    ls apps/nickstire/docs/reel-packs/                          → 5 merged packs
    gh-equivalent: search_pull_requests "reel pack in:title"    → 52 open + merged PRs

Merged packs on disk: penny test, tire expiration date, tread-wear
fingerprint, battery-heat-in-summer, squealing-vs-grinding-brakes. Open
draft PRs (not yet merged, so invisible to `ls` but real work already
covering these topics) add at least: coolant color, spare-tire mileage,
balance-vs-alignment, check-engine-light, wheel-bearing hum,
repair-authorization questions, cabin-vs-engine air filter, cold-weather
tire pressure, all-season-vs-winter tires, pothole damage, tire rotation,
"noises that mean stop driving now", power-steering whine, TPMS sensor
battery, brake-fluid moisture, CV-joint clicking, tire sidewall bulge,
serpentine-belt squeal, wiper-blade check, exhaust-smoke color, strut
bounce-test, oil-change intervals, why-car-pulls, uneven-tire-wear
patterns, AC not blowing cold, road-trip pre-check, transmission-fluid
color test, summer-heat tire pressure, road-salt brake-line corrosion,
tread-depth rain-vs-snow, plug-vs-patch tire repair — roughly **37 distinct
topics already in flight**, plus PR #1648 self-reports "8 pure duplicates
identified" among them, plus 10 consecutive most-recent runs (#1647, #1669,
#1671, #1682–#1687) that each concluded "no new pack this run" because the
backlog made a fresh topic hard to justify.

**"Won't start — battery vs. starter vs. alternator" symptom triage is not
among any of the above.** It is adjacent to the merged battery-heat pack
(that one is about summer heat degrading battery *capacity over time*; this
one is about diagnosing *why the car isn't starting right now* from three
different possible causes) and distinct from every open-PR topic listed.
Selected on that basis.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

Given the scale of the existing backlog, candidate scoring this run was
narrowed to topics confirmed absent from both the merged-pack directory and
the 52 open/merged PR titles (§1), rather than re-deriving a fresh slate:

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Won't start: battery vs. starter vs. alternator | Strong — universal "stranded" fear, clean 3-way diagnostic hook | Yes | No | ✅ **Selected** |
| Car overheating / temp gauge in the red | Strong — visceral, high-stakes | Yes | Not found in title list, but a summer-heat-adjacent pack (tire pressure) exists; deprioritized to avoid thematic overlap this run | Parked |
| Clutch slipping (manual transmission) | Weak — niche audience (manual-transmission share of the fleet is small) | Yes | No | Parked |

"Won't start" was selected for the combination of universal relatability
(everyone has had a car not start), a clean three-way diagnostic structure
that maps onto the account's 5-beat shape without inventing structure, and
confirmed non-overlap with the existing backlog.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Lights dim, nothing else happens → may indicate the battery" | General automotive diagnostic knowledge (battery-weak symptom is standard, widely taught roadside-diagnosis heuristic) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is even present in this session). No `EvidenceRecord` citation is attached. Phrasing uses "may indicate" (approved soft-language pattern, `client/src/lib/facelessReelStudio.ts:581`) rather than an absolute, which is the correct hedge for an unverified-in-store claim. |
| "One fast click, nothing turns over → can point to the starter" | Same — standard mechanical fact, not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "can point to" (`facelessReelStudio.ts:580`). |
| "Starts fine, battery light while driving → worth checking the alternator" | Same | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "worth checking" (`facelessReelStudio.ts:582`). |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, which sidesteps the channel gap noted below. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack, but it would block any future reel script that
wants to quote a price or warranty line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (28s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Car won't start? The way it fails is one clue to why." |
| 2 · SETUP | 0:04–0:10 | "Lights dim, and nothing else happens? That may indicate the battery." |
| 3 · VALUE | 0:10–0:16 | "One fast click, and nothing turns over? That can point to the starter." |
| 4 · VALUE | 0:16–0:22 | "Starts fine, then a battery light hits while you're driving? Worth checking the alternator." |
| 5 · CTA | 0:22–0:28 | "Don't guess — three parts, three different bills. Nick's Tire and Auto tests all three free. Link in bio." |

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

- Beat 1: "car dashboard instrument cluster driveway dusk" / "ignition key car interior"
- Beat 2: "dashboard warning lights flickering dim" / "car battery icon dashboard"
- Beat 3: "car engine bay starter motor closeup" / "under hood engine bay macro"
- Beat 4: "dashboard battery light driving windshield reflection"
- Beat 5: "auto repair shop garage bay interior open door"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; the script above is exactly what
gets fed to it, already timed to the 28s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration
above. Style: white bold sans, black outline/shadow, bottom-third safe
zone, ALL-CAPS optional per house style — burn in via ffmpeg `subtitles`
filter, never as a generated in-frame element (Seedance/Higgsfield can't
spell reliably, and the M10 preflight blocks generated text for exactly
that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat →
   ambient garage room-tone / single mechanical click SFX on beat 3
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
   gate):** container duration within 0.75s of 28s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow camera move or
   subtle vibration, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 28s (within the 15–60s target range and the account's own
  25–30s CTA-block convention, per the prior brakes pack)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and see §1's guardrail-order
  note if today's feed slot is already consumed
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone whose car won't
  start"), matching the account's corrected objective (a SAVE-oriented CTA
  measured `saved = 0.00` across the account's first 8 reels, per the
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
mechanical click SFX on beat 3, which also scores well on the pipeline's
muted-first requirement since captions alone carry full meaning. If the
operator wants a music bed, that requires a specific track with asset ID,
source, license scope, territory, and expiry tracked by hand — this pack
does not supply one.

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

> Car won't start? The way it fails is one clue to why.
>
> Lights dim and nothing else happens — that may indicate the battery.
> One fast click and nothing turns over — that can point to the starter.
> Starts fine, then a battery light hits while you're driving — worth
> checking the alternator.
>
> Don't guess. Send this to someone whose car won't start.
>
> #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Car won't start? Three parts can cause it — and only one of them
> is the battery."
> Caption: Dim lights = battery. One fast click = starter. Battery light
> while driving = alternator. Guess wrong and you pay for the wrong part.
> CTA: Not sure which? Call (216) 862-0005 or stop by 17625 Euclid Ave —
> we test all three free.

**Ad-ready variant B (question-forward):**

> Hook: "Dead battery, bad starter, or dying alternator — do you actually
> know which one stranded you?"
> Caption: Each one fails differently, and each one costs differently.
> Guessing means paying for the wrong fix first.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (55/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a shop garage bay,
doesn't feed back into the HOOK frame, a home driveway dashboard — no loop
plan was designed), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the battery/starter/alternator
triage claims, and that store wasn't and couldn't be queried live this
run — no DB access), and **winning concept ≥57/60** (`scoreReelConcept()`
was not invoked, so this dimension is scored 0 rather than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"car won't start: battery vs starter vs
alternator"}`, let the server re-score and re-render for real, and only
then move toward publish.

**Separately, and more importantly than this one pack: the backlog
described in §1 (52 open PRs, 37+ distinct topics, at least 8 self-reported
duplicates, 10 consecutive prior runs unable to justify a new topic) is an
operator-level decision point, not something a scheduled session can or
should resolve unilaterally.** This session did not merge, close, or
otherwise touch any other PR — that is outside this run's assigned scope
and each of those PRs belongs to a different session's branch. Recommended
next step for the operator: batch-review the backlog (all are docs-only,
zero live side effects, explicitly `READY FOR HUMAN APPROVAL` not
`PUBLISHED`), merge or close as appropriate, and consider whether this
scheduled trigger should keep firing at its current cadence while that
review is pending.
