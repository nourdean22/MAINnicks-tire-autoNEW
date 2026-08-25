# Reel production pack — "Car shudders when you hit the gas: coil vs. plug" (2026-08-25)

Scheduled-task run · 2026-08-25 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **MISFIRE-SHUDDER**
· no slate file backs this topic (see §2)

**No generation, DB read, or publish call was made against production this run.**
This is a scheduled/automated firing with no live operator present — the operator
skill's hard rule is explicit that a stored scheduled prompt does not authorize
`reel-canary` generation or publish calls, and that repetition-ledger/quality-score
reads against the live database are themselves a production read, not a free
action. This session made none of those calls. See §1 and §9.

The scheduled prompt itself asked generically to "generate a complete
production-ready faceless short-form video workflow" and to check tool
availability (ChatGPT, TTS, Higgsfield, Meta posting, render, CapCut) before
choosing between a rendered file and a production pack. See §1 for that
checklist, answered plainly rather than assumed.

---

## 1 · Tool-availability checklist and mode

Per the scheduled prompt's own instruction to check tools before choosing an
output shape:

| Tool asked about | Available to this session? | Basis |
|---|---|---|
| ChatGPT / an LLM to write the script | Yes — this session itself | Used directly; no external LLM call needed |
| TTS (voiceover generation) | **No** | No TTS MCP tool or `reelVoice.ts` live call is reachable from this Claude Code repo session |
| Higgsfield (AI video generation) | **No** | `getHiggsfieldAccountHealth()` requires the live server process + `HIGGSFIELD_API_KEY`; not reachable here. Also moot — prod is pinned to `template_stock`, not Higgsfield (see below) |
| Meta posting (Instagram/Facebook) | **No** (and would not be used even if reachable) | Protected customer-facing action per root `AGENTS.md`; requires explicit live operator instruction every time, which a scheduled firing never carries |
| Shell / render (ffmpeg) | Partially | Bash/ffmpeg is technically reachable in this container, but there are no source video clips to assemble — nothing to render without the asset-generation step above |
| CapCut or similar editing software | **No** | Desktop/mobile app, not available in this environment |

**Conclusion: tools are missing for a finished render.** Per the scheduled
prompt's own rule ("do not claim a finished file exists unless you have
rendered it — if uncertain, default to the production pack"), this run
produces a **production-ready pack**, not an MP4. This also matches the
operator skill's own instruction for exactly this situation (§"Producing a
pack when the motion route is unavailable").

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops short
of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`) and
short of any live read against the production TiDB database.

**Other capability reads:**

| Capability | Status this run | Why |
|---|---|---|
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md:32` states prod is pinned to **`template_stock`** (verified there 2026-08-11), i.e. the free local-ffmpeg lane, not Higgsfield/Seedance. Treat as last-known, not live-confirmed. |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | Not read live | Would require a live server/DB read; per the skill's hard rule and `prod-db-guard`, not queried this run. |
| Claim-safety pattern banks (`FORBIDDEN_CLAIM_PATTERNS` etc.) | **Actually run**, standalone, against this pack's narration | Pure regex, no DB/network — see §4 and `brief.json.claimSafetyVerification`. This is real verification, not a self-estimate, for this one narrow check. |

**Repetition-ledger context:** `getRecentReelSignals()` was not queried — it
reads the live `reel_jobs` table on production TiDB. Instead, per the
operator skill's collision-avoidance rule, both required checks were run:

1. `ls apps/nickstire/docs/reel-packs/` — **84 prior merged packs**
   (2026-08-14 through 2026-08-23), none titled around ignition coils, spark
   plugs, or misfire.
2. `mcp__github__search_pull_requests`, `is:open "reel pack" in:title` —
   **8 open draft PRs** (#1816–#1825, minus gaps): water pump weep hole,
   turbo whistle, horn fuse/relay, O2 sensor, heater core, head gasket white
   smoke, trunk gas strut, washer fluid pump. None overlap this topic either.

This run's topic — a shudder **under acceleration**, diagnosed as spark plug
vs. ignition coil, with a supporting steady/blinking check-engine-light beat
— is not among any of those 92 titles. **One real adjacency, disclosed
rather than hidden:** `2026-08-20-idle-shake-spark-plug-motor-mount` covers a
shudder **at idle**, with spark plug as one of two candidate causes (the
other being a motor mount, not a coil). The trigger condition (idle vs.
under-acceleration) and second suspect (motor mount vs. ignition coil)
differ, but both packs name "spark plug" as a candidate — a human reviewer
should weigh whether that's close enough to skip this pack. This is a
file-system + PR-search check, not a substitute for the real ledger — a
rejected `reel_jobs` brief that never produced a pack would not show up
here, so treat "not found" as directional, not a guarantee of zero
repetition.

**Volume flag, stated plainly rather than added to silently:** this
directory already holds 84 merged packs plus 8 pending, produced over
roughly ten days with no evidence in this checkout of a human curation or
posting cadence keeping pace — the account's actual feed cap is 2 posts/day
per `RESERVATION_FEED_CAP` (§5). That is a ~90:1 ratio of packs authored to
plausible daily posting slots. This is worth an operator's attention as a
process question (is a slate/backlog the intent, or is this scheduled task
firing more often than the content pipeline can consume?) — not something
this run's mandate covers deciding on its own.

---

## 2 · Candidate scores and selection

No slate file (`REEL-SLATE-*.md`) currently lists unclaimed items — the
directory listing in §1 shows the two most recent slate-backed runs already
exhausted their items days ago, and no newer slate exists in
`apps/nickstire/docs/`. Topic selection here is ad hoc: a common,
evergreen driver symptom not yet covered by title or close paraphrase.

| Candidate | Hook strength | Evergreen? | Overlap risk | Selected? |
|---|---|---|---|---|
| Misfire shudder — coil vs. plug | Strong — a relatable "car feels wrong" moment with a clean two-suspect structure and a built-in urgency beat (steady vs. blinking CEL) | Yes | Low — one partial adjacency to idle-shake-spark-plug-motor-mount (see §1), different trigger condition and second suspect | ✅ **Selected** |
| Thermostat stuck closed, engine overheats | Moderate | Yes | Moderate — brushes against `engine-overheating-first-60-seconds` and `radiator-fan-idle-overheat`, both already merged | Parked |
| Exhaust manifold gasket tick on cold start | Weak — quieter, less urgent hook | Yes | Low | Parked |

Misfire/coil-vs-plug was selected for the strongest hook (a symptom nearly
every driver has felt) and the lowest overlap with the 92 already-produced
or pending titles, over two candidates that sit closer to existing
merged packs.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A worn spark plug or a tired ignition coil can point to" a misfire | Standard automotive mechanical knowledge (a misfire is an ignition-side or fuel-side failure; spark plug and ignition coil are the two most common ignition-side causes) | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read). Phrasing uses "can point to" — an approved soft-diagnostic pattern, not an absolute "this means," which is the correct hedge for an unverified-in-store claim. |
| "That level of misfire can damage your catalytic converter" | Standard automotive mechanical knowledge (an active misfire dumps unburned fuel into the exhaust stream, which can overheat and damage the catalytic converter) | **UNKNOWN against this repo's evidence store**, same reasoning as above. |
| "Free check, written quote before any work" | `businessFacts.ts` `SEED_FACTS`, `factKey: "repair.pricing_policy"` — code-read only, not a live DB read | **Matches the code default verbatim in substance** ("never quote a number blind — free check, written quote, you don't pay until you say yes"). Note the channel gap below. |
| No warranty, wait-time, guarantee, or stock claim anywhere in the script | Reviewed against the script directly | **N/A — deliberately avoided.** |

**Gap, stated plainly:** `businessFacts.ts`'s `FactChannel` type is
`"sms" | "voice" | "web"` only — there is no `"reel"` channel. This script's
"free check, written quote" line paraphrases the `repair.pricing_policy`
fact's substance rather than quoting a channel-cleared string, since no reel
channel exists to clear it against. Same gap every prior pack in this
directory has flagged, not newly discovered here.

---

## 4 · Full production pack

### Script — word-for-word, timed (32s total, 7 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "Car shakes when you hit the gas?" |
| 2 · SETUP | 0:03–0:08 | "That jolt is called a misfire — one cylinder skipping a beat." |
| 3 · VALUE | 0:08–0:13 | "A worn spark plug or a tired ignition coil can point to it." |
| 4 · VALUE | 0:13–0:18 | "Steady check engine light: one clue, still fine to drive over." |
| 5 · VALUE | 0:18–0:24 | "Blinking? Stop — that level of misfire can damage your catalytic converter." |
| 6 · CTA | 0:24–0:29 | "Do not guess which part it is. We pull the code and check the coil — free check, written quote before any work." |
| 7 · CTA (SAVE freeze) | 0:29–0:32 | "Nick's Tire & Auto — Euclid Ave, Cleveland. Stop by and we'll take a look." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes, claim-safety verification result): [`brief.json`](./brief.json).

**Claim-safety check — actually run, not just estimated.** All five real
pattern banks (`FORBIDDEN_CLAIM_PATTERNS`, `OVERDIAGNOSIS_PATTERNS`,
`FEARMONGER_PATTERNS`, `GENERIC_MARKETING_PATTERNS`, `PRICE_CLAIM_PATTERN`)
were copied verbatim from `client/src/lib/facelessReelStudio.ts` into a
standalone Node script (pure regex, no imports, no DB, no network) and
executed against the full narration text above. **Result: zero findings
across all five banks.** See `brief.json.claimSafetyVerification` for the
method note and result. It is still not the same as invoking
`runSafetyChecks()`/`detectFabricatedStats()` on a live `ReelBrief` object
through the actual module, which was not done this run.

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

- Beat 1: "car tachometer needle acceleration macro" / "rpm gauge close up driving"
- Beat 2: "engine bay idling rough close up" / "car engine vibration hood open"
- Beat 3: "spark plug removal macro" / "ignition coil pack close up"
- Beat 4: "check engine light close up steady"
- Beat 5: "dashboard warning light flashing macro" / "catalytic converter underbody"
- Beat 6: "OBD2 scanner plugged in dashboard" / "mechanic diagnostic tool car"
- Beat 7: "auto repair garage bay interior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; script above is exactly what gets
fed to it, already timed to the 32s budget.

### Captions

[`captions.srt`](./captions.srt) — 13 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration
above. Style: white bold sans, black outline/shadow, bottom-third safe
zone — burn in via ffmpeg `subtitles` filter, never as a generated
in-frame element (Seedance/Higgsfield can't spell reliably, and M10
preflight blocks generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat →
   ambient room-tone/SFX (optional, see §6) → voiceover track → burned-in
   caption track → end-card CTA text (beat 7 only, shop name + address).
2. **Assembly:** concatenate the 7 beat clips in order, cut hard on each
   beat boundary (no crossfade — matches the render-integrity gate's
   expectation of distinct per-beat frames, not a dissolve-blurred
   transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** neutral/slightly cool cabin tone on beats 1–2, bright
   clinical work-light on beat 3 (parts macro), calm cool tone on beat 4
   ("steady" state), shift warmer/more saturated red-amber on beat 5
   ("blinking" urgency), neutral garage tone on beat 6, warm inviting shift
   on beat 7 (CTA).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 32s, video-stream duration
   within 0.75s of 32s, ≥80% of expected 30fps frame count, ≥3 distinct
   MD5s among 5 sampled frames (motion proof — no static/looped single
   image; every beat here is deliberately a camera move, part swap, or
   blink-state change, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 32s (within the 15–60s target range)
- **Posting slot:** do not schedule ad hoc. Check whether today's feed-post
  cap (2/day, §5) is already claimed by `dailyReelPost.ts` (if
  `REEL_AUTOPOST_ENABLED=true`) or by one of the 8 open-PR packs landing
  first, before this one is queued.
- **Caption/hashtags:** see §8 below
- **CTA type:** SAVE/informational close (see `ctaTypeNote` in `brief.json`)

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live
balance check):

| Route | Per-unit cost | 7-beat estimate |
|---|---|---|
| `template_stock` (**current prod pin** per REEL-PIPELINE.md) | $0/clip, local ffmpeg | **$0** |
| `seedance_clip` | $0.25/clip (labeled ASSUMPTION in source — unverified) | ~$1.75 |
| `veo_second_720p` | $0.10/sec | ~$4.55 (7 clips × ~6.5s avg) |
| Voiceover (`elevenlabs_vo`) | $0.05 | $0.05 |
| Brief compile (`gemini_brief`) | $0.01 | $0.01 |

**Estimated total for this pack on the actual prod-pinned route:** ~$0.06
(VO + brief only; clips are free on `template_stock`). This is an
operator-tunable estimate, not a metered price — treat as directional.

**Daily budget ceiling:** `UNKNOWN` — `maxGenerationCostPerDayUsd` lives in
the latest `autonomy_policy_versions` row, which was not read this run
(live DB). Account balance (`getHiggsfieldAccountHealth().balanceCredits`)
is likewise `UNKNOWN` — not probed.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. With
8 packs already sitting as open PRs and this making a 9th unmerged pack,
several of these should be expected to actually trigger once real
enqueues are attempted — this run does not resolve that queue, only adds
to it, per the volume flag in §1.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, same as
every prior pack in this directory). This pack sidesteps it deliberately
rather than asserting a track is cleared: **no music bed is assigned.**
The reel is voiceover + captions + one optional royalty-free ambient/SFX
layer (garage/engine-bay room tone, one subtle diagnostic-tool beep under
beat 6), which also scores well on the pipeline's muted-first requirement
since the captions alone carry full meaning. If the operator wants a music
bed, that requires a specific track with asset ID, source, license scope,
territory, and expiry tracked by hand — this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED`
pending an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Claim-safety pattern banks (forbidden/overdiagnosis/fearmonger/generic/price) | `facelessReelStudio.ts` detectors | **PASS** | Actually executed (regex copied verbatim, run standalone) against the full narration — zero findings. See §4 and `brief.json.claimSafetyVerification`. |
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (59/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption:**

> Car jerk or shudder when you hit the gas?
>
> That's a misfire — one cylinder skipping a beat. A worn spark plug or a
> tired ignition coil can point to it.
>
> Steady check engine light? One clue, still fine to drive over.
> Blinking? Stop — that level of misfire can damage your catalytic
> converter.
>
> Do not guess which part it is. Free check, written quote before any
> work.
>
> #misfire #checkenginelight #cartips #autorepair #clevelandohio

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Why does my car shudder when I hit the gas?"
> Caption: A jolt under acceleration usually means a misfire — a worn
> spark plug or a tired ignition coil can point to it. Steady light, still
> fine to drive over. Blinking light, stop — it can take out your
> catalytic converter.
> CTA: Not sure which part it is? Stop by 17625 Euclid Ave — free check,
> written quote before any work.

**Ad-ready variant B (question-forward):**

> Hook: "Do you know the difference between a steady and a blinking check
> engine light while your car is shuddering?"
> Caption: One means it can wait a little. The other means pull over. A
> bad-enough misfire can point straight at a spark plug or an ignition
> coil — and if you keep driving on a blinking light, it can cost you the
> catalytic converter too.
> CTA: Bring it by — we'll pull the code and tell you straight, free
> check, written quote before any work.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (59/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on two
dimensions specifically — **loop** (the CTA freeze frame doesn't loop
cleanly back into the hook frame) and **sourced fact** (no `EvidenceRecord`
in `evidenceResolver.ts` currently backs the misfire/coil/catalytic-converter
claims, and that store wasn't queried live this run to check). The
claim-safety pattern banks were actually run and returned clean (§4, §7),
which is a real gate result, not a self-estimate — but that is one gate
among several the real `calculateReelQualityScore()`/
`evaluateReelPublishGate()` still need to clear for real. Not
`PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`, nothing
was generated, rendered, or posted. Not `BLOCKED` outright — the pack is
complete and usable; an operator (or a live-authorized session) can hand it
to the real pipeline via `/api/admin/reel-canary {action:"start",
topic:"car shudders under acceleration — spark plug vs ignition coil"}`,
let the server re-score and re-render for real, and only then move toward
publish.

**Before that happens, an operator should also address §1's volume flag:**
84 merged + 8 pending packs against a 2-post/day feed cap is a queue that
already outpaces posting capacity by roughly two orders of magnitude. Adding
a 9th unmerged pack is consistent with this run's mandate (produce one pack,
avoid duplicating existing titles), but is very unlikely to be the highest-
value action available if the actual bottleneck is publishing throughput,
not idea supply.
