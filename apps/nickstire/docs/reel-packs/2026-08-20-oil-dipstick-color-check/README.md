# Reel production pack — "Oil dipstick color check: three colors, three problems" (2026-08-20)

Scheduled-task run · 2026-08-20 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **OILCHECK**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**⚠️ Backlog finding, read before triaging this PR — see the box in §1.**
This run's own check found **8 reel-pack PRs opened today alone**
(#1724–#1731, roughly one per hour, none merged) on top of 16 open PRs
total and 37 already-merged packs on disk — 53 distinct topics in flight.
This pack adds a genuinely new, non-duplicate topic per this run's
instructions, but the cadence itself is an operator-level decision, not
something this run can fix. See §1 and §9 for the full count and the
recommendation.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | `curl -m 2 localhost:3000/api/health` — connection refused. This is a fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` credentials | **Not present** | `env \| grep -i higgsfield` returned nothing in this session's shell. |
| `DATABASE_URL` (prod TiDB) | **Not present** | Same check — not set in this session's shell. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md:32` states prod is pinned to **`template_stock`** (verified there 2026-08-11) — the free local-ffmpeg lane, not Higgsfield/Seedance. Last-known, not live-reconfirmed this run. |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | Not read live | `env \| grep -i reel_` returned nothing; no server process to query either. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| ChatGPT / external LLM | N/A | This session's own model wrote the script and prompts below — no external LLM call was needed or made. |
| CapCut / GUI editor | Not available | No GUI tool in this environment; editing instructions in §4 are written for a human (or ffmpeg) to execute manually. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is. **No MP4 exists.**

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/                                  → 37 merged packs
    search_pull_requests "repo:.../mainnicks-tire-autonew is:pr is:open reel pack in:title"
                                                                          → 16 open draft PRs, 8 of them opened TODAY (2026-08-20)

Merged packs on disk (37): penny test, tire expiration date, tread-wear
fingerprint, battery-heat-in-summer, check-engine-light, squealing-vs-grinding
brakes, wheel-bearing hum, balance-vs-alignment, cabin air filter, coolant
color, exhaust-smoke color, oil-change intervals, plug-vs-patch, pothole
damage, repair-authorization questions, road-salt brake-line corrosion,
road-trip tire pre-check, serpentine-belt squeal, tire sidewall bulge,
spare-tire mileage, "noises that mean stop driving now", strut bounce-test,
summer-heat tire pressure, tire rotation, transmission-fluid color test,
tread-depth rain-vs-snow, why-car-pulls, wiper-blade check, AC not blowing
cold, all-season-vs-winter tires, brake-fluid moisture test, cold-weather
tire-pressure light, CV-joint clicking, power-steering whine, TPMS sensor
battery, uneven tire-wear patterns, won't-start (battery/starter/alternator).

Open draft PRs (16, not yet merged so invisible to `ls` but real work
already covering these topics): cloudy/yellowed headlights, heater blows
cold not hot, tailpipe condensation vs. coolant leak, engine overheating —
first 60 seconds, gas smell inside the cabin, metallic rattle on
acceleration (heat shield), timing belt with no dashboard warning,
windshield chip repair-before-it-spreads, battery terminal corrosion,
dashboard warning-light colors (red vs. amber), Ohio E-Check readiness
monitors, steering wheel shakes when braking (warped rotors), shakes at a
stoplight (spark plugs vs. motor mount), spongy brake pedal, "that smell
while driving" (coolant/rubber/electrical), clunk over bumps (sway bar link
vs. ball joint).

**"Oil dipstick color check" is not among any of the above.** `oil-change
intervals` (merged) is about *when* to change oil on a schedule;
`coolant-color` (merged) and `transmission-fluid-color-test` (merged) are
about different fluids entirely. Reading the dipstick's own color/texture as
a diagnostic (honey/amber = normal, black-and-gritty = overdue, milky/foamy
= coolant intrusion — a head-gasket red flag) is a distinct claim set and a
distinct visual (macro shot of the dipstick tip) from all 53 topics above.
Selected on that basis.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

Given the scale of the existing backlog, candidate scoring this run was
narrowed to topics confirmed absent from both the merged-pack directory and
the 16 open PR titles (§1), rather than re-deriving a fresh slate:

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Oil dipstick color check (honey/black-gritty/milky) | Strong — visual, three-way diagnostic, "milky oil" is a genuine scare-hook with a real underlying failure (head gasket) | Yes | No | ✅ **Selected** |
| Shocks/struts leaking oil visible on the shock body | Moderate — decent visual but close in territory to the merged strut bounce-test pack | Yes | Thematically adjacent to an existing merged pack | Parked |
| Tire valve-stem cracking / dry rot | Moderate — real but narrower audience appeal than a fluid-color hook | Yes | No | Parked |

"Oil dipstick color check" was selected for the combination of a strong
visual (macro dipstick shot reads clearly even muted), a clean three-way
diagnostic structure matching the account's 5-beat shape, and confirmed
non-overlap with the existing backlog.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Honey to dark amber → normal" | General automotive diagnostic knowledge (standard oil-condition heuristic, not shop-specific) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. |
| "Black and gritty → can point to an overdue oil change" | Same — standard mechanical fact | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "can point to" (approved soft-language pattern, `client/src/lib/facelessReelStudio.ts:580`). |
| "Milky or foamy → may indicate coolant in the oil, stop driving" | Same — standard mechanical fact (coolant/oil intermixing via a failed head gasket or cracked block is a widely taught red-flag symptom) | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "may indicate" (`facelessReelStudio.ts:581`). The "stop driving" instruction is safety-conservative advice, not a shop-specific or absolute claim. |
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
| 1 · HOOK | 0:00–0:04 | "Pull your dipstick. The color is telling you something." |
| 2 · SETUP | 0:04–0:10 | "Honey to dark amber? That's normal — worth checking again next month." |
| 3 · VALUE | 0:10–0:17 | "Black and gritty? That can point to an overdue oil change." |
| 4 · VALUE | 0:17–0:23 | "Milky or foamy? That may indicate coolant in the oil — stop driving and get it looked at." |
| 5 · CTA | 0:23–0:28 | "Thirty seconds under the hood can save you thousands. Nick's Tire and Auto checks it free. Link in bio." |

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

- Beat 1: "dipstick pulled from car engine closeup" / "checking engine oil hood open"
- Beat 2: "engine oil dipstick amber closeup macro" / "car oil dipstick tip clean"
- Beat 3: "dark dirty engine oil dipstick macro" / "old motor oil closeup texture"
- Beat 4: "milky oil dipstick closeup" / "engine bay macro dim garage light"
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

### Editing instructions (CapCut or ffmpeg — either path; both are manual, no GUI tool is available in this session)

1. **Layer order (bottom to top):** background video clip per beat → ambient
   garage room-tone (optional, see §6) → voiceover track → burned-in caption
   track → end-card CTA text (beat 5 only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each
   beat boundary (no crossfade — matches the render-integrity gate's
   expectation of distinct per-beat frames, not a dissolve-blurred
   transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** neutral/slightly cool grade on beats 1–4 (diagnostic,
   inspection mood), warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 28s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow macro push-in or
   subtle hand/camera move, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 28s (within the 15–60s target range and the account's
  prior 25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and see §5's guardrail-order
  note if today's feed slot is already consumed
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone who's overdue for an
  oil check"), matching the account's corrected objective (a SAVE-oriented
  CTA measured `saved = 0.00` across the account's first 8 reels, per an
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
assigned.** The reel is voiceover + captions + optional ambient garage
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
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (50/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Pull your dipstick. The color is telling you something.
>
> Honey to dark amber — normal, check again next month.
> Black and gritty — can point to an overdue oil change.
> Milky or foamy — may indicate coolant in the oil. Stop driving and get it
> looked at.
>
> 30 seconds under the hood can save you thousands. Send this to someone
> who's overdue for a check.
>
> #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Your oil dipstick has three colors — and only one of them is
> normal."
> Caption: Amber = fine. Black and gritty = overdue. Milky = coolant in the
> oil, and that's a bigger problem. Check it before you drive further.
> CTA: Not sure what you're looking at? Call (216) 862-0005 or stop by
> 17625 Euclid Ave — we check it free.

**Ad-ready variant B (question-forward):**

> Hook: "Ever actually looked at what color your oil is?"
> Caption: Milky or foamy oil isn't a minor thing — it can mean coolant is
> mixing into your engine. Catching it early is the difference between a
> repair and a rebuild.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (50/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a shop garage bay,
doesn't feed back into the HOOK frame, a hand pulling a dipstick — no loop
plan was designed), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the oil-color triage claims, and that
store wasn't and couldn't be queried live this run — no DB access), and
**winning concept ≥57/60** (`scoreReelConcept()` was not invoked, so this
dimension is scored 0 rather than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"oil dipstick color check: amber vs black-gritty vs
milky"}`, let the server re-score and re-render for real, and only then
move toward publish.

**Separately, and more importantly than this one pack: this session's own
check found 8 reel-pack PRs opened today alone (2026-08-20, #1724–#1731,
roughly hourly), on top of 16 open PRs and 37 already-merged packs — 53
distinct topics now in flight, none of today's 8 merged as of this run.**
This session did not merge, close, or otherwise touch any other PR — that
is outside this run's assigned scope and each of those PRs belongs to a
different session's branch. Recommended next step for the operator:
batch-review the backlog (all are docs-only, zero live side effects,
explicitly `READY FOR HUMAN APPROVAL` not `PUBLISHED`), merge or close as
appropriate, and reconsider whether this scheduled trigger should keep
firing roughly hourly while that backlog sits unreviewed — an unreviewed
pack has produced zero shop value regardless of how well-formed it is.
