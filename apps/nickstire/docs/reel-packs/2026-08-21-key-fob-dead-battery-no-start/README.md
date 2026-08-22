# Reel production pack — "Dash lights work, push-button start does nothing: check the key fob first" (2026-08-21)

Scheduled-task run · 2026-08-21 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **FOBBATTERY**

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
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session; fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` / `REEL_*` / TTS / Meta credentials | **Not present** | `env \| grep -iE "HIGGSFIELD\|ADMIN_API_KEY\|DATABASE_URL\|REEL_\|OPENAI\|ANTHROPIC_API\|META_\|INSTAGRAM\|ELEVENLABS\|TTS"` returned nothing in this session's shell (exit 1, no matches). |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (the free local-ffmpeg lane, not Higgsfield/Seedance) as of its last-verified date. Not re-confirmed live this run. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| ChatGPT / external LLM | N/A | This session's own model wrote the script and prompts below — no external LLM call was needed or made. |
| CapCut / GUI editor | Not available | No GUI tool in this environment; editing instructions in §4 are written for a human (or ffmpeg) to execute manually. |
| Adobe-for-creativity video/render tools connected to this session | Present but not used | Using them to actually render would bypass this repo's own repetition ledger, quality-score gate, and evidence store entirely — a worse outcome than a documented pack, and still a real-cost generation action a scheduled firing isn't authorized to take. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is. **No MP4 exists.**

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/                        → 70 merged pack directories (2026-08-14 through 2026-08-21)
    search_pull_requests "... is:pr is:open reel pack in:title" → 3 open draft PRs: #1769, #1770, #1772

**This is a marked improvement over the last status report** (`BACKLOG-STATUS-2026-08-21-0729.md`,
written earlier today), which found **12 open draft PRs** and recommended
batch review or slowing the schedule. Something reviewed 9 of those 12 down
to 3 in the hours since — the backlog is now well under the 5-PR "skip"
threshold that status note (and two before it) proposed, so this run
produces an actual pack rather than another status-only no-op.

Merged topics (70, spanning 2026-08-14 through 2026-08-21) include: penny
test, tire expiration date, tread-wear fingerprint, battery heat in summer,
check-engine light, squealing-vs-grinding brakes, wheel-bearing hum,
balance-vs-alignment, cabin air filter, coolant color, exhaust-smoke color,
oil-change intervals, plug-vs-patch, pothole damage, repair-authorization
questions, road-salt brake-line corrosion, road-trip tire pre-check,
serpentine-belt squeal, tire sidewall bulge, spare-tire mileage, "noises
that mean stop driving now", strut bounce-test, summer-heat tire pressure,
tire rotation, transmission-fluid color test, tread-depth rain-vs-snow,
why-car-pulls, wiper-blade check, AC not blowing cold, all-season-vs-winter
tires, brake-fluid moisture test, cold-weather tire-pressure light,
CV-joint clicking, power-steering whine, TPMS sensor battery, uneven
tire-wear patterns, won't-start (battery/starter/alternator), battery
terminal corrosion, cloudy headlights, dashboard warning-light colors,
E-Check readiness monitors, fuel smell in cabin, heater not blowing hot,
idle shake, lug-nut re-torque, musty AC smell, oil dipstick color check,
radiator fan idle, slow-leak soap test, tailpipe condensation vs. coolant
leak, tie-rod wobble test, tire sidewall numbers, burning-smell diagnosis,
clunk over bumps, engine overheating first 60 seconds, heat-shield rattle,
spongy brake pedal, timing belt no warning light, warped-rotor brake
shake, windshield chip spreads, won't-start diagnosis, AWD one-new-tire,
AC recharge myth, battery parasitic drain, brake pedal sinks overnight,
catalytic converter theft prevention, differential whine on turns, gas cap
check-engine light, valve stem dry rot.

Open draft PRs (3, not yet merged so invisible to `ls`): ABS light on with
brakes still feeling normal (#1772), spark plug wire/coil boot arcing at
night (#1770), stuck PCV valve burning oil with no puddle (#1769).

**"Key fob battery causing a no-start with the dash fully lit" is not
among any of the above.** The existing "won't start (battery/starter/
alternator)" topic is explicitly about the starting circuit failing outright
— dash dim or dead, cranks slow or not at all. This topic's hook is the
opposite symptom set (dash fully illuminated, meaning the car battery is
fine) with a completely different culprit (a small electronics component,
not the starting circuit), so it doesn't restate that pack's diagnostic
logic. It's also distinct from all three open PRs' topics (ABS/brakes,
ignition coil arcing, PCV valve).

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Key fob dead battery causing push-button no-start despite lit dash | Strong — counterintuitive (dash works, so it "should" start), universal on any push-button-start car, clean macro visual (coin cell inside an opened fob) | Yes | No | ✅ **Selected** |
| Windshield washer fluid freezing in cold weather | Weak — low diagnostic tension, mostly a reminder not a "check this" hook | Yes | No, but weaker concept | Parked |
| Sunroof drain clog causing water in the cabin | Moderate — good visual (water dripping) but seasonal-leaning and harder to shoot facelessly without implying a specific failure location | Yes | No | Parked |

"Key fob dead battery" was selected for the strongest counterintuitive hook
of the three (an illuminated dashboard makes a driver assume the battery is
fine, so a no-start reads as mechanical when it's a $-ignored electronics
part), a clean macro visual, and confirmed non-overlap with all 70 existing
topics and the 3 open PRs.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A weak or dead key fob battery can stop a push-button start cold, even with a fully charged car battery" | General automotive knowledge: push-button/keyless-entry ignition systems require a valid RF or NFC signal from the fob to authorize start, independent of the 12V starting-battery circuit — this is standard across most keyless-start vehicles, not shop-specific | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. Phrasing hedged with "can stop," not "will stop." |
| "Most fobs hide a backup key and a spot to hold the fob against the start button" | Same — standard keyless-entry design knowledge, but the exact emergency-start procedure and backup-key mechanism varies by manufacturer | **UNKNOWN against this repo's evidence store**, same reasoning. Deliberately hedged with "most" and points the viewer to their own owner's manual rather than asserting one universal procedure — avoids a claim this script can't verify across every make/model. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, which sidesteps the channel gap noted below. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack, but it would block any future reel script that
wants to quote a price or warranty line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (27s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Dash lights come on fine. Push the start button — nothing happens." |
| 2 · SETUP | 0:04–0:09 | "That's not always a dead car battery. Check your key fob first." |
| 3 · VALUE | 0:09–0:16 | "A weak or dead key fob battery can stop a push-button start cold, even with a fully charged car battery." |
| 4 · VALUE | 0:16–0:22 | "Most fobs hide a backup key and a spot to hold the fob against the start button — check your owner's manual." |
| 5 · CTA | 0:22–0:27 | "Nick's Tire and Auto tests key fob batteries free. Link in bio." |

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
4. **Color:** neutral, slightly cool-toned grade on beats 1–4 (electronics/
   diagnostic mood), warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 27s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow push-in, orbital
   move, or rack focus, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 27s (within the 15–60s target range and the account's
  prior 25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and confirm today's feed slot
  isn't already consumed before scheduling (see §5's guardrail-order note)
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone whose car won't
  start"), matching the account's corrected objective (a SAVE-oriented CTA
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
| `veo_second_720p` | $0.10/sec | ~$2.70 (5 clips × ~5.4s avg) |
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
assigned.** The reel is voiceover + captions + optional ambient
interior/electronic-chime SFX, which also scores well on the pipeline's
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
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (46/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Dash lights come on fine. You push the start button — nothing happens.
>
> That's not always a dead car battery. Check your key fob first.
>
> A weak or dead fob battery can stop a push-button start cold, even with a
> fully charged car battery. Most fobs hide a backup key and a spot to hold
> the fob against the start button — check your owner's manual.
>
> We test key fob batteries free. Send this to someone whose car "won't
> start" for no reason.
>
> #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Dashboard's fully lit. Car still won't start. Why?"
> Caption: Push-button start needs a working key fob battery, not just a
> charged car battery. A dying fob battery can stop the car cold. Check the
> fob before you call a tow truck.
> CTA: Not sure if it's the fob or the battery? Call (216) 862-0005 or
> stop by 17625 Euclid Ave — we test it free.

**Ad-ready variant B (question-forward):**

> Hook: "Ever check your key fob's battery? Most drivers never have."
> Caption: It's a small battery, and it dies quietly — no warning light,
> just a car that suddenly won't start with push-button ignition.
> CTA: Stop by and we'll test it, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (46/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on
several dimensions specifically — **loop** (the CTA frame, a shop garage
bay, doesn't feed back into the HOOK frame, a lit dashboard — no loop plan
was designed), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the key-fob claims, and that store
wasn't and couldn't be queried live this run — no DB access), **keyword**
(this topic's core terms are key fob / push-button start rather than the
tire/auto-repair-generic vocabulary most prior packs score against, and
that wasn't checked live), and **winning concept ≥57/60**
(`scoreReelConcept()` was not invoked, so this dimension is scored 0 rather
than assumed passing).

Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"dash lights work, push-button start does nothing:
check the key fob battery first"}`, let the server re-score and re-render
for real, and only then move toward publish.

**Backlog note, unchanged in kind from every prior pack but improved in
degree:** before this run the open-PR count for this topic family had
dropped from 12 (this morning's status report) to 3 — a real, visible
improvement, not just a recommendation restated. This run adds a 4th open
PR on a confirmed non-duplicate topic; recommend the operator keep the
batch-review cadence going rather than letting the count climb back into
double digits, since the underlying schedule still fires roughly hourly.
