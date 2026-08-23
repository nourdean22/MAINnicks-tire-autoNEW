# Reel production pack — "Fuel gauge reads wrong: the sending unit, not the tank" (2026-08-23)

Scheduled-task run · 2026-08-23 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **GAUGEFLOAT**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**⚠️ Escalating backlog — read before triaging this PR.** This is the
**seventh-plus consecutive pack** to raise this, and the count has not
shrunk once: before this run the repo carried **78 merged reel-pack
topics** plus **8 open, unmerged draft PRs**, all created within the last
~7 hours at an almost exactly hourly cadence (#1782 20:36, #1783 21:32,
#1785 22:30, #1788 23:31, #1790 00:32, #1794 01:31, #1795 02:32, #1796
03:31, 2026-08-22/23). That is **86 topics produced, most never reviewed**,
and this session confirmed there is no session-manageable cron behind this
— the trigger is account/platform-level, outside this session's tools
(`CronList` returned "No scheduled jobs" here). **A push notification was
sent to the operator this run flagging the cadence directly**, since six
prior packs raising it only in a PR body produced no change in trend.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session; fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` credentials | **Not present** | `env \| grep -iE "HIGGSFIELD\|REEL_\|ADMIN_API_KEY\|DATABASE_URL"` returned nothing this run; only `apps/nickstire/.env.example` exists, no real `.env`. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (free local-ffmpeg lane, not Higgsfield/Seedance) as of its last-verified date. Not re-confirmed live this run. |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | Not read live | Not set in this session's shell; no server process to query. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| ChatGPT / external LLM | N/A | This session's own model wrote the script and prompts below — no external LLM call was needed or made. |
| CapCut / GUI editor | Not available | No GUI tool in this environment; editing instructions in §4 are written for a human (or ffmpeg) to execute manually. |
| Session-level cron (`CronList`) | Checked, empty | "No scheduled jobs" — confirms the hourly firing is not something this session created or can cancel. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. **No MP4 exists.**

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls -d apps/nickstire/docs/reel-packs/2026-*/ | wc -l                        → 78 merged packs
    search_pull_requests "repo:.../mainnicks-tire-autonew is:pr is:open reel pack in:title"
                                                                                  → 8 open draft PRs (#1782,1783,1785,1788,1790,1794,1795,1796)

Open PR topics (all engine/drivetrain/exhaust, none overlapping fuel-gauge
electrics): fuel pump whine, EGR valve clogged rough idle, rough automatic
shifting, oil pressure light flicker at idle, worn motor mount clunk,
exhaust suddenly loud (rusted muffler), rotten-egg exhaust smell
(catalytic converter), clutch slipping.

`ls apps/nickstire/docs/reel-packs/ | grep -iE 'fuel-gauge|sending-unit|gauge'`
returned nothing — no merged pack has touched the fuel gauge or sending
unit. "Fuel gauge reads wrong / bounces" is a distinct symptom (electrical
sender fault, not fuel delivery, not engine performance) and a distinct
visual (dash gauge cluster + tank sending-unit cutaway) from all 86 prior
topics.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Fuel gauge reads wrong / bounces — sending unit wear | Strong — counterintuitive (most drivers assume "gauge is broken" means dash electronics, not a wearing sensor in the tank), clean two-shot visual (dash gauge, tank sender cutaway) | Yes | No | ✅ **Selected** |
| Steering shakes at highway speed — wheel balance vs. rotor vs. tie rod | Moderate — risks reading as a rehash of the merged `warped-rotor-brake-shake` and `strut-bounce-test` topics combined | Yes | Thematically adjacent to two merged packs | Parked |
| Transmission won't shift into overdrive / limp mode | Moderate — overlaps closely with the open `rough-automatic-shifting` draft PR (#1796) | Yes | Overlaps an open PR | Parked |

"Fuel gauge reads wrong: the sending unit" was selected for a strong,
counterintuitive hook, a clean two-location macro visual, no overlap with
any of the 86 existing topics, and a safety-adjacent payoff (avoiding an
unexpected empty tank) without needing a business-fact or pricing claim.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A fuel gauge reading wrong or bouncing is usually the sending unit, not the tank" | General automotive diagnostic knowledge (resistive float-arm sending units are standard on the vast majority of gas vehicles; worn contact points are a textbook cause of erratic gauge readings) — not shop-specific | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. Narration hedges with "usually," not asserted as universal. |
| "A float rides the fuel level and moves a resistor; years of fuel and vibration wear the contact points" | Same — standard sending-unit mechanism, widely documented in general automotive repair references | **UNKNOWN against this repo's evidence store**, same reasoning. |
| "Needle jumping on bumps/turns points to the sending unit, not a tank problem" | Standard shop-floor diagnostic heuristic | **UNKNOWN against this repo's evidence store**, same reasoning — presented as "a quick check," not a substitute for a professional inspection. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, sidestepping the channel gap noted below. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack, but it would block any future reel script that
wants to quote a price or warranty line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (29s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Your fuel gauge says empty right after you filled up, or it bounces around while you drive." |
| 2 · SETUP | 0:04–0:09 | "That's usually not the tank. It's the sending unit, the float that tells the gauge how much fuel is left." |
| 3 · VALUE | 0:09–0:18 | "Inside the tank, a float rides the fuel level and moves a resistor. Years of fuel and vibration wear down that resistor's contact points, so the signal skips or reads wrong." |
| 4 · VALUE | 0:18–0:24 | "A quick check: if the needle jumps when you hit a bump or take a turn, that's the sending unit talking, not a tank problem." |
| 5 · CTA | 0:24–0:29 | "Don't just live with guessing your fuel level. Nick's Tire and Auto can check the sending unit and confirm it before you're stuck guessing at the pump." |

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
   gate):** container duration within 0.75s of 29s, ≥80% of expected 30fps
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
- **Duration:** 29s (within the 15–60s target range and the account's
  prior 25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and see §5's guardrail-order
  note if today's feed slot is already consumed
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone whose gauge does this"),
  matching the account's corrected objective (a SAVE-oriented CTA measured
  `saved = 0.00` across the account's first 8 reels, per an earlier pack's
  finding)

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live
balance check):

| Route | Per-unit cost | 5-beat estimate |
|---|---|---|
| `template_stock` (**current prod pin** per REEL-PIPELINE.md) | $0/clip, local ffmpeg | **$0** |
| `seedance_clip` | $0.25/clip (labeled ASSUMPTION in source — unverified) | ~$1.25 |
| `veo_second_720p` | $0.10/sec | ~$2.90 (5 clips × ~5.8s avg) |
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
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (48/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Your fuel gauge says empty right after you filled up, or it bounces
> around while you drive. That's usually not the tank — it's the sending
> unit, the float that tells the gauge how much fuel is left.
>
> Inside the tank, a float rides the fuel level and moves a resistor. Years
> of fuel and vibration wear down that resistor's contact points, so the
> signal skips or reads wrong.
>
> Quick check: if the needle jumps when you hit a bump or take a turn,
> that's the sending unit talking, not a tank problem.
>
> Don't just live with guessing your fuel level. We can check the sending
> unit and confirm it before you're stuck guessing at the pump. Send this
> to someone whose gauge does this.
>
> #cartips #clevelandohio #carmaintenance #autorepair #fuelgauge

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Fuel gauge says empty right after a fill-up?"
> Caption: That's usually the sending unit, not the tank — a worn float
> resistor giving a bad reading, not a fuel problem.
> CTA: Not sure what's going on? Call (216) 862-0005 or stop by 17625
> Euclid Ave — we check it free.

**Ad-ready variant B (question-forward):**

> Hook: "Ever wonder how your fuel gauge actually knows how much gas you have?"
> Caption: A float and a resistor. When that resistor wears out, the
> gauge doesn't fail — it just starts lying to you.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (48/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a shop garage bay,
doesn't feed back into the HOOK frame, a dashboard gauge shot — no loop
plan was designed), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the sending-unit claims, and that
store wasn't and couldn't be queried live this run — no DB access), and
**winning concept ≥57/60** (`scoreReelConcept()` was not invoked, so this
dimension is scored 0 rather than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"fuel gauge reads wrong or bounces around: the
sending unit, not the tank"}`, let the server re-score and re-render for
real, and only then move toward publish.

**Separately, and more urgently than this one pack: the backlog has now
grown to 86 topics (78 merged + 8 open) with an hourly firing cadence and
zero merges of the current open batch across at least seven consecutive
runs of this same scheduled task.** This session confirmed via `CronList`
that the trigger is not session-manageable — it lives at the
account/platform level, outside any tool available here. Because six prior
packs raising this in a PR body produced no change in trend, this run also
sent a direct push notification to the operator. This session did not
merge, close, or otherwise touch any other PR — that is outside this run's
assigned scope. Restated once more, and unchanged in substance from the
last six packs: batch-review the backlog (all are docs-only, zero live side
effects, explicitly `READY FOR HUMAN APPROVAL` not `PUBLISHED`), merge or
close as appropriate, and reconsider whether this scheduled trigger should
keep firing roughly hourly while dozens of packs sit unreviewed — an
unreviewed pack produces zero shop value regardless of how well-formed it
is, and the per-run cost is not free (session time, PR-review load, and
GitHub Actions minutes on every draft PR).
