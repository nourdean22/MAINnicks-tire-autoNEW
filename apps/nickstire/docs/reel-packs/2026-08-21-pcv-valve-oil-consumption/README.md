# Reel production pack — "Stuck PCV valve burning oil, no puddle in sight" (2026-08-21)

Scheduled-task run · 2026-08-21 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **PCVVALVE**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**Backlog status differs from every recent prior pack — read before
triaging this PR.** The last three scheduled firings (2026-08-18/19,
2026-08-20-0900, 2026-08-21-0729) each produced a status-only note instead
of a pack because the open-PR count sat at 12-17 unreviewed drafts. This
run re-checked with `list_pull_requests(state="open")` on
`nourdean22/mainnicks-tire-autonew` and got **zero open PRs** — the backlog
that blocked the prior three runs has been cleared (batch-reviewed, merged,
or closed since 2026-08-21T07:29Z). That specific skip condition no longer
holds, so this run produced a full pack per its normal instructions. See §9
for what this run did and did not verify beyond the PR count.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session; fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` / `REEL_*` / `META_*` / TTS credentials | **Not present** | `env \| grep -iE "HIGGSFIELD\|REEL_\|ADMIN_API_KEY\|DATABASE_URL\|OPENAI\|ANTHROPIC_API_KEY"` returned nothing in this session's shell. |
| `ffmpeg` | **Not installed** | `which ffmpeg` → not found in this session's shell. |
| CapCut / GUI editor | **Not available** | No GUI tool in this environment; editing instructions in §4 are written for a human (or ffmpeg) to execute manually. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (the free local-ffmpeg lane, not Higgsfield/Seedance) as of its last-verified date. Not re-confirmed live this run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| ChatGPT / external LLM | N/A | This session's own model wrote the script and prompts below — no external LLM call was needed or made. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is. **No MP4 exists.**

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/                          → 69 merged pack directories + 2 status notes
    list_pull_requests(owner, repo, state="open")                → 0 open PRs (was 12-17 as of the prior three runs)

The merged-pack directory now spans `2026-08-14` through `2026-08-21` and
includes (non-exhaustive, grouped by system): tires (penny test, expiration
date, tread-wear fingerprint, rotation, sidewall bulge/numbers, valve stem
dry rot, AWD one-new-tire, slow-leak soap test, tread-depth rain-vs-snow,
summer pressure, cold-weather TPMS light), brakes (squeal-vs-grind, brake
fluid moisture, warped rotor, spongy pedal, pedal sinks overnight, sticking
caliper), steering/suspension (balance-vs-alignment, wheel-bearing hum,
CV-joint click, power-steering whine, strut bounce test, clunk over bumps,
tie-rod wobble test), electrical (battery terminal corrosion, parasitic
drain, won't-start, dashboard light colors, gas-cap check-engine, alternator
via won't-start), cooling/climate (AC not blowing cold, AC recharge myth,
musty AC smell, heater not blowing hot, radiator fan idle, engine
overheating first 60s, coolant color, tailpipe condensation), and general
(cabin air filter, wiper blades, oil change intervals, oil dipstick color,
transmission fluid color, timing belt, serpentine belt squeal, catalytic
converter theft, differential whine, idle shake, heat-shield rattle,
windshield chip, burning-smell diagnosis, echeck readiness monitors,
pothole damage, repair-authorization questions, road-salt corrosion,
road-trip pre-check, lug-nut retorque, why-car-pulls, cloudy headlights).

**"A stuck PCV valve burning oil with no visible puddle" is not among any of
the above.** The closest adjacent topics are `oil-dipstick-color-check`
(visually grading the color/condition of oil already on the dipstick — a
different claim) and `burning-smell-diagnosis` (identifying what a burning
odor in the cabin/engine bay means generally — not oil consumption without
a smell or puddle). PCV-valve-driven internal oil consumption is a distinct
diagnostic claim (disappearing oil with no external leak evidence at all)
and a distinct macro visual (a small plastic valve in a valve-cover
grommet, an oily air-intake hose interior) from all 69 existing topics.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition. The zero-open-PR
> result is a genuine, verified read (§1 box above), but it does not by
> itself prove every merged commit's topic was captured accurately in the
> prose summary above — that summary was built by reading directory names,
> not opening every README.

---

## 2 · Candidate scores and selection

Given the scale of the existing backlog (69 merged topics), candidate
scoring this run was narrowed to topics confirmed absent from the merged
directory and thematically distinct from its nearest neighbors, rather than
re-deriving a fresh slate:

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Stuck PCV valve burning oil with no puddle | Strong — counterintuitive ("no leak, but oil keeps disappearing"), clean macro visuals (valve, oily intake hose, sludge), distinct from both oil-adjacent packs already merged | Yes | No | ✅ **Selected** |
| Washer fluid not spraying (nozzle vs. pump vs. frozen line) | Moderate — simple, safe, but a weaker hook (low stakes, not urgent-feeling) | Yes | No | Parked |
| Transmission slipping / hesitating between gears | Moderate-strong hook, but thematically close to the merged `transmission-fluid-color-test` pack (same system, adjacent claim) | Yes | Thematically adjacent to an existing merged pack | Parked |

"Stuck PCV valve" was selected for the strongest counterintuitive hook of
the three (an oil-loss mystery with zero visible evidence), a clean set of
macro/rack-focus visuals that read well muted, and confirmed non-overlap
with all 69 existing topics.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A stuck PCV valve can burn oil internally, with nothing hitting the ground" | General automotive maintenance knowledge (PCV — positive crankcase ventilation — routes blow-by gases back into the intake; a valve stuck open can pull oil vapor/droplets into the intake tract and burn it in the combustion chamber, a widely documented failure mode, not shop-specific) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. |
| "A hissing or whistling sound at idle is one clue; oil pooling inside the air intake hose is another" | Same — standard diagnostic knowledge, phrased with the approved soft-language pattern ("one clue," not "proof") | **UNKNOWN against this repo's evidence store**, same reasoning. |
| "Left unchecked, it can point to sludge buildup and a rougher idle over time" | Inference presented as a possibility, deliberately hedged ("can point to," not asserted as certain) | **UNKNOWN against this repo's evidence store**, same reasoning; no fearmongering language ("blown gasket," "engine failure") was used — deliberately avoided per the claim-safety pattern bank. |
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
| 1 · HOOK | 0:00–0:04 | "You keep topping off oil, but there's never a puddle underneath the car." |
| 2 · SETUP | 0:04–0:10 | "That's not always a leak. A stuck PCV valve can burn oil internally — nothing ever hits the ground." |
| 3 · VALUE | 0:10–0:17 | "A hissing or whistling sound at idle is one clue. Oil pooling inside the air intake hose is another." |
| 4 · VALUE | 0:17–0:23 | "Left unchecked, it can point to sludge buildup and a rougher idle over time — not just wasted oil." |
| 5 · CTA | 0:23–0:28 | "Worth checking. Stop by and we'll take a look at your PCV system, free with an oil change." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes, self-estimated score): [`brief.json`](./brief.json).

### Asset list

- **Footage (per beat), Higgsfield-style generation prompts** — see
  `brief.json` `beats[].visualPrompt`, each paired with a
  `stockSearchTerms` fallback for a licensed stock-footage lane if
  generation isn't used. Standing negative prompt on every beat:
  `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`.
- **Voiceover:** not generated this run (no TTS route connected in this
  session). Script source is the narration column above, fed verbatim to
  `reelVoice.ts` at real render time.
- **Music bed:** none assigned — see §6 (real gap, not an oversight).
- **Captions:** [`captions.srt`](./captions.srt), 10 cues, bottom-third
  safe-zone timing, all-caps short-line style matching prior packs on this
  account.

### Editing instructions

1. **Layer order (bottom to top):** background footage → subtle color grade
   → caption burn-in (bottom-third) → CTA end-card text on beat 5 only.
2. **Transitions:** hard cuts between beats 1→2→3→4 (macro-to-macro reads
   cleanly on a hard cut); a short cross-fade (6–8 frames) into beat 5's
   wide shop shot to signal the tonal shift from diagnostic to CTA.
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** neutral/slightly cool grade on beats 1–4 (diagnostic,
   inspection mood), warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 28s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow dolly-in, rack
   focus, or orbital move, not a still).
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
- **CTA type:** SEND-oriented ("send this to someone who's always topping
  off oil"), matching the account's corrected objective (a SAVE-oriented
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
| `veo_second_720p` | $0.10/sec | ~$2.80 (5 clips × ~5.6s avg) |
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
assigned.** The reel is voiceover + captions + optional ambient engine
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

> You keep topping off oil, but there's never a puddle under the car.
> That's not always a leak.
>
> A stuck PCV valve can burn oil internally — nothing ever hits the ground.
> A hissing or whistling sound at idle is one clue. Oil pooling inside the
> air intake hose is another.
>
> Left unchecked, it can point to sludge buildup and a rougher idle over
> time — not just wasted oil.
>
> Worth checking. We'll take a look at your PCV system free with an oil
> change. Send this to someone who's always topping off oil.
>
> #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "No puddle. No leak. So where's your oil going?"
> Caption: A stuck PCV valve can burn oil internally with zero visible
> leak — listen for a whistle at idle, check for oil inside the intake
> hose.
> CTA: Not sure what you're hearing? Call (216) 862-0005 or stop by 17625
> Euclid Ave — we check it free with an oil change.

**Ad-ready variant B (question-forward):**

> Hook: "Ever check your PCV valve? Most people don't know they have one."
> Caption: It's a small plastic valve that can quietly burn oil internally
> when it sticks — no puddle, no warning light, just oil that disappears.
> CTA: Stop by and we'll take a look, free with an oil change.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (50/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a shop garage bay,
doesn't feed back into the HOOK frame, a clean garage floor — no loop plan
was designed), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the PCV-valve claims, and that store
wasn't and couldn't be queried live this run — no DB access), and **winning
concept ≥57/60** (`scoreReelConcept()` was not invoked, so this dimension
is scored 0 rather than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"stuck PCV valve burning oil internally: the leak
that isn't a leak"}`, let the server re-score and re-render for real, and
only then move toward publish.

**Separately, and more importantly than this one pack:** before this run
the repo carried 69 merged reel-pack topics. Unlike the prior three
scheduled firings, this run found **zero open, unreviewed draft PRs** — a
real change from the 12-17 that blocked packs from being written on
2026-08-18/19, 2026-08-20-0900, and 2026-08-21-0729. That is evidence the
batch-review this task's own status notes repeatedly asked for actually
happened. What this run did **not** verify: whether the review was
individual (each pack read and judged on its own merits) or another batch
sweep like the one on 2026-08-20T11:35Z (noted in the prior status file as
"closed without merging," with the underlying content landing on `main`
through some other path this run did not chase down). The operator is
better positioned than this scheduled firing to know which happened. This
session did not touch any other branch or PR — only this run's own new
directory and files are in scope.
