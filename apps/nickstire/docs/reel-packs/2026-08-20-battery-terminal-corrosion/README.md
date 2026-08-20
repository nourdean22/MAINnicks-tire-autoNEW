# Reel production pack — "Battery terminal corrosion: clean it, or is it leaking?" (2026-08-20)

Scheduled-task run · 2026-08-20 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **CORRODE**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**Backlog status, read before triaging this PR.** As of this run: **13 open
PRs** match `reel pack in:title` (down from 52 at the last pack-run's
count — the operator has clearly been reviewing/merging since), plus 37
already-merged packs on disk. The prior run's core finding stands in
reduced form: this is still a sizeable unreviewed queue, not an empty one.
This pack's topic (battery terminal corrosion — cleaning vs. a leaking
cell) was checked against all 13 open titles and all 37 merged directories
and is not a duplicate of either (closest neighbors: `wont-start-*`, which
is about starter/alternator diagnosis, and `battery-summer-heat`, which is
about heat degrading capacity over time — neither covers terminal
corrosion). Recommended operator action, unchanged from prior runs: batch
review the 13 open drafts (all docs-only, zero live side effects, each
already `READY FOR HUMAN APPROVAL`) rather than let them accumulate further.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | `curl -m 3 localhost:3000/api/health` failed to connect — no server process in this session's container. This is a fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` credentials | **Not present** | `env \| grep -iE "higgsfield\|database_url\|reel_"` returned nothing. Only `apps/nickstire/.env.example` exists (template, placeholder values) — no real `.env` in this checkout. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md:32` states prod reads **`template_stock`** (verified 2026-08-11) — the paid Higgsfield/Seedance lane was dropped; reels render on the free local-ffmpeg lane. Last-known, not live-reconfirmed this run. |
| `REEL_FALLBACK_TO_TEMPLATE_STOCK` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md:36` — **off by default**; not evaluated live. |
| `REEL_GENERATION_ENABLED` | Not read live | No server process to query; gate lives on the cron pulse job. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| ChatGPT / general LLM text generation | **This session itself** | Used for script/copy authoring below — no external LLM API call made or needed. |
| CapCut / video-editing software | **Not available** | No GUI editor in this container; ffmpeg assembly instructions given instead (§4). |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is. No MP4 exists; none
is claimed to exist.

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/                              → 37 merged packs
    search_pull_requests "reel pack in:title" state:open              → 13 open PRs

Merged topics on disk include: penny test, tire expiration date,
tread-wear fingerprint, battery-heat-in-summer, check-engine-light,
squealing-vs-grinding-brakes, wheel-bearing hum, balance-vs-alignment,
cabin-vs-engine air filter, coolant color, exhaust-smoke color, oil-change
intervals, plug-vs-patch tire repair, pothole damage, repair-authorization
questions, road-salt brake-line corrosion, road-trip pre-check, serpentine-
belt squeal, tire sidewall bulge, spare-tire mileage, "noises that mean
stop driving now," strut bounce-test, summer-heat tire pressure, tire
rotation, transmission-fluid color test, tread-depth rain-vs-snow, why-car-
pulls, wiper-blade check, AC not blowing cold, all-season-vs-winter tires,
brake-fluid moisture test, cold-weather tire-pressure light, CV-joint
clicking, power-steering whine, TPMS sensor battery, uneven tire-wear
patterns, and "won't start: battery vs. starter vs. alternator."

Open-PR topics (13): cloudy/yellowed headlights, tailpipe condensation vs.
coolant leak, engine overheating (first 60 seconds), metallic rattle on
acceleration (heat shield), timing belt with no warning light, windshield
chip repair-before-it-spreads, dashboard warning-light colors, Ohio E-Check
readiness monitors, steering wheel shakes when braking (warped rotors),
shakes at a stoplight (spark plugs vs. motor mount), spongy brake pedal,
"that smell while driving," and clunk over bumps (sway bar vs. ball joint).

**"Battery terminal corrosion" is not among any of the above.** It's
adjacent to `wont-start-*` (that pack diagnoses why a car won't crank right
now from three causes; this one diagnoses a visible symptom — powder on the
terminals — that can be harmless or can signal a leaking cell) and to
`battery-summer-heat` (that one is about heat shortening battery life over
time, not a visual terminal symptom). Selected on that basis.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Battery terminal corrosion — clean vs. leaking cell | Strong — visual, common car-owner worry, clean two-branch diagnostic hook | Yes | No | ✅ **Selected** |
| Fluid leak color under the car (beyond the existing coolant/transmission color packs) | Moderate — overlaps thematically with two already-merged "fluid color" packs | Yes | Partially (coolant-color, transmission-fluid-color-test) | Parked — too close to existing content |
| Tire valve stem cracking/dry rot | Moderate — real but narrower audience concern | Yes | Not found in either list | Parked — battery topic scored a stronger hook this run |

"Battery terminal corrosion" was selected for universal relatability (most
drivers have seen crusty battery terminals and don't know if it's serious),
a clean two-branch diagnostic structure (clean-it vs. get-it-checked) that
fits the account's 5-beat shape, and confirmed non-overlap with both the
merged-pack directory and the open-PR backlog.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Light dusting, terminal still tight → can point to normal corrosion, clean it" | General automotive knowledge — battery-terminal corrosion from hydrogen gas venting is a standard, widely taught maintenance fact | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read; no `DATABASE_URL` present). No `EvidenceRecord` citation attached. Phrasing uses "can point to" (approved soft-language pattern, `client/src/lib/facelessReelStudio.ts:580`) rather than an absolute. |
| "Terminal loose under the powder → may indicate a bad connection, not the battery" | Same — standard mechanical fact, not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "may indicate" (`facelessReelStudio.ts:581`). |
| "Heavy buildup that returns fast → worth checking for a leaking cell" | Same | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "worth checking" (`facelessReelStudio.ts:582`). |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, sidestepping the channel gap below. |

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
| 1 · HOOK | 0:00–0:04 | "Green or white powder on your battery? One clue, more than one cause." |
| 2 · SETUP | 0:04–0:10 | "Light dusting, terminal still tight? That can point to normal corrosion — clean it." |
| 3 · VALUE | 0:10–0:16 | "Terminal loose under the powder? That may indicate a bad connection, not the battery." |
| 4 · VALUE | 0:16–0:22 | "Heavy buildup that's back in days? Worth checking for a leaking battery cell." |
| 5 · CTA | 0:22–0:28 | "Don't guess with corrosion. Nick's Tire and Auto checks it free — link in bio." |

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

- Beat 1: "car battery terminal corrosion closeup" / "under hood battery macro"
- Beat 2: "battery terminal clamp closeup engine bay"
- Beat 3: "car battery cable connection macro"
- Beat 4: "corroded battery terminal white powder closeup"
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
   optional soft crackle/brush SFX on beat 2 (see §6) → voiceover track →
   burned-in caption track → end-card CTA text (beat 5 only, shop name +
   "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each
   beat boundary (no crossfade — matches the render-integrity gate's
   expectation of distinct per-beat frames, not a dissolve-blurred
   transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** cooler, slightly desaturated grade on beats 1–4 (diagnostic,
   attentive mood), warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 28s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow camera move or
   subtle drift, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 28s (within the 15–60s target range and the account's own
  ~28–30s CTA-block convention, per prior packs)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and see §5's guardrail-order
  note if today's feed slot is already consumed
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone with a corroded
  battery"), matching the account's corrected objective (a SAVE-oriented
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
soft crackle/brush SFX on beat 2, which also scores well on the pipeline's
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
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (53/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Green or white powder on your battery? One clue, more than one cause.
>
> Light dusting, terminal still tight — that can point to normal
> corrosion, clean it.
> Terminal loose under the powder — that may indicate a bad connection,
> not the battery.
> Heavy buildup that's back in days — worth checking for a leaking cell.
>
> Don't guess with corrosion. Send this to someone with a crusty battery.
>
> #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "That green powder on your battery — clean it, or is it leaking?"
> Caption: Light dusting and a tight terminal? Clean it and move on. Loose
> terminal or buildup that keeps coming back? That's worth a real look.
> CTA: Not sure which? Call (216) 862-0005 or stop by 17625 Euclid Ave —
> we check it free.

**Ad-ready variant B (question-forward):**

> Hook: "Crusty battery terminals — do you know if that's normal or a
> warning sign?"
> Caption: Corrosion can be harmless or point to a leaking cell. Guessing
> means missing the one that actually matters.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (53/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a shop garage bay,
doesn't feed back into the HOOK frame, a battery-terminal close-up — no
loop plan was designed), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the corrosion/leaking-battery
claims, and that store wasn't and couldn't be queried live this run — no
DB access), and **winning concept ≥57/60** (`scoreReelConcept()` was not
invoked, so this dimension is scored 0 rather than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"battery terminal corrosion: clean it or is it
leaking"}`, let the server re-score and re-render for real, and only then
move toward publish.

**Separately, and more importantly than this one pack: the 13-open-PR
backlog described above is an operator-level decision point, not something
a scheduled session can or should resolve unilaterally.** This session did
not merge, close, or otherwise touch any other PR — that is outside this
run's assigned scope and each of those PRs belongs to a different session's
branch. Recommended next step for the operator: batch-review the backlog
(all are docs-only, zero live side effects, explicitly `READY FOR HUMAN
APPROVAL` not `PUBLISHED`), merge or close as appropriate, and consider
whether this scheduled trigger should keep firing at its current cadence
while that review is pending.
