# Reel production pack — "Tire valve stem dry rot: the slow leak you can see" (2026-08-21)

Scheduled-task run · 2026-08-21 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **VALVESTEM**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**⚠️ Backlog, read before triaging this PR — see the box in §1 and §9.**
Before this run, the repo already carried **53 merged reel-pack topics**
plus **8 open, unmerged draft PRs from 2026-08-20 alone** (#1738–#1748,
none merged as of this run) — 61 topics produced, most never reviewed. This
pack adds a genuinely new, non-duplicate 62nd topic per this run's
instructions, but the backlog itself is an operator-level decision (batch
review, or pause the schedule) that this run cannot make. Every prior pack
since at least 2026-08-16 has flagged the same growing pile; it has not
shrunk. See §9 for this run's recommendation.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session; fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` credentials | **Not present** | `env \| grep -iE "HIGGSFIELD\|REEL_\|ADMIN_API_KEY\|DATABASE_URL"` returned nothing in this session's shell. |
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

    ls apps/nickstire/docs/reel-packs/                                          → 53 merged packs
    search_pull_requests "repo:.../mainnicks-tire-autonew is:pr is:open reel pack in:title"
                                                                                  → 8 open draft PRs (#1738-#1748, all from 2026-08-20)

Merged packs on disk (53, spanning 2026-08-14 through 2026-08-20): penny
test, tire expiration date, tread-wear fingerprint, battery heat in summer,
check-engine light, squealing-vs-grinding brakes, wheel-bearing hum,
balance-vs-alignment, cabin air filter, coolant color, exhaust-smoke color,
oil-change intervals, plug-vs-patch, pothole damage, repair-authorization
questions, road-salt brake-line corrosion, road-trip tire pre-check,
serpentine-belt squeal, tire sidewall bulge, spare-tire mileage, "noises
that mean stop driving now", strut bounce-test, summer-heat tire pressure,
tire rotation, transmission-fluid color test, tread-depth rain-vs-snow,
why-car-pulls, wiper-blade check, AC not blowing cold, all-season-vs-winter
tires, brake-fluid moisture test, cold-weather tire-pressure light,
CV-joint clicking, power-steering whine, TPMS sensor battery, uneven
tire-wear patterns, won't-start (battery/starter/alternator), battery
terminal corrosion, cloudy headlights, dashboard warning-light colors,
E-Check readiness monitors, fuel smell in cabin, heater not blowing hot,
idle shake (spark plug vs. motor mount), oil dipstick color check,
tailpipe condensation vs. coolant leak, burning-smell diagnosis, clunk over
bumps (sway bar vs. ball joint), engine overheating (first 60 seconds),
heat-shield rattle, spongy brake pedal, timing belt with no warning light,
warped-rotor brake shake, windshield chip that spreads.

Open draft PRs (8, not yet merged so invisible to `ls`): wheel wobble test
(tie rod vs. wheel bearing), musty AC smell (evaporator drain vs. cabin
filter), lug-nut re-torque after wheel service, one new tire on an AWD car
(tread-depth matching), sticking brake caliper (one wheel hot), why one
tire keeps losing air (soapy-water leak localization), reading a tire
sidewall (size/load index/speed rating), radiator fan not spinning at idle.

**"Tire valve stem dry rot / cracking" is not among any of the above.**
`tire sidewall bulge` (merged) and `tread-depth rain-vs-snow` (merged) are
about the tread and casing, not the valve stem; `why one tire keeps losing
air` (open #1745) is a soapy-water leak-localization method covering any
leak source generically, not specifically the valve stem as a distinct
visual/diagnostic subject. Cracked, dry-rotted rubber at the valve base is
a distinct claim ("a slow leak with no puncture") and a distinct macro
visual from all 61 topics above. This exact topic was explicitly PARKED
(not selected) in the 2026-08-20 oil-dipstick pack's own candidate table as
"confirmed non-overlap with the existing backlog" — selected now.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

Given the scale of the existing backlog, candidate scoring this run was
narrowed to topics confirmed absent from both the merged-pack directory and
the 8 open PR titles (§1), rather than re-deriving a fresh slate:

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Valve stem dry rot / cracking (slow leak, no puncture) | Strong — visual, counterintuitive ("no nail, still losing air"), clear macro shot | Yes | No | ✅ **Selected** |
| Shocks/struts leaking oil visible on the shock body | Moderate — decent visual but close to the merged strut bounce-test pack | Yes | Thematically adjacent to an existing merged pack | Parked |
| Wheel alignment camber wear (inner-edge-only wear angle) | Moderate — overlaps with merged "uneven tire wear patterns" and "balance vs alignment" | Yes | Thematically adjacent to two merged packs | Parked |

"Valve stem dry rot" was selected for a strong counterintuitive hook (a
flat tire with no visible puncture), a clean macro visual that reads well
even muted, and confirmed non-overlap with all 61 existing topics.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Rubber valve stems dry out and crack after three to five years" | General automotive/tire-industry maintenance guidance (rubber valve stems are commonly replaced at every tire change per tire-industry practice; not shop-specific) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. |
| "Cracks, splits, or a soft base can indicate a slow leak" | Same — standard tire-service diagnostic knowledge | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "can point to" (approved soft-language pattern, `client/src/lib/facelessReelStudio.ts`). |
| "A cracked stem can point to a tire older than you think" | Inference presented as a possibility, not a certainty — deliberately hedged | **UNKNOWN against this repo's evidence store**, same reasoning; phrased as "can point to," not asserted as fact. |
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
| 1 · HOOK | 0:00–0:04 | "Your tire keeps going flat and there's no nail anywhere in it." |
| 2 · SETUP | 0:04–0:09 | "Check the valve stem. Rubber ones dry out and crack after three to five years." |
| 3 · VALUE | 0:09–0:16 | "Look for cracks, splits, or a stem that feels soft near the base — that's a slow leak hiding in plain sight." |
| 4 · VALUE | 0:16–0:22 | "A cracked stem can point to a tire that's older than you think, not just a bad valve." |
| 5 · CTA | 0:22–0:27 | "Nick's Tire and Auto checks every valve stem free with a tire inspection. Link in bio." |

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
   wide shop shot to signal the tonal shift from diagnostic to CTA.
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** neutral/slightly cool grade on beats 1–4 (diagnostic,
   inspection mood), warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 27s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow macro push-in,
   orbital move, or rack focus, not a still).
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
- **CTA type:** SEND-oriented ("send this to someone whose tire keeps
  losing air"), matching the account's corrected objective (a SAVE-oriented
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
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (50/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Your tire keeps going flat and there's no nail anywhere in it. Check the
> valve stem.
>
> Rubber valve stems dry out and crack after 3-5 years. Look for cracks,
> splits, or a stem that feels soft near the base - that's a slow leak
> hiding in plain sight.
>
> A cracked stem can point to a tire older than you think.
>
> We check every valve stem at no charge with a tire inspection. Send
> this to someone whose tire keeps losing air.
>
> #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "No nail. No screw. Still losing air? Check this."
> Caption: Rubber valve stems dry out and crack over time — a cracked one
> is a slow leak with no visible puncture. Look for cracks or a soft base
> near the rim.
> CTA: Not sure what you're looking at? Call (216) 862-0005 or stop by
> 17625 Euclid Ave — we check it free.

**Ad-ready variant B (question-forward):**

> Hook: "Ever actually looked at your tire's valve stem?"
> Caption: It's rubber, and rubber dries out. A cracked valve stem can leak
> air slowly for weeks before you notice a flat — and it's free to check.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (50/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a shop garage bay,
doesn't feed back into the HOOK frame, a valve-stem macro — no loop plan
was designed), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the valve-stem claims, and that store
wasn't and couldn't be queried live this run — no DB access), and **winning
concept ≥57/60** (`scoreReelConcept()` was not invoked, so this dimension
is scored 0 rather than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"tire valve stem dry rot and cracking: the slow
leak you can see"}`, let the server re-score and re-render for real, and
only then move toward publish.

**Separately, and more importantly than this one pack: before this run the
repo already carried 53 merged reel-pack topics plus 8 open, unmerged draft
PRs from a single day (2026-08-20, #1738–#1748), none merged as of this
run — 61 topics produced, most never reviewed.** This session did not
merge, close, or otherwise touch any other PR — that is outside this run's
assigned scope and each of those PRs belongs to a different session's
branch. This same finding has now been raised in at least five consecutive
packs since 2026-08-16 with no visible change in review cadence.
Recommended next step for the operator, restated plainly: batch-review the
backlog (all are docs-only, zero live side effects, explicitly `READY FOR
HUMAN APPROVAL` not `PUBLISHED`), merge or close as appropriate, and
seriously reconsider whether this scheduled trigger should keep firing
roughly hourly while 61+ packs sit unreviewed — an unreviewed pack has
produced zero shop value regardless of how well-formed it is, and the
per-run cost of writing one is not free (session time, PR-review load, and
GitHub Actions minutes on every draft PR).
