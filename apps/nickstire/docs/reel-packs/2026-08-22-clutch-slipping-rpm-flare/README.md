# Reel production pack — "Clutch slipping: RPM climbs, but the car doesn't speed up" (2026-08-22)

Scheduled-task run · 2026-08-22 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **CLUTCHSLIP**

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
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` credentials | **Not present** | `env \| grep -iE "HIGGSFIELD\|ADMIN_API_KEY\|REEL_\|DATABASE_URL\|META\|INSTAGRAM\|OPENAI\|ELEVEN\|TTS"` returned nothing in this session's shell. |
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

    ls -d apps/nickstire/docs/reel-packs/2026-*/ | wc -l                        → 78 merged packs
    search_pull_requests "repo:.../mainnicks-tire-autonew is:pr is:open reel pack in:title"
                                                                                  → 3 open draft PRs (#1782, #1783, #1785, all from today, 2026-08-22)

**Backlog note — materially better than the last several packs reported.**
Prior packs (2026-08-16 through 2026-08-22) repeatedly flagged a growing,
unreviewed backlog (peaking at 37 open drafts, 77 total topics with only 8
merged that day). As of this run the open-draft count is down to **3**,
meaning the backlog has been actively worked down since the last check
rather than continuing to grow. No backlog escalation is warranted this run.

Open draft PRs today (3, none overlapping this topic): oil pressure light
flickering at idle (#1785), worn motor mount clunk on acceleration (#1782),
rotten-egg exhaust smell / catalytic converter running rich (#1783). None of
these are about clutch engagement or manual-transmission symptoms.

Merged packs (78, spanning 2026-08-14 through 2026-08-22) cover tire wear,
brakes, cooling, electrical, and general diagnostics extensively (see prior
packs' §1 for the full topic list) — **no existing merged pack or open draft
addresses clutch slip, manual-transmission engagement, or an RPM/speed
mismatch.** This is the first manual-transmission-specific topic in the
catalog.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Clutch slipping — RPM climbs, car doesn't speed up | Strong — visceral, easy-to-picture symptom (revving with no acceleration), clean macro visuals (tach gauge, gear shifter, worn disc), zero overlap with any of 81 existing topics | Yes | No | ✅ **Selected** |
| Manual transmission grinding on downshift | Moderate — narrower audience (manual-only, and specifically downshift-only), thinner visual variety than clutch slip | Yes | No, but narrower | Parked |
| Clutch pedal going soft/spongy (hydraulic clutch master cylinder) | Moderate — good hook, but risks reading as a near-duplicate of the merged `spongy-brake-pedal` and `brake-pedal-sinks-overnight` packs (same "pedal goes soft" framing, different pedal) | Yes | Thematically adjacent to two merged packs | Parked |

"Clutch slipping" was selected for the strongest, most visceral hook (an
everyday, easily recognized symptom), a genuinely new topic category
(manual-transmission engagement, never touched before), and three distinct,
inspectable macro visuals (tachometer, shifter, clutch disc) with no overlap
risk against any of the 81 prior topics.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A gap between RPM and road speed under load is a classic sign of a slipping clutch" | General automotive diagnostic knowledge (clutch slip is a textbook symptom in every manual-transmission repair reference) — not shop-specific | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. Narration hedges with "classic sign," not asserted as a certain diagnosis. |
| "Worn friction material or an oil leak causes the disc to slide instead of grip" | Standard clutch-system diagnostic knowledge (friction-plate wear and rear-main/transmission-input-seal oil contamination are the two textbook causes of slip) | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing stays descriptive, not a guaranteed diagnosis. |
| "Flat-road, steady-speed, firm-throttle test distinguishes slip from a weak engine" | Standard shop-floor diagnostic technique, widely documented in general automotive repair references | **UNKNOWN against this repo's evidence store**, same reasoning — presented as "a quick check," not a substitute for a professional inspection, and framed as something to do on an empty road for safety. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** CTA uses the approved soft phrase "stop by and we'll take a look" rather than inventing a specific free-service claim this shop hasn't confirmed for clutch diagnostics. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack.

---

## 4 · Full production pack

### Script — word-for-word, timed (27s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "You press the gas, the engine revs up, but the car barely picks up speed." |
| 2 · SETUP | 0:04–0:09 | "That gap between engine speed and road speed is a classic sign of a slipping clutch." |
| 3 · VALUE | 0:09–0:17 | "The clutch disc is supposed to lock the engine to the transmission solid. Once the friction material wears thin, or gets soaked in a small oil leak, it starts to slide instead of grip." |
| 4 · VALUE | 0:17–0:23 | "A quick check: on a flat, empty road, hold a steady speed and press the gas firmly. If the RPM jumps but the car doesn't respond, that's slip, not a weak engine." |
| 5 · CTA | 0:23–0:27 | "Worth checking before it gets worse. Stop by and we'll take a look." |

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
4. **Color:** neutral, slightly warm-mechanical grade on beats 1–4
   (diagnostic, garage/dashboard mood), warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 27s, ≥80% of expected 30fps
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
- **Duration:** 27s (within the 15–60s target range and the account's
  prior 25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and see §5's guardrail-order
  note if today's feed slot is already consumed
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone whose gas pedal feels
  disconnected from their speed"), matching the account's corrected
  objective (a SAVE-oriented CTA measured `saved = 0.00` across the
  account's first 8 reels, per an earlier pack's finding)

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
assigned.** The reel is voiceover + captions + an optional faint engine-rev
sound effect under beat 1 only, which also scores well on the pipeline's
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
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (50/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> You press the gas, the engine revs up, but the car barely picks up speed.
> That gap between RPM and road speed is a classic sign of a slipping
> clutch.
>
> The clutch disc is supposed to lock the engine to the transmission solid.
> Once the friction material wears thin, or gets soaked in a small oil
> leak, it starts to slide instead of grip.
>
> Quick check: on a flat, empty road, hold a steady speed and press the gas
> firmly. If the RPM jumps but the car doesn't respond, that's slip, not a
> weak engine.
>
> Worth checking before it gets worse. Stop by and we'll take a look. Send
> this to someone whose gas pedal feels disconnected from their speed.
>
> #cartips #clevelandohio #carmaintenance #autorepair #manualtransmission

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Engine revving, but the car's not speeding up?"
> Caption: That's a classic slipping-clutch symptom — worn friction
> material or an oil leak keeps the disc from locking up solid.
> CTA: Not sure what's going on? Call (216) 862-0005 or stop by 17625
> Euclid Ave — we'll take a look.

**Ad-ready variant B (question-forward):**

> Hook: "Why does your car feel like it's slipping in gear?"
> Caption: The clutch is supposed to lock your engine to your
> transmission. When it can't anymore, RPM climbs but speed doesn't.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (50/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a shop garage bay,
doesn't feed back into the HOOK frame, a tachometer closeup — no loop plan
was designed), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the clutch-slip claims, and that
store wasn't and couldn't be queried live this run — no DB access), and
**winning concept ≥57/60** (`scoreReelConcept()` was not invoked, so this
dimension is scored 0 rather than assumed passing).

Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"clutch slipping in a manual transmission: RPM
climbs but the car doesn't speed up"}`, let the server re-score and
re-render for real, and only then move toward publish.

**Backlog is healthy this run — no escalation needed.** Open draft PR count
dropped from a peak of 37 (2026-08-20) to 3 as of this run, meaning the
backlog raised in six-plus consecutive prior packs has been actively worked
down. This session did not merge, close, or otherwise touch any other PR —
that remains outside this run's assigned scope. Continued periodic
batch-review of the small remaining queue (3 open drafts, all docs-only,
zero live side effects) is still worth keeping up, but the scale concern
raised in prior packs no longer applies at this queue depth.
