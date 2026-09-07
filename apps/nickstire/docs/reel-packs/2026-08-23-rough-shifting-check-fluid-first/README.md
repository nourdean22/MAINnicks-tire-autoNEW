# Reel production pack — "Rough shifting? Check the fluid before the solenoid" (2026-08-23)

Scheduled-task run · 2026-08-23 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **SHIFTCHECK**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**⚠️ Backlog — worse again, not better. Read before triaging this PR.**
Before this run: **78 merged reel-pack topics** on disk plus **7 open,
unmerged draft PRs from the last 30 hours** (#1782, #1783, #1785, #1788,
#1790, #1794, #1795) — **85 topics produced, most never reviewed.** This is
the same finding raised in at least **seven** consecutive packs since
2026-08-16, and unlike prior runs where the count simply held flat or grew
slowly, it grew by **9 topics in roughly one day** this time (69→78 merged,
plus 7 new open PRs replacing the prior day's 8, which themselves are
presumably now either merged into that 78 or still unresolved elsewhere).
This session cannot tell which, because reconciling that is outside this
run's scope — see §9. This pack adds a confirmed non-duplicate topic per
this run's instructions, but the growth rate itself is now the more urgent
fact than any single topic.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session; fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` credentials | **Not present** | `env \| grep -iE "HIGGSFIELD\|REEL_\|DATABASE_URL\|ADMIN_API_KEY\|CAPCUT"` returned no matching values in this session's shell. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (the free local-ffmpeg lane, not Higgsfield/Seedance) as of its last-verified date. Not re-confirmed live this run. |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | Not read live | Not set in this session's shell; no server process to query. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| Local render (ffmpeg / CapCut) | **Not available** | `which ffmpeg` returned nothing (`command not found`) in this session's shell; no CapCut or equivalent GUI editor present. |
| ChatGPT / external LLM | N/A | This session's own model wrote the script and prompts below — no external LLM call was needed or made. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is. **No MP4 exists.**

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls -d apps/nickstire/docs/reel-packs/2026-*/ | wc -l                        → 78 merged packs
    search_pull_requests "repo:.../mainnicks-tire-autonew is:pr is:open reel pack in:title"
                                                                                  → 7 open draft PRs

Open draft PRs at time of this run: fuel pump whine getting louder (#1795),
EGR valve clogged / rough idle (#1790), oil pressure light flickers at idle
(#1785), worn motor mount clunk on acceleration (#1782), exhaust suddenly
loud / rusted muffler joint (#1794), rotten egg exhaust smell / catalytic
converter running rich (#1783), clutch slipping — RPM climbs but car
doesn't speed up (#1788). None of these concern automatic-transmission
shift quality or fluid condition.

**"Rough/delayed automatic shifting, check fluid before the solenoid" is not
among any of the 78 merged packs or 7 open PRs above.** The closest prior
topics are `transmission-fluid-color-test` (merged 08-17, about reading
fluid color/condition as a general health check, not tied to a shifting
symptom) and `differential-whine-on-turns` (merged 08-21, a different
drivetrain component entirely). Neither addresses hard/delayed/slipping
shifts as the presenting symptom or frames "check the fluid before assuming
an expensive solenoid replacement" as the hook — that framing, and the
symptom-first angle, are new.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Rough/delayed automatic shifting — check fluid before the solenoid | Strong — reframes an expensive-sounding symptom into a free, self-checkable first step; clear before/after visual (pink vs. brown fluid) | Yes | No | ✅ **Selected** |
| Torque converter shudder at 40-45mph | Moderate — narrower symptom, harder to shoot distinctly from the fluid-check angle without overlapping this pack | Yes | Not directly covered, but thematically adjacent to this pack | Parked |
| Wheel wobble at low speed only (vs. highway-speed vibration, already covered via tie-rod/warped-rotor packs) | Weak — visually hard to differentiate from prior wobble/vibration packs | Yes | Thematically adjacent to multiple merged packs | Parked |

"Rough shifting, check fluid first" was selected for a strong reframe
(cheap self-check vs. assumed expensive repair), a clean two-shot visual
(dipstick tube, then a fluid-color comparison), and confirmed non-overlap
with all 85 existing topics.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Low or old transmission fluid changes how the valve body applies pressure, and that alone can cause hard, delayed, or slipping shifts" | General automotive diagnostic knowledge (fluid level/condition affecting valve-body hydraulic pressure is a standard, widely documented transmission diagnostic principle) — not shop-specific | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read; no `DATABASE_URL` present). No `EvidenceRecord` citation is attached. Narration hedges with "can cause," not asserted as the only cause. |
| "Warm and running, pull the dipstick — should be pink or red, not brown, at the fill line" | Standard shop-floor diagnostic check, widely documented in general automotive repair references (most conventional automatic transmissions use a dipstick check-with-engine-running procedure; some newer sealed transmissions don't have a dipstick at all) | **UNKNOWN against this repo's evidence store**, same reasoning. Script does not claim this applies to every vehicle — presented as "a quick check," not universal. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** Sidesteps the channel gap noted below. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack.

**Additional caveat specific to this topic, not in prior packs:** the script
assumes a conventional dipstick-equipped automatic transmission. A meaningful
share of newer vehicles use sealed, "lifetime fluid" transmissions with no
dipstick. The narration doesn't claim universality, but this is worth a
human review pass before publish — a caption note or a vehicle-scope caveat
may be warranted.

---

## 4 · Full production pack

### Script — word-for-word, timed (28s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Your automatic suddenly shifts hard or hesitates between gears." |
| 2 · SETUP | 0:04–0:09 | "Before you assume it's the solenoid, check one thing that takes thirty seconds." |
| 3 · VALUE | 0:09–0:17 | "Low or old transmission fluid changes how the valve body applies pressure, and that alone can cause hard, delayed, or slipping shifts." |
| 4 · VALUE | 0:17–0:23 | "Warm and running, pull the dipstick. It should be pink or red, not brown, and right at the fill line." |
| 5 · CTA | 0:23–0:28 | "Low or dark fluid? That's a simple fix. Nick's Tire and Auto checks it free before we talk about anything bigger." |

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
2. **Transitions:** hard cuts between beats 1→2→3, a match-cut style push
   from beat 3's dipstick tube into beat 4's macro fluid-comparison shot
   (both are engine-bay macro subjects, so a hard cut reads cleanly too if a
   match-cut isn't practical), then a short cross-fade (6–8 frames) into
   beat 5's wide shop shot to signal the tonal shift from diagnostic to CTA.
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** neutral/cool grade on beats 1–3 (diagnostic mood), a clean
   near-white studio look on beat 4's fluid comparison so the pink-vs-brown
   distinction reads clearly, warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 28s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow macro push-in,
   orbital move, or rack-focus shift, not a still).
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
- **CTA type:** SEND-oriented ("send this to someone whose car shifts
  weird"), matching the account's corrected objective (a SAVE-oriented CTA
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

> Your automatic suddenly shifts hard or hesitates between gears - and
> you're already picturing an expensive repair bill.
>
> Before you assume it's the solenoid, check one thing that takes thirty
> seconds: the transmission fluid. Low or old fluid changes how the valve
> body applies pressure, and that alone can cause hard, delayed, or
> slipping shifts.
>
> Warm and running, pull the dipstick. It should be pink or red, not
> brown, and right at the fill line.
>
> Low or dark fluid? That's a simple fix. We check it at no charge before
> we talk about anything bigger.
> weird.
>
> #cartips #clevelandohio #carmaintenance #autorepair #transmissioncare

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Transmission suddenly shifting hard or hesitating?"
> Caption: Before you assume it's the solenoid, check the fluid — low or
> old fluid alone can cause hard, delayed, or slipping shifts.
> CTA: We check fluid level and condition free. Call (216) 862-0005 or
> stop by 17625 Euclid Ave.

**Ad-ready variant B (question-forward):**

> Hook: "Ever wonder why a $15 fluid check can rule out a $2,000 repair?"
> Caption: A transmission's valve body relies on fluid pressure to shift
> smoothly. Low or dark fluid can mimic the symptoms of a failing
> solenoid — and it's the easiest thing to rule out first.
> CTA: Stop by and we'll check it free, no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (50/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on the
same three dimensions every recent pack in this backlog has flagged —
**loop** (the CTA frame, a shop bay, doesn't feed back into the HOOK frame,
a gear shifter shot — no loop plan was designed), **sourced fact** (no
`EvidenceRecord` in `evidenceResolver.ts` currently backs the
fluid-pressure claim, and that store wasn't and couldn't be queried live
this run — no DB access), and **winning concept ≥57/60**
(`scoreReelConcept()` was not invoked, so this dimension is scored 0 rather
than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"automatic transmission shifting hard or delayed,
check the fluid before assuming it's the solenoid"}`, let the server
re-score and re-render for real, and only then move toward publish.

**Separately, and more urgently than this one pack: the backlog is
accelerating, not just persisting.** Before this run the repo carried 78
merged reel-pack topics plus 7 open, unmerged draft PRs from the last 30
hours (#1782, #1783, #1785, #1788, #1790, #1794, #1795) — 85 topics
produced, most never reviewed. This same finding has been raised in at
least **seven** consecutive packs since 2026-08-16; unlike earlier runs
where the backlog grew steadily, the last ~24 hours alone added roughly 9
merged topics and cycled a full 7-PR batch of new opens. This session did
not merge, close, or otherwise touch any other PR — that is outside this
run's assigned scope and each of those PRs belongs to a different session's
branch. Restated plainly: batch-review the backlog (all are docs-only, zero
live side effects, explicitly `READY FOR HUMAN APPROVAL` not `PUBLISHED`),
merge or close as appropriate, and seriously reconsider whether this
scheduled trigger should keep firing at its current cadence while 85+
packs sit unreviewed — an unreviewed pack has produced zero shop value
regardless of how well-formed it is, and the per-run cost of writing one is
not free (session time, PR-review load, and GitHub Actions minutes on
every draft PR). This session is flagging this directly to the operator
outside the PR as well, given how many consecutive runs have raised it
without a change in trend.
