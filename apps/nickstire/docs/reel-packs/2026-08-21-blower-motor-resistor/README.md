# Reel production pack — "Blower motor resistor: fan stuck on one speed" (2026-08-21)

Scheduled-task run · 2026-08-21 · mode `INTELLIGENCE`/`SCHEDULED` (pack only,
per `.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword
**FANSPEED**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**Backlog check, current as of this run:** 69 merged reel-pack topics on
disk plus 6 open, unreviewed `reel pack: ...` draft PRs from today alone
(#1769, #1770, #1772, #1773, #1774, #1775, created roughly hourly between
16:32Z and 22:30Z). The most recent prior pack (`2026-08-21-radiator-cap-pressure-test`,
PR #1775) found the open count had fallen from 12 at a 07:29Z status report
to 5 by ~21:31Z — the count is oscillating in the single digits as review
keeps pace with production, not climbing unboundedly. This run does not
repeat the "pause the schedule" recommendation from earlier in the week;
it's worth re-raising only if the open count climbs back into double
digits on a future run. See §9 for today's running total.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `INTELLIGENCE`/`SCHEDULED` producing a full `PRODUCTION`-shaped
pack. Stops short of any `/api/admin/reel-canary` call
(`start`/`advance`/`qa`/`publish`) and short of any live read against the
production TiDB database, per the operator skill's hard rule for a
non-live, scheduled firing.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` / `REEL_*` / TTS / Meta env vars | **Not present** | `env \| grep -iE "HIGGSFIELD\|REEL_\|ADMIN_API_KEY\|DATABASE_URL\|OPENAI\|ELEVEN\|META_\|INSTAGRAM\|FACEBOOK"` returned nothing in this session's shell. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `apps/nickstire/docs/operations/REEL-PIPELINE.md:32` states prod reads `template_stock` (verified 2026-08-11), **not** `higgsfield` — the paid lane was dropped; the free local-ffmpeg lane is what actually renders in prod today. |
| `ffmpeg` / CapCut / any local render tool | **Not available** | `which ffmpeg` returned nothing in this session's shell; no GUI editor exists in this environment either. |
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session; fresh repo checkout, not the running app. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless of credentials. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| ChatGPT / external LLM | N/A | This session's own model wrote the script and prompts below — no external LLM call was needed or made. |

**Conclusion: this run has zero live motion route and zero local render
tool.** Per the skill's "Producing a pack when the motion route is
unavailable" section, the correct output is a full production-ready
pack — not a claimed render, and not a silently weaker deliverable. That is
what §4 below is. **No MP4 exists.**

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/                    → 69 merged pack directories
    search_pull_requests "repo:.../mainnicks-tire-autonew is:pr is:open reel pack in:title"
                                                            → 6 open draft PRs (#1769, #1770, #1772, #1773, #1774, #1775)

Open PR topics (6, all created today): stuck PCV valve burning oil with no
puddle (#1769), spark plug wire/coil boot arcing at night (#1770), ABS light
on with brakes still normal (#1772), key fob dead battery with dash still
lit / no push-button start (#1773), power window stuck halfway — motor vs.
regulator cable (#1774), radiator cap pressure test — coolant loss with no
visible leak (#1775). None overlap "blower motor resistor."

Merged HVAC-adjacent topics already on disk: `ac-not-blowing-cold`,
`heater-not-blowing-hot`, `musty-ac-smell-evaporator-vs-filter`,
`ac-recharge-myth-sealed-system`, `cabin-air-filter`. All four of the first
group are about airflow **temperature** (hot/cold/smell/refrigerant) —
none addresses a fan that is at full airflow and full temperature but
**stuck on one speed setting**, which is a distinct electrical-circuit
fault (the resistor/relay path) rather than a refrigerant, core, or filter
issue. `#1775`'s own candidate table this morning explicitly PARKED
"heater core smell / sweet smell in cabin" as "thematically adjacent to
`fuel-smell-in-cabin`" — this pack respects that same judgment and does not
revisit it; blower-speed failure is a different symptom and a different
part entirely.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Blower motor resistor failure (fan stuck on high, dead on low/medium) | Strong — counterintuitive ("full blast still works, everything else is dead"), clean macro visual on a part almost no driver has seen | Yes | No | ✅ **Selected** |
| Power steering fluid low with no visible leak (hard steering, no puddle) | Moderate — visual is thinner (a fluid reservoir line) and thematically close to the merged `power-steering-whine` pack (same system, different symptom) | Yes | Thematically adjacent to an existing merged pack | Parked |
| Thermostat stuck open (engine never reaches temp, weak heat) | Moderate — harder to shoot as a macro without disassembly, per the same note in the 2026-08-21 radiator-cap pack's own candidate table | Yes | No, but a weaker visual candidate, carried forward unselected again | Parked |

"Blower motor resistor" was selected for a strong counterintuitive hook (one
speed setting works perfectly while the others are completely dead — most
drivers assume the whole fan motor is broken), a clean macro visual on an
unfamiliar part, and confirmed non-overlap with all five HVAC-adjacent
packs already on disk.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "The [blower motor] resistor steps the fan down to low and medium" | General automotive HVAC electrical design (resistor-pack blower circuits are standard on most non-PWM systems; not shop-specific) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. |
| "High speed often skips it entirely, so high keeps working while every other speed goes dead" | Same — standard automotive electrical knowledge, hedged with "often" since some vehicles use a PWM control module instead of a resistor pack, where this specific failure pattern doesn't apply | **UNKNOWN against this repo's evidence store**, same reasoning. Deliberately hedged, not stated as universal. |
| "Ignoring it can wear the motor out sooner" | Inference presented as a possibility ("can"), not a certainty | **UNKNOWN against this repo's evidence store**, same reasoning; uses the approved soft-language pattern from `client/src/lib/facelessReelStudio.ts` ("can," not "will"). |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, which sidesteps the channel gap below. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack.

---

## 4 · Full production pack

### Script — word-for-word, timed (27s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Your heat or A/C only blows on one speed, usually the highest." |
| 2 · SETUP | 0:04–0:09 | "That's not a broken fan. It's usually the blower motor resistor." |
| 3 · VALUE | 0:09–0:17 | "The resistor steps the fan down to low and medium. High speed often skips it entirely, so high keeps working while every other speed goes dead." |
| 4 · VALUE | 0:17–0:22 | "Ignore it and the motor keeps pulling full power every time the fan runs, which can wear it out sooner." |
| 5 · CTA | 0:22–0:27 | "Nick's Tire and Auto checks the blower circuit free with a heating and A/C inspection. Link in bio." |

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
   gate):** container duration within 0.75s of 27s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow push-in, orbital
   move, or rack focus, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run — no `ffmpeg` binary is present in this session either):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 27s (within the 15–60s target range and the account's
  prior 22–28s CTA-block convention)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and see §5's guardrail-order
  note if today's feed slot is already consumed
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone whose fan only works
  on high"), matching the account's corrected objective (a SAVE-oriented
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
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (51/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Your heat or A/C only blows on one speed, usually the highest. That's not
> a broken fan — it's usually the blower motor resistor.
>
> The resistor steps the fan down to low and medium. High speed often skips
> it entirely, so high keeps working while every other speed goes dead.
>
> Ignore it and the motor keeps pulling full power every time the fan runs,
> which can wear it out sooner.
>
> We check the blower circuit free with a heating and A/C inspection. Send
> this to someone whose fan only works on high.
>
> #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Fan only works on high? That's not the motor."
> Caption: A worn blower motor resistor kills low and medium speed while
> high keeps working fine, since high often bypasses it entirely.
> CTA: Not sure what's going on? Call (216) 862-0005 or stop by 17625
> Euclid Ave — we check the circuit free.

**Ad-ready variant B (question-forward):**

> Hook: "Ever notice your fan only has one real speed?"
> Caption: It's usually a small resistor module, not the blower motor
> itself — a cheap part that gets ignored because "the fan still works."
> CTA: Stop by and we'll check it, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (51/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a shop garage bay,
doesn't feed back into the HOOK frame, a fan-dial macro — no loop plan was
designed), **sourced fact** (no `EvidenceRecord` in `evidenceResolver.ts`
currently backs the resistor-circuit claim, and that store wasn't and
couldn't be queried live this run — no DB access), and **winning concept
≥57/60** (`scoreReelConcept()` was not invoked, so this dimension is scored
0 rather than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"blower motor resistor failure: heat or A/C fan
stuck on one speed"}`, let the server re-score and re-render for real, and
only then move toward publish.

**Backlog, current count:** 69 merged pack topics on disk, plus 6 open
draft PRs from today (#1769, #1770, #1772, #1773, #1774, #1775) plus this
run's new PR once opened — 7 open once this lands. The trend across today
has been an oscillation in the single digits (12 → 5 → 6 → 7) rather than
unbounded growth, so no schedule-pause recommendation this run; worth
re-flagging only if the open count climbs into double digits and stays
there across several consecutive runs.
