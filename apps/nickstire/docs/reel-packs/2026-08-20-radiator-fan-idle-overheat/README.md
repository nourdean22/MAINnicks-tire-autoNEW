# Reel production pack — "Why your car runs hot at red lights (radiator fan test)" (2026-08-20)

Scheduled-task run · 2026-08-20 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **FANIDLE**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**Volume flag, stated plainly:** this is the **10th** reel-pack directory
created today (2026-08-20) and there are **7 open reel-pack draft PRs**
already sitting unmerged (#1738, #1739, #1741, #1742, #1744, #1745, #1746),
created roughly hourly since 12:34 ET. Against the pipeline's real
`RESERVATION_FEED_CAP` of 2 posts/day, today alone has produced content for
~8 days of posting capacity, on top of whatever remains unconsumed from the
36+ prior-day packs. This pack still clears the duplication check (below)
and is complete and usable, but the operator should consider throttling this
scheduled task's firing interval or pausing it until the open-PR backlog is
triaged — repeated hourly firing is generating supply far faster than the
account can consume it.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session's container; this is a fresh repo checkout, not the running app. No `/api/admin/reel-canary` tool is exposed to this session. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` credentials | **Not present** | No live `.env` in this checkout; only `apps/nickstire/.env.example` (placeholder template) exists. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `apps/nickstire/docs/operations/REEL-PIPELINE.md` line 32: prod is pinned to **`template_stock`** (verified there 2026-08-11) — the free local-ffmpeg lane, not Higgsfield/Seedance/Veo. Last-known, not live-reconfirmed this run. |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | Not read live | No server process to query; these gate the cron pulse job, not this session. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No such tool available to this session + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |

**Repetition-ledger context (`getRecentReelSignals()`):** not queried — that
function reads the live `reel_jobs` table on production TiDB, and a DB read
is itself a production action per the skill's hard rule. Used the file/PR
proxies instead (directional, not a substitute for the real ledger), done
live this run:

- `ls apps/nickstire/docs/reel-packs/` — 51 prior directories before this
  one, spanning 2026-08-14 through 2026-08-20 (today's 9 merged so far:
  battery-terminal-corrosion, cloudy-headlights, dashboard-light-colors,
  echeck-readiness-monitors, fuel-smell-in-cabin, heater-not-blowing-hot,
  idle-shake-spark-plug-motor-mount, oil-dipstick-color-check,
  tailpipe-condensation-vs-coolant-leak).
- `mcp__github__search_pull_requests(is:open, "reel pack" in:title)` — 7
  open PRs today: #1738 wheel wobble/tie-rod, #1739 musty AC smell, #1741
  lug-nut re-torque, #1742 one-new-tire-on-AWD, #1744 sticking brake
  caliper, #1745 tire losing air, #1746 reading a tire sidewall.
- `2026-08-19-engine-overheating-first-60-seconds` (yesterday's pack) is the
  closest prior topic — that pack is an emergency-response script (pull
  over, don't open the cap, check for a leak once cool). This pack is a
  **diagnostic-mechanism explainer** for a different, more common symptom
  (running warm specifically at idle/stoplights, not a full boil-over) and
  never overlaps its script lines.

**Radiator-fan engagement at idle is not among any of the above 60 topics
(51 merged + 9 today + 7 open).** It clears the repetition check on both
proxies.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already packed? | Selected? |
|---|---|---|---|---|
| Radiator fan not spinning at idle (why cars run hot at red lights) | Strong — common, mildly alarming, seasonal (relevant now, late-summer heat) | Yes | No | ✅ **Selected** |
| Differential/transfer-case whine noise | Moderate — narrower symptom, less universally experienced | Yes | No | Parked — narrower audience than the fan-at-idle hook |
| Vacuum leak hissing / rough idle | Moderate — diagnosis is genuinely ambiguous without a scan tool, higher claim-safety risk | Yes | No | Parked — harder to keep inside approved soft-language without sounding like a certain diagnosis |
| Any of the 60 already-packed topics | — | — | **Yes** | Excluded outright — would duplicate an existing open or merged pack |

Radiator-fan-at-idle was selected because it survives the repetition check
cleanly, has a concrete, testable mechanism (fan spins or it doesn't) rather
than a vague symptom, and stays entirely inside safe, non-committal
diagnostic language rather than asserting a specific failed part.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Moving, air pushes through the radiator on its own. Stopped, only the fan can cool it" | General automotive engineering fact (radiator airflow at speed vs. reliance on the electric/clutch fan at idle) — not shop-specific | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` not queried live this run (would be a prod DB read). No `EvidenceRecord` citation attached. |
| "If the fan isn't spinning once the engine's warm, that's one clue the fan motor, relay, or coolant temp sensor may need a look" | Same — general mechanical fact, phrased with approved soft language ("one clue," "may need a look") | **UNKNOWN against this repo's evidence store**, same reasoning. Deliberately avoids naming a single certain cause. |
| "Low coolant or a stuck thermostat can cause the same symptom — do not guess which one" | Same — general mechanical fact | **UNKNOWN against this repo's evidence store.** Uses the approved soft-language pattern "do not guess" (`facelessReelStudio.ts` approved list) rather than an absolute. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** Sidesteps the channel gap noted below. |

**Gap, stated plainly (repeated from every prior pack, still unresolved):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
no `"reel"` channel exists. This script doesn't lean on that store for any
priced or warranty fact, so the gap doesn't block this pack. The shop name
used in the CTA ("Nick's Tire and Auto") is the public storefront identity,
treated as allowlisted public-facing information per root `AGENTS.md`, not
as a cleared reel fact. No phone number or street address is spoken.

---

## 4 · Full production pack

### Script — word-for-word, timed (30s total, 5 beats + 3s SAVE freeze)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "Car runs hot at red lights but fine on the highway? Here's why." |
| 2 · SETUP | 0:03–0:09 | "Moving, air pushes through the radiator on its own. Stopped, only the fan can cool it." |
| 3 · VALUE | 0:09–0:16 | "If that fan isn't spinning once the engine's warm, that's one clue the fan motor, relay, or coolant sensor may need a look." |
| 4 · VALUE | 0:16–0:23 | "Low coolant or a stuck thermostat can cause the same symptom — do not guess which one." |
| 5 · CTA | 0:23–0:27 | "Gauge creeping up at idle? Stop by and we'll take a look." |
| — · SAVE (static end card) | 0:27–0:30 | (no narration — on-screen text only) |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per
beat.** Per-beat prompts are in `brief.json`. Standing negative prompt for
every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no API
spend).** Per `REEL-PIPELINE.md`, this is what prod currently renders on.
Search terms for free stock (Pexels/Pixabay/Coverr — search manually; no
specific clip URLs are asserted here since none were verified live this run):

- Beat 1: "car dashboard temperature gauge closeup stopped at red light"
- Beat 2: "car radiator grille airflow highway driving" / "engine bay cooling fan closeup"
- Beat 3: "electric radiator fan spinning engine bay" / "car fan blade closeup stationary"
- Beat 4: "coolant reservoir tank closeup" / "thermostat housing engine bay"
- Beat 5: "auto repair garage bay interior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; script above is exactly what gets fed
to it, already timed to the 30s budget.

### Captions

[`captions.srt`](./captions.srt) — 9 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration above,
plus one static end-card cue. Style: white bold sans, black outline/shadow,
bottom-third safe zone — burn in via ffmpeg `subtitles` filter, never as a
generated in-frame element (Seedance/Higgsfield can't spell reliably, and
M10 preflight blocks generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat → ambient
   engine-bay/road room-tone (optional, see §6) → voiceover track → burned-in
   caption track → end-card SAVE text (beat 6, static freeze only).
2. **Assembly:** concatenate the 5 narrated beats in order, cut hard on each
   beat boundary (no crossfade), then hold the last frame (or a dedicated
   static end-card graphic) for the final 3s SAVE freeze — matches the
   render-integrity gate's expectation of a fixed beats + 3s-freeze contract.
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** neutral-cool tone on beats 1–2 (diagnostic/technical framing),
   slight warm shift on beats 3–4 (getting into cause), warm/inviting on
   beat 5 CTA and the SAVE freeze.
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 30s, video-stream duration
   also within 0.75s (container duration alone can lie via the audio track),
   ≥80% of expected 30fps frame count, ≥3 distinct MD5s among 5 sampled
   frames across the 5 narrated beats — every beat here is a slow camera
   move/push-in or actual fan motion, not a static still, satisfying the
   motion-proof requirement. The 3s SAVE freeze is deliberately static and
   sits outside the sampled-beat motion window.
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 30s (within the 15–60s target range)
- **Posting slot:** hold to the account's fixed posting cadence — do not
  post ad hoc. Given the 7-open-PR backlog noted above, this pack should
  queue behind a human triage pass, not jump ahead of older unapproved packs.
- **Caption/hashtags:** see §8 below
- **CTA type:** SAVE (matches the end-card freeze; distinct from the SEND
  CTA type used on the emergency-response overheating pack)

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
the latest `autonomy_policy_versions` row, not read this run (live DB).
Account balance (`getHiggsfieldAccountHealth().balanceCredits`) is likewise
`UNKNOWN` — not probed.

**Guardrail order to expect at real enqueue time** (from
`apps/nickstire/docs/runbooks/reel-pipeline.md`, not evaluated this run):
preflight → `RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h)
→ `REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. With
10 topics packed today and 7 open PRs already, the feed cap will bind
enormously before topic-repeat does — this is the volume signal flagged at
the top of this document, not a new observation.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, repeated
from every prior pack, still unresolved). This pack sidesteps it
deliberately rather than asserting a track is cleared: **no music bed is
assigned.** The reel is voiceover + captions + optional single royalty-free
ambient/SFX layer (engine-bay room-tone, one soft fan-whir cue under beat
3), which also scores well on the pipeline's muted-first requirement since
the captions alone carry full meaning. If the operator wants a music bed,
that requires a specific track with asset ID, source, license scope,
territory, and expiry tracked by hand — this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED` pending
an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (63/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption:**

> Car runs hot at red lights but fine on the highway? Here's why.
>
> Moving, air pushes through the radiator on its own. Stopped, only the fan
> can cool it. If that fan isn't spinning once the engine's warm, that's one
> clue the fan motor, relay, or coolant sensor may need a look.
>
> Low coolant or a stuck thermostat can cause the same symptom — don't guess
> which one.
>
> Save this for the next time you're idling hot.
>
> #cartips #enginecare #clevelandohio #carmaintenance

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Why does your car run hotter at stoplights than on the highway?"
> Caption: At speed, airflow cools the radiator. Stopped, it's all on the
> fan. No spin at idle is one clue something needs a look.
> CTA: Gauge creeping up? Bring it by — free look, no pressure. Link in bio.

**Ad-ready variant B (question-forward):**

> Hook: "Does your radiator fan actually turn on at idle? Most people never check."
> Caption: It's the only thing cooling your engine once you stop moving.
> Low coolant or a stuck thermostat can mimic the same symptom.
> CTA: Save this before your gauge climbs. Nick's Tire and Auto — link in bio.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (63/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor, mainly on
**sourced fact** (no `EvidenceRecord` in `evidenceResolver.ts` currently
backs the fan-mechanism claims, and that store wasn't queried live this run)
and the informal winning-concept gate. Not `PUBLISHED WITH READ-BACK` — no
`reel-canary` call, no `igPostId`, nothing was generated, rendered, or
posted. Not `BLOCKED` outright — the pack is complete and usable.

**Operator action recommended:** this scheduled task has now produced 10
reel-pack directories today plus 7 open, unmerged draft PRs from earlier
firings — well beyond the 2-post/day feed cap this content is meant to
supply. Recommend either (a) throttling this scheduled task's interval, or
(b) pausing it until the existing open-PR backlog is triaged (merged,
rejected, or explicitly deferred), so future runs aren't adding to a queue
that isn't being consumed. This is not a defect in any individual pack — the
topics are all non-duplicate and each pack is independently sound — it's a
production-rate-vs-consumption-rate mismatch worth a human decision.
