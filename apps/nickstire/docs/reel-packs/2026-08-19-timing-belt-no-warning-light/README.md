# Reel production pack — "Timing belt: the maintenance item with no warning light" (2026-08-19)

Scheduled-task run · 2026-08-19 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **NOLIGHT**

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
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | `curl localhost:3000/api/health` — no server process in this session's container; this is a fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` credentials | **Not present** | Only `apps/nickstire/.env.example` exists (template, placeholder values); `env \| grep -i higgsfield` returns nothing. |
| `DATABASE_URL` (prod TiDB) | **Not present** | Same check — not set in this session's shell. No prod DB was read or written. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (the free local-ffmpeg lane, not Higgsfield/Seedance) as of its last-verified date; not live-reconfirmed this run. |
| `REEL_GENERATION_ENABLED` | Not read live | No server process to query; gate lives on the cron pulse job. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| CapCut / any local NLE | Not present | No editing application installed in this container; ffmpeg-shape instructions are provided instead (§4). |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is.

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/                                    → 36 merged packs
    search_pull_requests "repo:...mainnicks-tire-autonew is:pr is:open reel pack in:title"
                                                                           → 1 open PR (#1701, "windshield chip repair-before-it-spreads")

This is a sharp change from the prior scheduled run's finding on this same
day (that run's pack, `2026-08-19-wont-start-battery-starter-alternator`,
reported 52 open PRs and a 37+ topic backlog at the time it wrote its
README). Between that run and this one, the backlog was evidently cleared —
36 packs are now merged on disk (including that very run's own pack) and
only one PR remains open. **This run does not re-report the stale 52-open
figure as current; it re-verified live and found 1.** Merged topics on disk
span tires (penny test, tread depth, rotation, sidewall bulge, TPMS,
all-season vs. winter, pothole damage, spare-tire mileage, road-trip check,
summer-heat pressure), brakes (squeal vs. grind, fluid moisture, road-salt
corrosion), fluids (coolant color, transmission fluid, oil-change interval),
and general diagnostics (check-engine light, wheel-bearing hum, CV-joint
click, power-steering whine, strut bounce, serpentine belt, why-a-car-pulls,
uneven wear, cabin filter, wiper blades, AC not cold, cold-weather TPMS
light, battery heat, "won't start" triage, "stop driving now" noises,
plug-vs-patch, balance-vs-alignment, repair-authorization questions). The
open PR (#1701) covers windshield chip repair.

**"Timing belt has no dashboard warning light" is not among any of the
above.** It is adjacent to `check-engine-light` (that pack is about reading
an *active* dash warning) and to `oil-change-intervals` (mileage-based
maintenance) but distinct from both: its entire hook is that this specific
item has **no** dashboard signal at all, unlike almost every other
maintenance item drivers are used to being warned about. Selected on that
basis.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Timing belt — no warning light | Strong — counterintuitive ("there's no light for THIS one") plays against the account's own prior check-engine-light pack | Yes | No | ✅ **Selected** |
| Radiator hose swelling / soft-spot check | Moderate — useful but less counterintuitive hook | Yes | No (adjacent to coolant-color, not duplicate) | Parked |
| Shocks vs. struts (component naming confusion) | Weak — overlaps thematically with existing strut-bounce-test pack | Yes | Close overlap | Rejected — too close to merged topic |

"Timing belt" was selected for the strongest hook (a maintenance item with
literally zero dashboard warning, in contrast to nearly every other topic
this account has covered, all of which involve *some* dash signal or
audible symptom), confirmed non-overlap with the 36 merged + 1 open topic,
and a clean 5-beat mapping without inventing structure.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "No check-engine light, no dash symbol for a worn timing belt" | General automotive knowledge — timing belts are a mileage/time-based interval item with no wear sensor on the vast majority of production vehicles; this is standard, widely documented information, not shop-specific | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read; no `DATABASE_URL` present). No `EvidenceRecord` citation attached. |
| "Most belts are due somewhere between 60 and 100 thousand miles — check your owner's manual for the exact number" | Standard, widely published OEM-interval range; script explicitly defers to the owner's manual rather than asserting a single number as universal or shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning as above. Deliberately hedged to the owner's manual rather than a fixed number, since the real interval varies by make/model/engine. |
| "On some engines, a snapped belt can lead to serious engine damage" | Standard, widely documented distinction between interference and non-interference engine designs; phrased as "on some engines... can lead to" rather than a universal claim | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing avoids "will destroy your engine" (absolute/fear-forward) in favor of the approved-register hedge "can lead to," consistent with `facelessReelStudio.ts`'s soft-language bank (`may indicate` / `can point to` / `worth checking`). |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) — confirmed real address/phone (`17625 Euclid Ave, Cleveland, OH 44112`, `(216) 862-0005`) match what prior packs used | **N/A — deliberately avoided.** This topic doesn't need a business fact beyond the public shop identity, which sidesteps the channel gap noted below. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store for
anything beyond the public shop address/phone, so the gap doesn't block this
pack.

---

## 4 · Full production pack

### Script — word-for-word, timed (28s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Your timing belt can fail with zero warning light." |
| 2 · SETUP | 0:04–0:10 | "No check-engine light. No dash symbol. It's mileage-based, not warning-based." |
| 3 · VALUE | 0:10–0:17 | "Most belts are due somewhere between sixty and a hundred thousand miles — check your owner's manual for the exact number." |
| 4 · VALUE | 0:17–0:23 | "On some engines, a snapped belt can lead to serious, expensive engine damage — not just a stall." |
| 5 · CTA | 0:23–0:28 | "Don't wait for a light that isn't coming. Nick's Tire and Auto checks your belt interval free. Link in bio." |

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

- Beat 1: "car dashboard odometer mileage closeup no warning lights" / "clean dashboard instrument cluster driving"
- Beat 2: "dashboard warning light icons off dark cluster" / "car interior dash empty no alerts"
- Beat 3: "car engine bay timing cover closeup" / "under hood engine belt pulley macro"
- Beat 4: "engine bay serpentine and timing belt area wide" / "mechanic tool cart engine bay (no hands/faces visible, background only)"
- Beat 5: "dashboard odometer closeup pulling back to reveal auto shop garage bay" / "auto repair shop garage bay interior open door daylight"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; the script above is exactly what
gets fed to it, already timed to the 28s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration
above. Style: white bold sans, black outline/shadow, bottom-third safe
zone, ALL-CAPS optional per house style — burn in via ffmpeg `subtitles`
filter, never as a generated in-frame element (Seedance/Higgsfield can't
spell reliably, and the M10 preflight blocks generated text for exactly
that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat →
   optional single subtle mechanical whir/click SFX under beat 3 (see §6) →
   voiceover track → burned-in caption track → end-card CTA text (beat 5
   only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each
   beat boundary (no crossfade — matches the render-integrity gate's
   expectation of distinct per-beat frames, not a dissolve-blurred
   transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** neutral-cool grade on beats 1–4 (informational, slightly
   tense on beat 4), warm shift on beat 5 (CTA, inviting).
5. **Loop plan:** beat 1 opens on a clean-dash mileage close-up; beat 5's
   final frame pulls back from the same odometer framing to reveal the shop
   bay — designed so the end frame rhymes visually with the opening frame
   for a seamless replay loop (see `brief.json` `concepts[0].loopIdea`).
6. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 28s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow camera move or
   subtle vibration, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 28s (within the 15–60s target range and the account's own
  25–30s CTA-block convention, per prior packs)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and check the guardrail order
  in §5 if today's feed slot is already consumed
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone who's never checked
  their timing belt interval"), matching the account's corrected objective
  (a SAVE-oriented CTA measured `saved = 0.00` across the account's first 8
  reels, per an earlier pack's finding)

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
autonomous cron (`dailyReelPost.ts`, if `REEL_AUTOPOST_ENABLED=true`) or by
PR #1701's topic once merged, this pack should wait for the next open slot
rather than force a same-day post.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, same one
noted in every prior pack — not a new finding). This pack sidesteps it
deliberately rather than asserting a track is cleared: **no music bed is
assigned.** The reel is voiceover + captions + one optional royalty-free
mechanical whir/click SFX on beat 3, which also scores well on the
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

> Your timing belt has no warning light. No check-engine light, no dash
> symbol — it's mileage-based, not warning-based.
>
> Most belts are due somewhere between 60,000 and 100,000 miles — check
> your owner's manual for the exact number. On some engines, a snapped
> belt can mean serious, expensive damage, not just a stall.
>
> Don't wait for a light that isn't coming. Send this to someone who's
> never checked their interval.
>
> #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "There's one part on your car with zero warning light — and it can
> take your engine with it."
> Caption: Your timing belt doesn't trigger a dash warning. It's a
> mileage interval, not a symptom you'll notice until it's too late.
> CTA: Not sure when yours is due? Call (216) 862-0005 or stop by 17625
> Euclid Ave — we'll check your interval free.

**Ad-ready variant B (question-forward):**

> Hook: "When's the last time your timing belt was checked? There's no
> light to remind you."
> Caption: Unlike your check-engine light or TPMS, a worn timing belt
> gives you nothing on the dash — just a mileage number in your owner's
> manual.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (60/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on two
dimensions specifically — **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the timing-belt-interval claims, and
that store wasn't and couldn't be queried live this run — no DB access) and
**winning concept ≥57/60** (`scoreReelConcept()` was not invoked, so this
dimension is scored 0 rather than assumed passing). Both gaps are
structural to running with no `DATABASE_URL`/live server in this container,
not a defect specific to this topic. Not `PUBLISHED WITH READ-BACK` — no
`reel-canary` call, no `igPostId`, nothing was generated, rendered, or
posted. Not `BLOCKED` outright — the pack is complete and usable; an
operator (or a live-authorized session) can hand it to the real pipeline via
`/api/admin/reel-canary {action:"start", topic:"timing belt: no warning
light"}`, let the server re-score and re-render for real, and only then
move toward publish.

This run made no changes to any other open PR (#1701) or to the merged-pack
history on `main` — it added exactly one new, non-duplicate pack on its own
branch.
