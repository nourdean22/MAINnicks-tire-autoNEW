# Reel production pack — "Radiator cap pressure test: coolant loss with no visible leak" (2026-08-21)

Scheduled-task run · 2026-08-21 · mode `INTELLIGENCE`/`SCHEDULED` (pack only,
per `.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword
**RADCAP**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**Backlog check, current as of this run (not repeated at length — see prior
packs for the full history):** 5 open, unreviewed `reel pack: ...` draft PRs
(#1769, #1770, #1772, #1773, #1774), all created roughly hourly between
16:32Z and 20:31Z today. This is down from the 12 open PRs the last status
report (`BACKLOG-STATUS-2026-08-21-0729.md`) found at 07:29Z — the backlog is
shrinking, not stuck, so this run proceeds with a normal pack rather than
another status-only note. See §9 for the current number.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `INTELLIGENCE`/`SCHEDULED` producing a full `PRODUCTION`-shaped
pack. Stops short of any `/api/admin/reel-canary` call
(`start`/`advance`/`qa`/`publish`) and short of any live read against the
production TiDB database, per the operator skill's hard rule for a
non-live, scheduled firing.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` / `REEL_*` / TTS / Meta env vars | **Not present** | `env \| grep -iE 'HIGGSFIELD\|ADMIN_API_KEY\|DATABASE_URL\|REEL_\|OPENAI\|ANTHROPIC_API\|META_\|INSTAGRAM\|ELEVENLABS\|TTS'` returned nothing (exit 1) in this session's shell. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `apps/nickstire/docs/operations/REEL-PIPELINE.md:32` states prod reads `template_stock` (verified 2026-08-11), **not** `higgsfield` — the paid lane was dropped; auto-select would otherwise prefer Veo if a live Gemini key existed, so the pin matters. |
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session; fresh repo checkout, not the running app. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless of credentials. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| ChatGPT / external LLM | N/A | This session's own model wrote the script and prompts below — no external LLM call was needed or made. |
| CapCut / GUI editor | Not available | No GUI tool in this environment; editing instructions in §4 are written for a human (or ffmpeg) to execute manually. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is. **No MP4 exists.**

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/                    → 70 merged pack directories
    list_pull_requests(state=open, sort=created)          → 5 open draft PRs (#1769, #1770, #1772, #1773, #1774)

Open PR topics (5): stuck PCV valve burning oil with no puddle (#1769), spark
plug wire/coil boot arcing at night (#1770), ABS light on with brakes still
normal (#1772), key fob dead battery with dash still lit / no push-button
start (#1773), power window stuck halfway — motor vs. regulator cable
(#1774). None overlap "radiator cap pressure test."

Merged packs already covering cooling-system topics: `radiator-fan-idle-overheat`
(2026-08-20, fan not spinning at idle), `engine-overheating-first-60-seconds`
(2026-08-19, general overheating first-response), `coolant-color`
(2026-08-17, reading coolant color for contamination), `tailpipe-condensation-vs-coolant-leak`
(2026-08-20, differentiating exhaust condensation from a coolant leak). None
of these test the radiator cap's pressure seal as the cause of coolant loss
with **no visible puddle** — that is a distinct failure mode (a sealed-system
pressure leak past the overflow, not a hose/gasket/exhaust condensation
issue) and a distinct macro visual (the cap's spring-loaded seal, not the
fan, the coolant's color, or the tailpipe).

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Radiator cap pressure test (coolant loss, no visible leak) | Strong — counterintuitive ("no puddle, still losing coolant"), clean macro visual on the cap's seal/spring | Yes | No | ✅ **Selected** |
| Thermostat stuck open (engine never reaches temp, poor heat) | Moderate — less visual, harder to shoot as a macro without disassembly | Yes | No, but weaker visual candidate | Parked |
| Heater core smell / sweet smell in cabin | Moderate — overlaps thematically with `fuel-smell-in-cabin` (merged 2026-08-20) on "smell diagnosis" framing | Yes | Thematically adjacent to an existing merged pack | Parked |

"Radiator cap pressure test" was selected for a strong counterintuitive hook
(coolant disappearing with zero visible sign), a clean macro visual on a
part most drivers have never actually looked at closely, and confirmed
non-overlap with the four existing cooling-system-adjacent packs.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "The cap holds pressure in the system" | General automotive cooling-system operation (pressurized cooling systems raise coolant boiling point; standard, non-shop-specific mechanical fact) | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. |
| "A worn seal or weak spring lets coolant boil off past the overflow before you ever see a drop on the ground" | Same — standard cooling-system diagnostic knowledge | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing deliberately hedged ("can," not "will"). |
| "A cap that won't hold pressure can look brand new and still be the reason you keep topping off" | Inference presented as a possibility, not asserted as certain | **UNKNOWN against this repo's evidence store**, same reasoning; uses the approved soft-language pattern from `client/src/lib/facelessReelStudio.ts` ("can be," not "is"). |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, which sidesteps the channel gap below. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack.

---

## 4 · Full production pack

### Script — word-for-word, timed (28s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Coolant keeps disappearing and there's no puddle anywhere under the car." |
| 2 · SETUP | 0:04–0:09 | "It might not be a hose or a gasket. Check the radiator cap first." |
| 3 · VALUE | 0:09–0:17 | "The cap holds pressure in the system. A worn seal or a weak spring lets coolant boil off past the overflow before you ever see a drop on the ground." |
| 4 · VALUE | 0:17–0:23 | "A cap that won't hold pressure can look brand new and still be the reason you keep topping off." |
| 5 · CTA | 0:23–0:28 | "Nick's Tire and Auto pressure-tests your cooling system free with any inspection. Link in bio." |

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
   gate):** container duration within 0.75s of 28s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow macro push-in,
   orbital move, or rack focus, not a still).
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
- **CTA type:** SEND-oriented ("send this to someone whose car keeps
  needing coolant topped off"), matching the account's corrected objective
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

> Coolant keeps disappearing and there's no puddle anywhere under the car.
> It might not be a hose or a gasket - check the radiator cap first.
>
> The cap holds pressure in the system. A worn seal or a weak spring lets
> coolant boil off past the overflow before you ever see a drop on the
> ground.
>
> A cap that won't hold pressure can look brand new and still be the reason
> you keep topping off.
>
> A cooling system pressure test during any inspection shows whether the
> cap still holds the pressure it is rated for.
>
> #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "No puddle. No leak you can see. Still losing coolant?"
> Caption: A worn radiator cap seal lets coolant boil off past the overflow
> with zero visible sign — it can look brand new and still be the problem.
> CTA: Not sure what's going on? Call (216) 862-0005 or stop by 17625
> Euclid Ave — we pressure-test it free.

**Ad-ready variant B (question-forward):**

> Hook: "When's the last time anyone checked your radiator cap?"
> Caption: It's a simple spring-loaded seal, and it wears out like any
> other part — a weak one lets coolant disappear with no puddle to find.
> CTA: Stop by and we'll pressure-test it, free — no pressure (the sales
> kind).

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (50/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a shop garage bay, doesn't
feed back into the HOOK frame, a radiator-cap macro — no loop plan was
designed), **sourced fact** (no `EvidenceRecord` in `evidenceResolver.ts`
currently backs the pressure-cap claims, and that store wasn't and couldn't
be queried live this run — no DB access), and **winning concept ≥57/60**
(`scoreReelConcept()` was not invoked, so this dimension is scored 0 rather
than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"radiator cap pressure test: coolant loss with no
visible leak"}`, let the server re-score and re-render for real, and only
then move toward publish.

**Backlog, current count:** 5 open, unreviewed `reel pack: ...` draft PRs
(#1769, #1770, #1772, #1773, #1774) plus this run's new PR once opened — down
from 12 at the 07:29Z status report today. The trend over the last ~13 hours
is toward the backlog clearing, not growing, so this run did not repeat the
"pause the schedule" recommendation verbatim; it will be worth re-flagging
only if the open count climbs back into double digits on a future run.
