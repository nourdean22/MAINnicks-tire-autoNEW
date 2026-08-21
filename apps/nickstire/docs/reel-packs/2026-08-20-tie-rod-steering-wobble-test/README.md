# Reel production pack — "The 10-second wheel wobble test" (2026-08-20)

Scheduled-task run · 2026-08-20 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **WOBBLE**

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
| Render/publish binaries (`hf`, `higgsfield`, `ffmpeg`, `gh`) | **Not present** | `which hf higgsfield ffmpeg gh` returned nothing this run. |
| `REEL_*` / `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` env vars | **Not present** | `env \| grep -E '^(REEL_\|HIGGSFIELD_\|ADMIN_API_KEY\|DATABASE_URL)'` returned nothing this run. |
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session's container — a fresh repo checkout, not the running app. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| ChatGPT (external LLM) / TTS / CapCut (desktop editor) | Not available | No such tool is connected to this session; this pack substitutes exact narration text and ffmpeg-equivalent assembly instructions a human (or the real pipeline) can execute. |

**Conclusion: this run has zero live motion route**, identical to every
prior scheduled firing recorded in this directory. Per the skill's
"Producing a pack when the motion route is unavailable" section, the
correct output is a full production-ready pack — not a claimed render, and
not a silently weaker deliverable. That is what §4 below is.

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/                          → 55 merged date-slug directories (2026-08-14 through 2026-08-20)
    list_pull_requests(owner, repo, state="open")                → 1 open PR total (#1737, statenour cron-heartbeat fix — unrelated to reel packs)

**Backlog note:** this morning's status file in this same directory
(`BACKLOG-STATUS-2026-08-20-0900.md`) recorded 17 open "reel pack" PRs and
recommended skipping new packs while that backlog sat unreviewed. As of
this run, **that backlog has fully cleared** — zero open reel-pack PRs
remain (they merged or closed since 0900). That is the same clear-then-rebuild
cycle the status note described happening once already this week. Given a
clear backlog right now, producing one new pack adds real throughput rather
than more unreviewed inventory — the condition that note asked future runs
to check before skipping.

Reviewed all 55 merged directory topics plus the (now-empty) open-PR list
for overlap. Covered: tire (penny test, expiration, tread fingerprint,
rotation, sidewall bulge, spare-tire mileage, plug-vs-patch, tread-depth
rain-vs-snow, road-trip check, summer/cold-weather pressure,
all-season-vs-winter, uneven wear), brakes (squealing-vs-grinding, brake
fluid moisture, warped rotors/steering shake, spongy pedal), steering/
suspension (strut bounce test, why-car-pulls, sway bar/ball joint clunk over
bumps, wheel bearing hum), engine/drivetrain (check-engine light, serpentine
belt, timing belt, CV joint click, power steering whine, transmission fluid
color, engine overheating, spark-plug idle shake/motor mount, heat shield
rattle), electrical (battery summer heat, battery terminal corrosion,
won't-start triage, dashboard warning-light colors, TPMS sensor battery),
HVAC (AC not blowing cold, heater not blowing hot), and misc (cabin air
filter, oil change intervals, oil dipstick color, exhaust smoke color,
road-salt brake lines, wiper blades, coolant color, tailpipe condensation,
cloudy headlights, E-Check readiness, repair-authorization questions,
windshield chip, fuel smell in cabin).

**None of these is the static hands-on wobble test** (grabbing a stationary
wheel at the 3-and-9 vs. 12-and-6 clock positions to isolate tie-rod-end
play from wheel-bearing play) — the closest neighbors are `strut-bounce-test`
(a *vertical bounce* check on shocks/struts, different mechanism and a
different part of the suspension) and `wheel-bearing-hum` (an *auditory*
symptom noticed *while driving*, not a static hands-on check). This pack is
distinct from both.

> **This is a file-system + PR-title check, not a substitute for the real
> `reel_jobs` ledger.** An actual DB row for a rejected brief that never got
> a pack written would not show up here — treat "not found in either
> search" as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Wheel wobble test — tie rod end vs. wheel bearing play | Strong — a physical demo hook ("grab it like this") that's rare in the existing library, which leans heavily on "listen for X" or "look for X" rather than "do this with your hands" | Yes — a static garage-floor check, no season dependency | No | ✅ **Selected** |
| Rear differential whine on turns | Weak — niche (RWD/AWD-only symptom, smaller share of the fleet) | Yes | No | Parked |
| Catalytic converter theft / VIN etching | Moderate — timely but a security topic, not a mechanical-diagnosis topic; doesn't fit the account's established "problem → check → shop" format as cleanly | Yes | No | Parked |

"Wheel wobble test" was selected for a genuinely new interaction pattern
(hands-on physical test vs. this library's usual listen/look format), clean
two-way diagnostic structure that reuses the account's proven 5-beat/28s
shape, and confirmed non-overlap with both the merged directory and the
(currently empty) open-PR list.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Side-to-side play at 3 and 9 o'clock can point to a worn tie rod end" | General automotive diagnostic knowledge (this is the standard mechanic's manual-wheel-shake test for steering-linkage play, widely taught, not shop-specific) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read; no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. Phrasing uses "can point to" (approved soft-language pattern, `client/src/lib/facelessReelStudio.ts`) rather than an absolute. |
| "Up-and-down play at 12 and 6 may indicate a worn wheel bearing" | Same — standard mechanical fact, not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "may indicate." |
| "Steering wheel feels loose before the tires even move? Worth checking the whole linkage" | Same | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "worth checking." |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, which sidesteps the channel gap below. |
| No "this is dangerous / you could crash" fearmongering language | `client/src/lib/facelessReelStudio.ts` claim-safety validators (read-only, code file) | **Deliberately avoided.** The script states what the play *can point to*, not a consequence — matches the approved-phrasing list, no absolute or alarmist claim. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" \| "voice" \| "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack, but it would block any future reel script that
wants to quote a price or warranty line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (28s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "This 10-second wheel wobble test tells you what's loose." |
| 2 · SETUP | 0:04–0:10 | "Grab the tire at 3 and 9, rock it side to side. Play there can point to a worn tie rod end." |
| 3 · VALUE | 0:10–0:16 | "Now grab it at 12 and 6, rock it up and down. Play there may indicate a worn wheel bearing." |
| 4 · VALUE | 0:16–0:22 | "Steering wheel feels loose before the tires even move? Worth checking the whole linkage." |
| 5 · CTA | 0:22–0:28 | "This is a steering safety check, not a guess. Nick's Tire and Auto checks it free. Link in bio." |

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

- Beat 1: "car tire close-up garage floor" / "auto mechanic wheel inspection static shot"
- Beat 2: "tire sidewall closeup horizontal shake" / "front wheel tie rod area macro"
- Beat 3: "wheel hub closeup vertical" / "tire and rim macro shot garage"
- Beat 4: "steering wheel closeup car interior static" / "dashboard steering column macro"
- Beat 5: "auto repair shop garage bay interior daylight"

**Note on the demo motion in beats 2–3:** since no human hands appear (per
the standing negative prompt — faceless/handless per pipeline policy), the
wobble motion itself should read as a **subtle camera-vibration / rack-focus
implication** rather than a literal hand-shaking-the-tire shot. `brief.json`
visual prompts are written accordingly.

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

### Editing instructions (CapCut or ffmpeg — either path; both are manual
work for a human, since neither tool is connected to this session)

1. **Layer order (bottom to top):** background video clip per beat →
   ambient garage room-tone / single subtle metallic "clunk" SFX on beats 2
   and 3 (optional, see §6) → voiceover track → burned-in caption track →
   end-card CTA text (beat 5 only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each
   beat boundary (no crossfade — matches the render-integrity gate's
   expectation of distinct per-beat frames, not a dissolve-blurred
   transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** neutral daylight garage grade on beats 1–4 (diagnostic,
   procedural mood matching the topic), warm shift on beat 5 (CTA, inviting
   shop interior).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 28s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow camera move or
   subtle drift/vibration, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 28s (within the 15–60s target range and the account's
  25–30s CTA-block convention, per prior packs)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and see §1's guardrail-order
  note if today's feed slot is already consumed (this is the **10th** pack
  dated 2026-08-20 in this directory; the account's real feed cap is 2
  posts/day, so at most 2 of today's 10 packs can post today regardless of
  which gets chosen)
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone who's been ignoring a
  wobble"), matching the account's corrected objective (a SAVE-oriented CTA
  measured `saved = 0.00` across the account's first 8 reels, per an earlier
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
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. With
9 other packs already dated today, the feed cap is the guardrail most
likely to actually bind — see the posting-slot note in §4.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, same one
noted in every prior pack — not a new finding). This pack sidesteps it
deliberately rather than asserting a track is cleared: **no music bed is
assigned.** The reel is voiceover + captions + two optional royalty-free
soft metallic "clunk" SFX cues (beats 2 and 3), which also scores well on
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
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (60/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> This 10-second wheel wobble test tells you what's loose.
>
> Grab the tire at 3 and 9, rock it side to side — play there can point to
> a worn tie rod end. Grab it at 12 and 6, rock it up and down — play there
> may indicate a worn wheel bearing.
>
> Steering wheel feels loose before the tires even move? Worth checking the
> whole linkage.
>
> This is a steering safety check, not a guess. Send this to someone who's
> been ignoring a wobble.
>
> #cartips #clevelandohio #carmaintenance #autorepair #steeringsafety

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Two 10-second wheel checks tell you if it's your tie rods or your
> wheel bearings — before you spend a dime guessing."
> Caption: Side-to-side play at 3 and 9 = tie rod end. Up-and-down play at
> 12 and 6 = wheel bearing. Different parts, different fix, different cost.
> CTA: Not sure which one you've got? Call (216) 862-0005 or stop by 17625
> Euclid Ave — we check it free.

**Ad-ready variant B (question-forward):**

> Hook: "Does your steering wheel feel a little loose before the tires even
> turn? That's not normal — and it's a 10-second check to find out why."
> Caption: A worn tie rod end and a worn wheel bearing feel almost the
> same from the driver's seat but need completely different repairs.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (60/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on the
same two dimensions every prior pack in this directory has hit —
**sourced fact** (no `EvidenceRecord` in `evidenceResolver.ts` currently
backs the tie-rod/wheel-bearing triage claims, and that store wasn't and
couldn't be queried live this run — no DB access) and **winning concept
≥57/60** (`scoreReelConcept()` was not invoked, so this dimension is scored
0 rather than assumed passing). Both gaps require a live server/DB this
session does not have — they are not fixable by rewriting the script
further.

Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"wheel wobble test: tie rod end vs wheel bearing
play"}`, let the server re-score and re-render for real, and only then move
toward publish.

**Backlog status (see §1): the open reel-pack PR queue is currently
empty** (down from 17 at 0900 today) — this is the first firing in several
days where a new pack adds throughput rather than unreviewed inventory.
That said, **10 packs are now dated 2026-08-20 in this directory alone**,
against an account feed cap of 2 posts/day — the standing recommendation
from this morning's status note (batch-review cadence, and consider
right-sizing this task's firing interval so idea generation doesn't keep
outpacing review/merge/post throughput) still applies and is repeated here,
not superseded by the fact that the PR queue happens to read zero at this
exact moment. This session did not merge, close, or otherwise touch any
other PR — that remains outside this run's assigned scope.
