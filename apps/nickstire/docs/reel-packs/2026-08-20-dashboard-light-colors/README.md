# Reel production pack — "Dashboard warning-light colors: red vs. amber" (2026-08-20)

Scheduled-task run · 2026-08-20 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **LIGHTCOLOR**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**Backlog status, read before triaging this PR.** A prior run (2026-08-19,
PR #1699) closed roughly 55 stale/duplicate reel-pack PRs in a single bulk
cleanup. Since then, 9 fresh draft PRs (#1701–#1724) have opened over the
following ~8 hours and **zero have merged**. This pack would be the 10th
open, unmerged draft. Unlike the pre-cleanup backlog, none of the current 9
overlap this pack's topic or each other on title inspection — so this is not
a duplicate — but the same pattern that produced the 55-PR backlog (packs
generated faster than any human reviews them) is visibly restarting. That is
an operator-triage decision, not something this run can fix; flagging it
plainly rather than adding a 10th silent entry.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session's container; this is a fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` credentials | **Not present** | `env \| grep -iE "REEL_\|HIGGSFIELD\|ADMIN_API_KEY"` returned nothing in this shell. |
| `DATABASE_URL` (prod TiDB) | **Not present** | Same check — not set in this session's shell. |
| `ffmpeg` / `hf` (Higgsfield CLI) binaries | **Not present** | `which ffmpeg hf` returned nothing — no local render or Higgsfield-CLI path exists in this container. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (verified there 2026-08-11) — the free local-ffmpeg lane, not Higgsfield/Seedance. Last-known, not live-reconfirmed this run. |
| `REEL_GENERATION_ENABLED` | Not read live | No server process to query; gate lives on the cron pulse job. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is.

**Repetition-ledger context — live PR search this run (real data, not an
approximation of `reel_jobs`, which this session cannot reach):**

    gh-equivalent search_pull_requests: "reel pack in:title is:open"   → 9 open (#1701, 1702, 1708, 1712, 1717, 1721, 1722, 1723, 1724)
    gh-equivalent search_pull_requests: "reel pack in:title is:closed" → 55 closed (bulk cleanup 2026-08-19 ~14:47-15:00, PR #1699)
    ls apps/nickstire/docs/reel-packs/                                 → 38 merged packs on disk

Current open-PR topics: Ohio E-Check readiness monitors, spongy brake pedal,
smell while driving (coolant/rubber/electrical), clunk over bumps (sway bar
vs. ball joint), metallic rattle on acceleration (heat shield), engine
overheating first 60 seconds, steering wheel shakes when braking (warped
rotors), timing belt with no warning light, windshield chip repair.

**"Dashboard warning-light colors: red vs. amber" is not among any of
the above**, and is distinct from the single-light topics already merged
(check-engine-light, cold-weather-tire-light, TPMS-sensor-battery) — this
pack is about the color-coding convention that applies *across all* dashboard
telltales, not one specific light. Selected on that basis.

> **This is a live PR-title search plus a directory listing, not a
> substitute for the real `reel_jobs` ledger.** An actual DB row for a
> rejected brief that never got a pack written would not show up here —
> treat "not found in either search" as directional, not a guarantee of
> zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Dashboard warning-light colors (red vs. amber vs. flashing) | Strong — universal dashboard-anxiety hook, clean 3-tier decision rule | Yes | No | ✅ **Selected** |
| How to read tire sidewall numbers (size / load index / speed rating) | Moderate — informational rather than fear/urgency driven | Yes | No (distinct from tire-expiration's DOT date code and sidewall-bulge's damage angle) | Parked |
| Gas smell after fill-up (loose cap vs. EVAP leak) | Moderate — narrower symptom, smaller relevant audience than "check engine light is on" | Yes | No, but thematically close to the open "smell while driving" PR (#1722) even though that one is coolant/rubber/electrical, not fuel | Parked to avoid smell-topic clustering while #1722 is still open |

"Dashboard light colors" was selected for universal relatability (every
driver has seen an unfamiliar icon light up and not known whether to worry),
a clean three-tier decision structure (amber / red / flashing) that maps
onto the account's 5-beat shape without inventing structure, and confirmed
non-overlap with both the merged-pack directory and the 9 open PRs.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Amber/yellow generally means worth checking soon, no need to pull over immediately" | General automotive telltale-color convention (SAE/ISO-style icon color coding, taught in most owner's manuals and driver-education material) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. Phrasing uses "worth checking" (approved soft-language pattern, `client/src/lib/facelessReelStudio.ts`) rather than an absolute. |
| "Red generally means pull over safely and shut the engine off" | Same convention — widely taught, not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "can point to". |
| "A flashing icon (vs. solid) often signals don't keep driving" | Same — standard convention (e.g., a flashing check-engine light specifically warns of active misfire/catalyst damage risk in most manufacturer documentation) | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "often means", intentionally softer than an absolute claim. |
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
| 1 · HOOK | 0:00–0:04 | "Same light, different color? That's one clue to what you do next." |
| 2 · SETUP | 0:04–0:10 | "Amber or yellow? Worth checking soon — no need to pull over yet." |
| 3 · VALUE | 0:10–0:16 | "Red? That can point to something serious — pull over safely and shut it off." |
| 4 · VALUE | 0:16–0:22 | "Flashing instead of solid? That often means don't keep driving on it." |
| 5 · CTA | 0:22–0:28 | "Don't guess which light you're looking at — stop by and we'll take a look, free. Link in bio." |

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

- Beat 1: "dashboard warning light closeup amber" / "car instrument cluster night"
- Beat 2: "dashboard icon glowing amber steady" / "car dashboard warning light closeup"
- Beat 3: "dashboard red warning light closeup" / "car dashboard emergency light"
- Beat 4: "dashboard warning light flashing flicker" / "car instrument cluster closeup"
- Beat 5: "auto repair shop garage bay interior open door" / "mechanic diagnostic scanner screen"

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
   ambient garage/interior room-tone (no dedicated SFX cue this pack) →
   voiceover track → burned-in caption track → end-card CTA text (beat 5
   only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each
   beat boundary (no crossfade — matches the render-integrity gate's
   expectation of distinct per-beat frames, not a dissolve-blurred
   transition). At the very end of beat 5, hold on the diagnostic-scanner
   glow (see `brief.json` `concepts[0].loopIdea`) so a looped replay
   match-cuts back into beat 1's glowing-icon close-up — this is an editor
   framing intent, not a rendered or verified loop.
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** cooler, slightly desaturated grade on beats 1–4 (dashboard,
   slightly tense/diagnostic mood), warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 28s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow camera move,
   flicker, or subtle vibration, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 28s (within the 15–60s target range and the account's
  established 25–30s CTA-block convention, per prior packs)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and see the backlog note at the
  top of this pack before scheduling a same-day slot
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone whose dashboard light
  just came on"), matching the account's corrected objective (a SAVE-oriented
  CTA measured `saved = 0.00` across the account's first 8 reels, per a
  prior pack's finding)

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read this run, not a
live balance check):

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
assigned.** The reel is voiceover + captions only, which also scores well
on the pipeline's muted-first requirement since captions alone carry full
meaning. If the operator wants a music bed, that requires a specific track
with asset ID, source, license scope, territory, and expiry tracked by
hand — this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED`
pending an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (58/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Same light, different color? That's one clue to what you do next.
>
> Amber or yellow — worth checking soon, no need to pull over.
> Red — that can point to something serious, pull over safely and shut it off.
> Flashing instead of solid — often means don't keep driving on it.
>
> Don't guess which light you're looking at. Send this to someone whose
> dashboard light just came on.
>
> #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "That dashboard light — is it a 'get it checked this week' light or
> a 'pull over right now' light?"
> Caption: Amber = worth checking soon. Red = pull over and shut it off.
> Flashing = don't keep driving on it. The color tells you what to do next.
> CTA: Not sure which one you're looking at? Call (216) 862-0005 or stop
> by 17625 Euclid Ave — we'll read it for you, free.

**Ad-ready variant B (question-forward):**

> Hook: "Do you actually know the difference between an amber warning
> light and a red one?"
> Caption: One means "worth checking soon." The other means "pull over
> now." Guessing wrong either wastes a trip or risks real damage.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (58/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on two
dimensions specifically — **loop** (partial credit only: a visual rhyme
between beat 5 and beat 1 is designed but not rendered or verified) and
**sourced fact** (no `EvidenceRecord` in `evidenceResolver.ts` currently
backs the amber/red/flashing telltale-color claims, and that store wasn't
and couldn't be queried live this run — no `DATABASE_URL` in this session).
Everything else in the rubric (first-frame scroll-stop, muted-first
clarity, 5-beat structure, length, faceless/wordless contract, claim
safety, campaign-keyword validity) is a genuine 10/10 or full-credit read
against the actual prompts and captions in this pack, not an assumption.

**What still requires manual/operator work before this can post:**

1. Render the 5 beat clips (via the actual prod route, `template_stock`,
   or via Higgsfield/Seedance/Veo if the operator wants the paid lane) —
   "Render in CapCut" or via the app's real `reel-canary` pipeline once a
   live session with credentials runs it.
2. Generate voiceover through `reelVoice.ts` from the exact narration text
   in §4.
3. Assemble per §4's editing instructions; verify the render-integrity
   contract (duration, frame count, distinct-frame check) actually holds
   on the output file — do not assume it from this pack alone.
4. Run the real `calculateReelQualityScore()` and
   `evaluateReelPublishGate()` against the rendered asset; if it lands
   below 70/75 or the gate returns anything other than `proceed`, address
   the specific flagged dimension (most likely: the sourced-fact citation)
   before treating this as ready.
5. Route through the human-approval door (`instagramAdmin.publishPost` /
   the admin Queue tab) — never `{action:"publish"}` from this or any
   scheduled/automated session. "Post via Meta Business Suite" or the
   admin console's Approve action is the correct human step, not this run.
6. Before merging this doc-only PR: check whether the 9-open-PR backlog
   noted at the top needs operator triage/merge first, independent of this
   specific pack's content.
