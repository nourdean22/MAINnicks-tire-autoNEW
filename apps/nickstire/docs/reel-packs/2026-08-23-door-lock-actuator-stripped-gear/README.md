# Reel production pack — "Door lock clicks but won't lock: the actuator gear is stripped" (2026-08-23)

Scheduled-task run · 2026-08-23 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **STRIPPEDGEAR**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**⚠️ Backlog — read before triaging this PR, see §9 for the full case.**
Before this run, the repo already carried **77 merged reel-pack topics**
plus **10 open, unmerged draft PRs** (#1782, #1783, #1785, #1788, #1790,
#1794–#1798, spanning 2026-08-22 20:36 through 2026-08-23 05:31, roughly
one new PR per hour, none merged) — **87 topics produced, most never
reviewed.** This is the same finding raised in at least seven consecutive
packs since 2026-08-16, and the pile has grown on every single check with
zero exceptions. This pack adds a confirmed non-duplicate 88th topic per
this run's instructions, but the case for pausing or batch-reviewing before
the schedule fires again is stronger this run than last, not weaker.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session; fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` credentials | **Not present** | `env \| grep -iE "REEL\|HIGGSFIELD\|ADMIN_API_KEY\|DATABASE_URL\|TTS"` returned no matching secrets in this session's shell, and no `.env` file exists in `apps/nickstire/` (only `.env.example`). |
| `DATABASE_URL` (prod TiDB) | **Not present** | Same check — not set in this session's shell. |
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

    ls apps/nickstire/docs/reel-packs/ | grep -c '^2026-'                     → 77 merged packs
    search_pull_requests "repo:.../mainnicks-tire-autonew is:pr is:open reel pack in:title"
                                                                                 → 10 open draft PRs (#1782-#1798, 2026-08-22/23)

Merged packs on disk (77, spanning 2026-08-14 through 2026-08-22) cover
tire/brake/engine/electrical/HVAC diagnostics across those dates — see the
2026-08-22 pack's README §1 for the full date-bucketed breakdown, unchanged
by this run. Open draft PRs (10, all posted between 2026-08-22 20:36 and
2026-08-23 05:31, roughly hourly, none merged): fuel pump whine, EGR valve
clogged/rough idle, sunroof drain clog, fuel gauge sending unit, rough
automatic shifting, oil pressure light flickering at idle, worn motor mount
clunk, exhaust suddenly loud/rusted joint, rotten-egg exhaust smell/rich
catalytic converter, clutch slipping.

**"Door lock clicks but won't lock: stripped actuator gear" is not among
any of the above.** `power-window-stuck-halfway` (merged) is the closest
prior topic — also a door-mounted motor/mechanism failure — but it is
about the window regulator/motor circuit, a different mechanism (window
glass movement, not the door latch) and a different visual (window track,
not the lock knob/latch). No merged or open topic touches the door lock
actuator or latch mechanism. This is a distinct symptom, a distinct
mechanism, and a distinct macro visual (interior lock knob + actuator gear
+ door latch) from all 87 prior topics.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

Given the scale of the existing backlog, candidate scoring this run was
narrowed to topics confirmed absent from both the merged-pack directory and
the 10 open PR titles (§1), rather than re-deriving a fresh slate:

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Door lock clicks but won't lock — stripped actuator gear | Strong — relatable, mildly alarming ("locked out for good"), clean two-shot macro visual (lock knob + internal gear), no safety-fear overreach | Yes | No | ✅ **Selected** |
| Headlight lens fogging/moisture inside the housing (seal failure) | Moderate — visually close to the merged `cloudy-headlights` pack (oxidation), risks reading as the same topic despite a different root cause (seal leak vs UV oxidation) | Yes | Thematically adjacent to a merged pack | Parked |
| Trunk/hatch struts won't hold the lid up | Moderate — weaker hook, less safety-relevant, thinner diagnostic content for a 5-beat structure | Yes | No, but weaker candidate | Parked |

"Door lock clicks but won't lock" was selected for a strong, relatable hook,
a clean two-location macro visual (interior lock knob, then internal
actuator gear), a natural loop opportunity (return to the same lock-knob
frame), and confirmed non-overlap with all 87 existing topics.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Door lock actuators use a small plastic gear inside the motor housing, and years of use wear the teeth down" | General automotive diagnostic knowledge (plastic-gear actuator motors are standard on power door locks across most makes; stripped-gear failure is a widely documented, textbook cause of a clicking-but-not-locking door) — not shop-specific | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. Narration hedges with "almost always," not asserted as universal. |
| "Steady, repeating clicks with zero latch movement almost always points to a stripped gear, not a dead motor" | Same — standard shop-floor diagnostic distinction (a fully dead motor produces silence, not clicking; clicking with no movement is the standard tell for a gear/linkage failure) | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing avoids a flat guarantee ("almost always," not "always"). |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact beyond the shop's public contact line (see §8), which sidesteps the channel gap noted below. |
| Shop name/address/phone used in CTA copy ("Nick's Tire and Auto", "(216) 862-0005", "17625 Euclid Ave") | `businessFacts.ts` line 130 — `SEED_FACTS`, git-versioned code, source: shop's own listed contact info | **Confirmed against code source** — exact string match, not invented. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store for the
diagnostic claims, which sidesteps the gap, but it would block any future
reel script that wants to quote a price or warranty line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (27s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Press the lock button and you hear clicking, but the door won't actually lock." |
| 2 · SETUP | 0:04–0:09 | "That clicking is the motor still spinning. It's the gear that moves the latch that's stripped." |
| 3 · VALUE | 0:09–0:17 | "Door actuators use a small plastic gear inside the motor housing. Years of use wear the teeth down until the motor spins and nothing moves." |
| 4 · VALUE | 0:17–0:22 | "A quick check: listen close. Steady, repeating clicks with zero latch movement almost always points to a stripped gear, not a dead motor." |
| 5 · CTA | 0:22–0:27 | "Worth checking before you're locked out for good. Stop by and we'll take a look." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, loop plan, audio notes, self-estimated score): [`brief.json`](./brief.json).

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
   return-to-lock-knob shot so the loop reads smoothly on replay rather than
   jumping.
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** neutral/slightly cool grade on beats 1–4 (diagnostic,
   workbench mood), warm shift on beat 5 (CTA, inviting) — deliberately
   matched to beat 1's framing so the shift in color, not composition, is
   what signals "resolved" on the loop.
5. **Loop mechanic:** beat 5 reuses beat 1's exact camera position and
   subject (interior door lock knob, static locked-off framing) per
   `brief.json` `loopPlan` — the composition match, not just proximity in
   time, is what makes the last frame feed the first.
6. **Output contract (must hold for the pipeline's own render-integrity
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
- **CTA type:** SEND-oriented ("send this to someone whose car does the same
  thing"), matching the account's corrected objective (a SAVE-oriented CTA
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
assigned.** The reel is voiceover + captions + optional isolated click SFX
and ambient room-tone, which also scores well on the pipeline's muted-first
requirement since captions alone carry full meaning. If the operator wants a
music bed, that requires a specific track with asset ID, source, license
scope, territory, and expiry tracked by hand — this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED`
pending an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (55/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Press the lock button and you hear clicking — but the door won't actually
> lock. That's the motor still spinning. It's the little gear that moves
> the latch that's stripped.
>
> Door actuators use a small plastic gear inside the motor housing. Years
> of use wear the teeth down until the motor spins and nothing moves.
>
> Quick check: listen close. Steady, repeating clicks with zero latch
> movement almost always points to a stripped gear, not a dead motor.
>
> Worth checking before you're locked out for good. Send this to someone
> whose car does the same thing.
>
> #cartips #clevelandohio #carmaintenance #autorepair #doorlock

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Door clicks when you lock it, but never actually locks?"
> Caption: That's the actuator gear, not the motor. A worn plastic gear
> spins free without moving the latch.
> CTA: Not sure what's going on? Call (216) 862-0005 or stop by 17625
> Euclid Ave — we'll take a look.

**Ad-ready variant B (question-forward):**

> Hook: "Ever notice your door clicking louder than it used to?"
> Caption: That's a warning sign, not background noise — the actuator gear
> inside is wearing down before it fails completely.
> CTA: Stop by and we'll take a look, no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (55/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on two
dimensions specifically — **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the actuator-gear claims, and that
store wasn't and couldn't be queried live this run — no DB access), and
**winning concept ≥57/60** (`scoreReelConcept()` was not invoked, so this
dimension is scored 0 rather than assumed passing). Unlike the prior
(2026-08-22) pack, this one designs and self-scores a full loop plan (5/5)
rather than leaving it undesigned.
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"door lock clicks but won't lock: the actuator gear
is stripped, not the motor"}`, let the server re-score and re-render for
real, and only then move toward publish.

**Separately, and more importantly than this one pack: before this run the
repo already carried 77 merged reel-pack topics plus 10 open, unmerged
draft PRs (#1782–#1798, posted roughly hourly across the last ~9 hours),
none merged as of this run — 87 topics produced, most never reviewed.**
This session did not merge, close, or otherwise touch any other PR — that
is outside this run's assigned scope and each of those PRs belongs to a
different session's branch. This same finding has now been raised in at
least **seven** consecutive packs since 2026-08-16, and on every single one
of those checks the backlog was larger than the last, never smaller. The
open-PR count alone has grown from 8 to 10 in roughly the 24 hours since
the last pack's check, at the same roughly-hourly cadence. Restated
plainly: batch-review the backlog (all are docs-only, zero live side
effects, explicitly `READY FOR HUMAN APPROVAL` not `PUBLISHED`), merge or
close as appropriate, and seriously reconsider whether this scheduled
trigger should keep firing roughly hourly while 87+ packs sit unreviewed —
an unreviewed pack has produced zero shop value regardless of how
well-formed it is, and the per-run cost of writing one is not free (session
time, PR-review load, and GitHub Actions minutes on every draft PR).
