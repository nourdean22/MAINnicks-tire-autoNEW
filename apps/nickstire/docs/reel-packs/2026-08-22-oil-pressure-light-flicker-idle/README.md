# Reel production pack — "Oil pressure light flickers at idle, then goes off" (2026-08-22)

Scheduled-task run · 2026-08-22 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **OILPRESSURE**

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
| `HIGGSFIELD_*` / `REEL_*` / `ADMIN_API_KEY` / `DATABASE_URL` / TTS / Meta credentials | **Not present** | `env \| grep -iE 'higgsfield\|reel\|admin_api_key\|database_url\|openai\|elevenlabs\|instagram\|meta\|capcut'` returned nothing in this session's shell. |
| `ffmpeg` | **Not found** | `command -v ffmpeg` failed in this session's shell — no local render lane either. |
| `hf` (Higgsfield CLI) | **Not found** | `command -v hf` failed. |
| CapCut / GUI editor | **Not found / not available** | No GUI tool in this environment. |
| ChatGPT / external LLM | N/A | This session's own model wrote the script and prompts below — no external LLM call was needed or made. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is. **No MP4 exists.**

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls -d apps/nickstire/docs/reel-packs/2026-*/    → 78 merged pack directories
    search_pull_requests(is:pr is:open "reel pack" in:title)
                                                     → 2 open PRs: #1782 "worn motor mount clunk
                                                       on acceleration" (created 20:36Z), #1783
                                                       "rotten egg exhaust smell, catalytic
                                                       converter running rich" (created 21:32Z)

Neither the 78 merged topics on disk (spanning tires, brakes, battery, AC,
fluids, sensors, and engine-noise diagnostics — most recently a same-day
merge titled "hard brake pedal, vacuum booster leak") nor the two open PR
titles above mention oil pressure warning lights, oil pressure sending
units, or bearing wear from low oil pressure. The closest prior topic on
disk, `2026-08-20-oil-dipstick-color-check`, is about reading oil *color* on
a withdrawn dipstick — a visual check, not a warning-light/sending-unit
diagnosis — so it is adjacent, not duplicate.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition. Only 2 open PRs exist
> today (well under the 5-PR skip threshold prior runs established), so this
> run proceeds to a full pack rather than a status-only note.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Oil pressure light flickers at idle (low oil vs sending unit) | Strong — a widely recognizable, mildly alarming dashboard icon with a genuine "don't ignore this" safety stake; clear macro visual | Yes | No | ✅ **Selected** |
| Timing belt tension/wear check without a warning light | Moderate — good hook but closely adjacent to the merged "timing belt no warning light" and "timing chain rattle cold start" packs | Yes | Thematically adjacent to two merged packs | Parked |
| Windshield washer fluid nozzle clogged | Weak — low urgency, thin diagnostic content, unlikely to earn a strong scroll-stop | Yes | No | Rejected — weak hook |

"Oil pressure light" was selected for a strong, safety-relevant hook (a
warning icon most drivers have seen but may not know the urgency of), a
clean macro visual (dashboard icon + gauge + engine bay) that reads well
muted, and confirmed non-overlap with all 78 merged topics and both open
PRs.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A light that stays solid usually means shut off now" | General automotive diagnostic knowledge (a solid oil pressure light indicates confirmed low pressure vs. an intermittent sensor/connection fault behind a flicker; standard shop-floor distinction) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. |
| "Low oil level is the first thing to check, but a worn oil pressure sending unit can point to this too" | Same — standard automotive diagnostic knowledge, phrased with the approved soft-language pattern "can point to" (`client/src/lib/facelessReelStudio.ts`) rather than asserted as certain | **UNKNOWN against this repo's evidence store**, same reasoning as above. |
| "Low oil pressure can wreck bearings in minutes, not miles" | Standard mechanical-safety knowledge (insufficient oil pressure starves rod/main bearings of lubrication under load, and bearing damage from oil starvation is a fast, not gradual, failure mode) — deliberately hedged with "can," no guarantee of outcome for any individual vehicle | **UNKNOWN against this repo's evidence store**, same reasoning; framed as a general risk, not a diagnosis of the viewer's specific car. |
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
| 1 · HOOK | 0:00–0:04 | "Your oil pressure light just flickered at a stoplight, then went off." |
| 2 · SETUP | 0:04–0:09 | "That flicker matters more than you'd think. A light that stays solid usually means shut off now." |
| 3 · VALUE | 0:09–0:16 | "Low oil level is the first thing to check, but a worn oil pressure sending unit can point to this too." |
| 4 · VALUE | 0:16–0:22 | "Either way, don't keep driving on it. Low oil pressure can wreck bearings in minutes, not miles." |
| 5 · CTA | 0:22–0:27 | "Nick's Tire and Auto can check your level and the sensor same day. Link in bio." |

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
   wide shop shot, then a second hard cut at the end of beat 5 into the
   dashboard-cluster close that mirrors beat 1 (the loop frame — see
   `brief.json`'s `loop` scoring note).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** neutral/slightly cool grade on beats 1–3 (diagnostic,
   dashboard-warning mood), a warmer shift on beat 4 to signal urgency, then
   warm daylight on beat 5's shop shot (CTA, inviting), cooling back down on
   the final loop frame to match beat 1's tone.
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 27s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow macro push-in,
   rack focus, or orbital move, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run — `ffmpeg` is not installed in this session):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 27s (within the 15–60s target range and the account's
  prior 25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and see §5's guardrail-order
  note if today's feed slot is already consumed by the daily autonomous cron
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone whose oil light just
  came on"), matching the account's corrected objective (a SAVE-oriented CTA
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
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (57/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Your oil pressure light just flickered at a stoplight, then went off.
> That matters more than you'd think — a light that stays solid usually
> means shut off now.
>
> Low oil level is the first thing to check, but a worn oil pressure
> sending unit can point to this too.
>
> Either way, don't keep driving on it. Low oil pressure can wreck bearings
> in minutes, not miles.
>
> We can check your level and the sensor same day. Send this to someone
> whose oil light just came on.
>
> #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Oil light flickered, then went off? Don't shrug it off."
> Caption: A worn oil pressure sending unit or a low oil level can both
> trigger it — and low pressure can wreck bearings fast. It's not something
> to wait on.
> CTA: We'll check your level and the sensor same day. Call (216) 862-0005
> or stop by 17625 Euclid Ave.

**Ad-ready variant B (question-forward):**

> Hook: "Do you know the difference between a flickering oil light and a
> solid one?"
> Caption: A flicker can be a sensor fault or genuinely low oil — a solid
> light usually means shut the engine off now. Either way, it's worth
> checking before you drive further.
> CTA: Not sure which one you're looking at? Stop by and we'll take a look,
> free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (57/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor,
specifically on **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the oil-pressure/sending-unit claims,
and that store wasn't and couldn't be queried live this run — no DB
access) and **winning concept ≥57/60** (`scoreReelConcept()` was not
invoked, so this dimension is scored 0 rather than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"Oil pressure light flickers at idle, then goes off:
low oil vs a failing sending unit, and why not to keep driving on it"}`,
let the server re-score and re-render for real, and only then move toward
publish.

**Repetition/backlog note:** before this run the repo carried 78 merged
reel-pack topics and 2 open draft PRs (#1782, #1783), both created within
the last hour and well under the 5-PR skip threshold prior runs
established. This run did not merge, close, or otherwise touch any other
PR — that remains outside this run's assigned scope.
