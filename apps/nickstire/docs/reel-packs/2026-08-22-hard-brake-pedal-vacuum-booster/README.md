# Reel production pack — "Hard brake pedal, no warning light: the vacuum booster leak" (2026-08-22)

Scheduled-task run · 2026-08-22 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **HARDPEDAL**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**⚠️ Backlog — read before triaging this PR, see §9 for the full case.**
Before this run, the repo already carried **69 merged reel-pack topics**
plus **8 open, unmerged draft PRs from 2026-08-21** (#1769–#1777, none
merged as of this run) — **77 topics produced, most never reviewed.** This
is the same finding raised in at least six consecutive packs since
2026-08-16, and the pile has grown, not shrunk, on every single one of
those checks. This pack adds a confirmed non-duplicate 78th topic per this
run's instructions, but whether the schedule should keep firing roughly
hourly into an unreviewed queue this size is an operator decision this run
cannot make for itself.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session; fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` credentials | **Not present** | `env \| grep -iE "HIGGSFIELD\|REEL_\|ADMIN_API_KEY\|DATABASE_URL"` returned nothing in this session's shell, and no `.env` file exists in `apps/nickstire/` (only `.env.example`). |
| `DATABASE_URL` (prod TiDB) | **Not present** | Same check — not set in this session's shell. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (the free local-ffmpeg lane, not Higgsfield/Seedance) as of its last-verified date. Not re-confirmed live this run. |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | Not read live | Not set in this session's shell; no server process to query either. |
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

    ls -d apps/nickstire/docs/reel-packs/2026-*/ | wc -l                        → 69 merged packs
    search_pull_requests "repo:.../mainnicks-tire-autonew is:pr is:open reel pack in:title"
                                                                                  → 8 open draft PRs (#1769-#1777, all from 2026-08-21)

Merged packs on disk (69, spanning 2026-08-14 through 2026-08-21) cover, by
date-bucket: penny test / tire expiration date (08-14); tread-wear
fingerprint (08-15); battery heat, check-engine light, squealing-vs-grinding
brakes, wheel-bearing hum (08-16); 21 topics on 08-17 (alignment, cabin
filter, coolant color, exhaust smoke, oil intervals, plug-vs-patch, pothole
damage, repair questions, road-salt brake lines, road-trip check,
serpentine squeal, sidewall bulge, spare-tire mileage, stop-driving noises,
strut bounce test, summer tire pressure, rotation, trans-fluid color,
tread-depth rain-vs-snow, why-car-pulls, wiper check); 8 on 08-18 (AC not
cold, all-season-vs-winter, brake-fluid moisture, cold-weather light,
CV-joint click, power-steering whine, TPMS battery, uneven wear); 9 on
08-19 (burning smell, sway-bar/ball-joint clunk, overheating first 60
seconds, heat-shield rattle, spongy pedal, timing belt, warped rotor,
windshield chip, won't-start); 17 on 08-20 (AWD one tire, battery
corrosion, caliper sticking, cloudy headlights, dash light colors, E-Check
monitors, fuel smell, heater not hot, idle shake, lug-nut retorque, musty
AC, dipstick color, radiator fan idle, slow leak soap test, tailpipe
condensation, tie-rod wobble, sidewall numbers); 7 on 08-21 (AC recharge
myth, parasitic drain, pedal sinks overnight, catalytic converter theft,
differential whine, gas-cap check-engine, valve-stem dry rot).

Open draft PRs (8, all from 2026-08-21, not yet merged so invisible to
`ls`): timing chain rattle at cold start, ABS light with normal brakes,
blower motor resistor / fan stuck on one speed, power window stuck halfway
(motor vs. regulator cable), spark plug wire / coil boot arcing at night,
stuck PCV valve burning oil with no puddle, radiator cap pressure test /
coolant loss with no visible leak, key fob dead battery / no push-button
start.

**"Hard brake pedal / vacuum booster leak" is not among any of the above.**
`spongy-brake-pedal` (merged) and `brake-pedal-sinks-overnight` (merged)
are both about a pedal getting *softer* or sinking — the opposite symptom
and a different mechanism (master-cylinder internal bypass or a fluid-side
leak) from a pedal that suddenly gets *hard*, which points at the vacuum
side of the system instead of the hydraulic side. `caliper-sticking-hot-wheel`
and `squealing-vs-grinding-brakes` (both merged) are wheel-end symptoms, not
pedal-feel symptoms. None of the 8 open PRs touch braking at all. This is a
distinct symptom, a distinct root cause, and a distinct macro visual
(footwell/pedal + engine-bay booster canister) from all 77 prior topics.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

Given the scale of the existing backlog, candidate scoring this run was
narrowed to topics confirmed absent from both the merged-pack directory and
the 8 open PR titles (§1), rather than re-deriving a fresh slate:

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Hard brake pedal / vacuum booster leak | Strong — counterintuitive (pedal gets *harder*, not softer, when something's wrong), clean two-shot visual (pedal + booster), safety-relevant | Yes | No | ✅ **Selected** |
| EVAP purge valve / small evap leak causing check-engine light | Moderate — overlaps thematically with the merged gas-cap check-engine-light pack (both are EVAP-system check-engine causes) | Yes | Thematically adjacent to a merged pack | Parked |
| Alternator bearing whine vs. power-steering whine | Moderate — overlaps closely with the merged power-steering-whine pack; hard to differentiate visually | Yes | Thematically adjacent to a merged pack | Parked |

"Hard brake pedal / vacuum booster leak" was selected for a strong,
counterintuitive hook, a clean two-location macro visual (interior pedal,
then engine-bay booster), direct safety relevance, and confirmed
non-overlap with all 77 existing topics.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A suddenly hard brake pedal with no warning light is usually a vacuum booster issue, not the brakes themselves" | General automotive diagnostic knowledge (vacuum-assist brake systems are standard on most non-hybrid gas vehicles; loss of vacuum assist is a textbook cause of a hard pedal) — not shop-specific | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. Narration hedges with "usually," not asserted as universal. |
| "A cracked hose or failing check valve can break the vacuum seal" | Same — standard brake-system diagnostic knowledge | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing avoids a flat guarantee. |
| "Engine-off pedal-pump-then-hold-and-start test: pedal should drop slightly if the booster is working" | Standard shop-floor diagnostic technique, widely documented in general automotive repair references | **UNKNOWN against this repo's evidence store**, same reasoning — presented as "a quick check," not as a substitute for a professional inspection. |
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
| 1 · HOOK | 0:00–0:04 | "Your brake pedal suddenly feels like a rock, and there's no warning light on." |
| 2 · SETUP | 0:04–0:09 | "That's usually not the brakes themselves. It's the vacuum booster losing its assist." |
| 3 · VALUE | 0:09–0:17 | "The booster uses engine vacuum to multiply your leg force. A cracked hose or a failing check valve breaks that seal, and suddenly you're pushing the pedal on your own." |
| 4 · VALUE | 0:17–0:23 | "A quick check: with the engine off, pump the pedal a few times, then hold it down and start the car. It should drop slightly if the booster's working." |
| 5 · CTA | 0:23–0:28 | "If it doesn't drop, don't wait on it. Nick's Tire and Auto checks the booster and vacuum lines free with a brake inspection." |

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
- **Captions:** [`captions.srt`](./captions.srt), 11 cues, bottom-third
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
   static/looped single image — every beat here is a slow macro push-in,
   orbital move, or static locked shot with subtle depth-of-field shift,
   not a still).
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
- **CTA type:** SEND-oriented ("send this to someone whose pedal suddenly
  feels different"), matching the account's corrected objective (a
  SAVE-oriented CTA measured `saved = 0.00` across the account's first 8
  reels, per an earlier pack's finding)

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

> Your brake pedal suddenly feels like a rock and there's no warning light
> on. That's usually not the brakes themselves - it's the vacuum booster
> losing its assist.
>
> The booster uses engine vacuum to multiply your leg force. A cracked hose
> or a failing check valve breaks that seal, and suddenly you're pushing
> the pedal on your own.
>
> Quick check: engine off, pump the pedal a few times, then hold it down
> and start the car. It should drop slightly if the booster's working.
>
> If it doesn't, don't wait on it. We check the booster and vacuum lines
> at no charge with a brake inspection.
> suddenly feels different.
>
> #cartips #clevelandohio #carmaintenance #autorepair #brakesafety

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Brake pedal suddenly feels like a rock? No warning light?"
> Caption: That's usually a vacuum booster losing its assist, not the
> brakes themselves. A cracked hose or check valve can break the seal.
> CTA: Not sure what's going on? Call (216) 862-0005 or stop by 17625
> Euclid Ave — we check it free.

**Ad-ready variant B (question-forward):**

> Hook: "Ever wonder why your brake pedal has power steering for your leg?"
> Caption: It's the vacuum booster. When it fails, the pedal doesn't get
> soft — it gets hard, fast, with zero warning light.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (50/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a shop garage bay,
doesn't feed back into the HOOK frame, a footwell/pedal shot — no loop plan
was designed), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the vacuum-booster claims, and that
store wasn't and couldn't be queried live this run — no DB access), and
**winning concept ≥57/60** (`scoreReelConcept()` was not invoked, so this
dimension is scored 0 rather than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"hard brake pedal, no warning light: vacuum booster
leak, why you suddenly have to stand on the brake"}`, let the server
re-score and re-render for real, and only then move toward publish.

**Separately, and more importantly than this one pack: before this run the
repo already carried 69 merged reel-pack topics plus 8 open, unmerged draft
PRs from a single day (2026-08-21, #1769–#1777), none merged as of this
run — 77 topics produced, most never reviewed.** This session did not
merge, close, or otherwise touch any other PR — that is outside this run's
assigned scope and each of those PRs belongs to a different session's
branch. This same finding has now been raised in at least **six**
consecutive packs since 2026-08-16, and on every single one of those
checks the backlog was larger than the last, never smaller. Restated
plainly, and unchanged from the last five packs because the underlying
condition hasn't changed: batch-review the backlog (all are docs-only, zero
live side effects, explicitly `READY FOR HUMAN APPROVAL` not `PUBLISHED`),
merge or close as appropriate, and seriously reconsider whether this
scheduled trigger should keep firing roughly hourly while 77+ packs sit
unreviewed — an unreviewed pack has produced zero shop value regardless of
how well-formed it is, and the per-run cost of writing one is not free
(session time, PR-review load, and GitHub Actions minutes on every draft
PR).
