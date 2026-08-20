# Reel production pack — "Heater blows cold, not hot" (2026-08-20)

Scheduled-task run · 2026-08-20 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **NOHEAT**

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
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session's container; this is a fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` credentials | **Not present** | `env \| grep -Ei "HIGGSFIELD\|REEL_\|ADMIN_API_KEY\|OPENAI\|DATABASE_URL"` returned nothing this run. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** — the free local-ffmpeg lane, not Higgsfield/Seedance. Last-known, not live-reconfirmed this run. |
| `REEL_GENERATION_ENABLED` | Not read live | No server process to query. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| ChatGPT (external LLM) / CapCut (desktop editor) | Not available | No such tool is connected to this session; this pack substitutes ffmpeg-equivalent assembly instructions a human can execute in CapCut manually (§4). |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is.

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/                                → 37 merged packs
    search_pull_requests "reel pack in:title" is:open                 → 14 open PRs

**Backlog note (better than the prior run flagged, not worse):** the
2026-08-19 pack in this same directory reported 52 open PRs and 10
consecutive prior runs that couldn't justify a new topic. That number is now
**14 open**, with the other ~38 having merged since — the backlog is being
worked down, not growing unboundedly. Still worth an operator glance at the
14 open drafts periodically, but this is not the escalation the last pack
raised.

Merged-pack topics (37, on disk) plus the 14 currently-open PR titles were
both reviewed for overlap. Covered: tire (penny test, expiration, tread
fingerprint, rotation, sidewall bulge, spare-tire mileage, plug-vs-patch,
tread-depth rain-vs-snow, road-trip check, summer/cold-weather pressure,
all-season-vs-winter, uneven wear), brakes (squealing-vs-grinding, brake
fluid moisture, warped rotors/steering shake, spongy pedal), engine/drivetrain
(check-engine light, serpentine belt, timing belt, CV joint click, wheel
bearing hum, power steering whine, transmission fluid color, strut bounce,
why-car-pulls, engine overheating, spark-plug stoplight shake, motor mount,
sway bar/ball joint clunk, metallic rattle/heat shield), electrical (battery
summer heat, battery terminal corrosion, won't-start triage, dashboard
warning-light colors, TPMS sensor battery), and misc (cabin air filter, oil
change intervals, exhaust smoke color, road-salt brake lines, wiper blades,
coolant color, tailpipe condensation, headlight yellowing, E-Check
readiness, repair-authorization questions, windshield chip, AC not blowing
cold). **"Heater blows cold, not hot" is not among any of these** — it is
the mechanical mirror-image of the merged AC-not-blowing-cold pack (coolant
flow / thermostat / blend-door actuator, not refrigerant charge / compressor
clutch), and distinct from every open-PR topic.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Heater blows cold, not hot (coolant / thermostat / blend door) | Strong — mirrors the merged AC pack's format, seasonally timely as Cleveland heads into fall | Yes, sharpens seasonally each autumn | No | ✅ **Selected** |
| Radiator fan not kicking on (overheating at idle) | Moderate — overlaps thematically with the open "engine overheating — first 60 seconds" PR | Yes | Overlapping, not identical — deprioritized to avoid thematic collision while that PR is still open | Parked |
| Rear differential whine on turns | Weak — niche (RWD/AWD-only symptom, smaller share of the fleet) | Yes | No | Parked |

"Heater blows cold" was selected for universal seasonal relevance (every
driver in Cleveland/Eastern-time weather will hit this by late fall), a
clean three-way diagnostic structure that reuses the account's proven
5-beat/28s shape without inventing new structure, and confirmed non-overlap
with both the merged directory and the 14 open PRs.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Cold at idle, better on the highway → can point to low coolant" | General automotive diagnostic knowledge (coolant-flow-dependent heater core airflow warming is a standard, widely taught heuristic) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read; no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. Phrasing uses "can point to" (approved soft-language pattern, `client/src/lib/facelessReelStudio.ts`) rather than an absolute. |
| "Never gets warm, no matter what → may indicate a stuck thermostat" | Same — standard mechanical fact, not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "may indicate." |
| "Warm, then a click, then cold → worth checking the blend door" | Same | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "worth checking." |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, which sidesteps the channel gap below. |

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
| 1 · HOOK | 0:00–0:04 | "Heat blowing cold? The clue is in when it happens." |
| 2 · SETUP | 0:04–0:10 | "Cold at idle, better on the highway? That can point to low coolant." |
| 3 · VALUE | 0:10–0:16 | "Never gets warm, no matter what? That may indicate a stuck thermostat." |
| 4 · VALUE | 0:16–0:22 | "Warm air, then it clicks and goes cold? Worth checking the blend door." |
| 5 · CTA | 0:22–0:28 | "Don't guess before winter hits. Nick's Tire and Auto checks all three free. Link in bio." |

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

- Beat 1: "car heater dashboard controls cold morning" / "windshield breath fog cold car interior"
- Beat 2: "coolant reservoir under hood macro" / "engine bay coolant tank closeup"
- Beat 3: "dashboard temperature gauge closeup" / "car instrument cluster cold gauge"
- Beat 4: "dashboard air vent closeup car interior" / "car HVAC vent macro shot"
- Beat 5: "auto repair shop garage bay interior daylight"

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
   ambient cold-cabin room-tone / single soft mechanical click SFX on beat 4
   (optional, see §6) → voiceover track → burned-in caption track →
   end-card CTA text (beat 5 only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each
   beat boundary (no crossfade — matches the render-integrity gate's
   expectation of distinct per-beat frames, not a dissolve-blurred
   transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** cooler, slightly desaturated grade on beats 1–4 (diagnostic,
   slightly chilly mood matching the topic), warm shift on beat 5 (CTA,
   inviting shop interior).
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
  note if today's feed slot is already consumed
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone whose car's heat quit
  on them"), matching the account's corrected objective (a SAVE-oriented
  CTA measured `saved = 0.00` across the account's first 8 reels, per the
  earlier brakes pack's finding)

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
soft mechanical click SFX on beat 4, which also scores well on the
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
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (60/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Heat blowing cold? The clue is in when it happens.
>
> Cold at idle, better on the highway — that can point to low coolant.
> Never gets warm no matter what — that may indicate a stuck thermostat.
> Warm air, then it clicks and goes cold — worth checking the blend door.
>
> Don't guess before winter hits. Send this to someone whose car's heat quit
> on them.
>
> #cartips #clevelandohio #carmaintenance #autorepair #wintercarcare

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Heat blowing cold in your car? Three different causes — and only
> one of them means you're low on coolant."
> Caption: Cold at idle but better on the highway = low coolant. Never
> warms up at all = stuck thermostat. Warm, then a click, then cold = blend
> door. Guess wrong and you're still cold next week.
> CTA: Not sure which? Call (216) 862-0005 or stop by 17625 Euclid Ave —
> we check all three free.

**Ad-ready variant B (question-forward):**

> Hook: "No heat in your car and winter's coming — do you know which of
> three parts is actually broken?"
> Caption: Each cause shows up differently, and each one costs differently
> to fix. Guessing means paying for the wrong part first.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (60/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on two
dimensions specifically — **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the coolant/thermostat/blend-door
triage claims, and that store wasn't and couldn't be queried live this
run — no DB access) and **winning concept ≥57/60** (`scoreReelConcept()`
was not invoked, so this dimension is scored 0 rather than assumed
passing). Both gaps require a live server/DB this session does not have —
they are not fixable by rewriting the script further. Unlike the
2026-08-19 pack, this one *does* attempt a designed loop (beat 5 echoes
beat 1's dashboard motif — see `brief.json` `concepts[0].loopIdea`), though
that attempt is self-scored, not scorer-verified.

Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"heater blows cold: low coolant vs stuck thermostat
vs blend door"}`, let the server re-score and re-render for real, and only
then move toward publish.

**Backlog status (see §1): improved since the last pack, not worse.** 14
open reel-pack PRs remain (down from 52 on 2026-08-19; ~38 have merged
since). This is a lighter flag than the last pack raised — worth an
operator glance at the open drafts on a normal cadence, not an urgent
stop-the-line decision. This session did not merge, close, or otherwise
touch any other PR — that remains outside this run's assigned scope.
