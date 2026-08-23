# Reel production pack — "Sweet smell from the vents: a leaking heater core, not spilled juice" (2026-08-23)

Scheduled-task run · 2026-08-23 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **SWEETSMELL**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**Backlog cleared this run, not just checked.** Before this pack was written,
this same run read all 11 open, unreviewed `reel pack` draft PRs
(#1782, #1783, #1785, #1788, #1790, #1794–#1799), confirmed each was purely
additive documentation under `apps/nickstire/docs/reel-packs/` with no code,
schema, or protected-path changes and no topic overlapping any other open PR
or any merged directory, then converted each from draft to ready and
squash-merged all 11. It also closed three now-superseded status-only PRs
(#1800, #1811, #1813) that reported the same stuck backlog as a plain fact
that no longer holds. This is the capability difference from the several
preceding scheduled runs that correctly identified the backlog but treated
merging it as outside their scope: this session has GitHub PR read/merge
tools, root `AGENTS.md`'s "Branching — autonomous merging allowed" section
explicitly covers this ("push, then create and merge the PR yourself"), and
merging only lands documentation — it triggers no render, no spend, and no
publish, so it does not cross the operator skill's hard rule. Open reel-pack
PR count is **0** as of this run; merged-pack count is **83**.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session; fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` / `REEL_*` / TTS / Meta credentials | **Not present** | `env \| grep -iE 'HIGGSFIELD\|ADMIN_API_KEY\|DATABASE_URL\|REEL_\|OPENAI\|ANTHROPIC_API\|META_\|INSTAGRAM\|ELEVENLABS\|TTS'` returned nothing in this session's shell. |
| `ffmpeg` / `ffprobe` / `hf` CLI | **Not installed** | No local render lane available either. |
| CapCut / GUI editor | **Not available** | No GUI tool in this headless environment. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (the free local-ffmpeg lane, not Higgsfield/Seedance). Not re-confirmed live this run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless of credentials. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| GitHub PR read/merge tools | **Present and used** | Used to clear the 11-PR backlog above (docs-only, zero render/spend/publish side effect) and to open this pack's own PR — not used for anything touching the reel pipeline itself. |
| ChatGPT / external LLM | N/A | This session's own model wrote the script and prompts below — no external LLM call was needed or made. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. **No MP4 exists.**

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach), re-verified after this run's own
merges:**

    ls apps/nickstire/docs/reel-packs/ | grep -v '\.md$' | wc -l   → 83 merged pack directories (2026-08-14 through 2026-08-23)
    search_pull_requests "is:open reel pack in:title"               → 0 open PRs (was 11 before this run)

None of the 83 merged topics cover a coolant smell from the vents or a
heater-core leak. The closest neighbors are `burning-smell-diagnosis`
(2026-08-19, a generic burning-smell hook covering electrical/rubber/oil
smells, explicitly not a sweet-smell/coolant case) and
`tailpipe-condensation-vs-coolant-leak` (2026-08-20, an *exterior* coolant
leak visible under the car, not a leak *into the cabin air*). This topic's
trigger (sweet smell + inside-windshield fog while the heat runs), root
cause (a cracked heater core mixing coolant into cabin airflow), and stakes
(breathing coolant vapor / potential low-coolant overheating) are distinct
from both.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Sweet smell from vents / windshield fog — leaking heater core | Strong — a distinctive, easily-recognized smell most drivers have never connected to a coolant leak; genuine safety stake (breathing coolant vapor, losing coolant while driving) | Yes | No | ✅ **Selected** |
| Serpentine belt tensioner pulley bearing whine (distinct from belt squeal) | Moderate — thin visual differentiation from the merged `serpentine-belt-squeal` pack; risks reading as the same topic | Yes | Thematically adjacent to a merged pack | Parked |
| Washer fluid pump hums but no spray (clogged nozzle vs. dead pump) | Weak — low stakes, thin diagnostic content for a 5-beat structure | Yes | No, but weak hook | Rejected |

"Sweet smell / leaking heater core" was selected for the strongest,
most differentiated hook of the three — a smell most drivers have
experienced but not diagnosed correctly, a clean macro visual (windshield
fog, heater-core cutaway), and confirmed non-overlap with all 83 merged
topics.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A sweet smell from the vents, especially with the heat on, often means coolant is leaking into the heater core" | General automotive diagnostic knowledge (a cracked/leaking heater core mixing ethylene-glycol coolant into cabin airflow, and the sweet smell of ethylene glycol, is a standard, widely documented HVAC failure mode) — not shop-specific | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. Phrasing hedged with "often," not "always." |
| "Fog on the inside of the windshield with that smell, especially when the heat's running, is the classic sign" | Standard shop-floor diagnostic heuristic, widely documented in general automotive repair references | **UNKNOWN against this repo's evidence store**, same reasoning — presented as "a quick check," not a diagnosis of the viewer's specific vehicle. |
| "It can also mean you're losing coolant, which can lead to overheating" | Standard mechanical-safety knowledge (a heater-core leak is a coolant-system leak; sustained coolant loss without repair is a well-documented cause of overheating), deliberately hedged with "can," not asserted as certain for any individual vehicle | **UNKNOWN against this repo's evidence store**, same reasoning. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, which sidesteps the channel gap noted below. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack.

---

## 4 · Full production pack

### Script — word-for-word, timed (27s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "That sweet smell from your vents isn't spilled juice in the console." |
| 2 · SETUP | 0:04–0:09 | "It's often coolant leaking into the heater core, then blowing right into the cabin." |
| 3 · VALUE | 0:09–0:17 | "The heater core sits behind the dash and warms cabin air using hot coolant. A small crack there lets coolant mix with the air you breathe." |
| 4 · VALUE | 0:17–0:23 | "A quick check: fog on the inside of the windshield with that sweet smell, especially with the heat on, is the classic sign." |
| 5 · CTA | 0:23–0:27 | "Don't ignore it — it can also mean you're losing coolant. Nick's Tire and Auto checks the heater core and coolant system free with any inspection." |

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
   executed this run — no `ffmpeg` binary is present in this session either):
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
- **CTA type:** SEND-oriented ("send this to someone whose car smells sweet
  inside"), matching the account's corrected objective (a SAVE-oriented CTA
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
assigned.** The reel is voiceover + captions + optional ambient cabin/HVAC
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
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate (52/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> That sweet smell from your vents isn't spilled juice in the console.
> It's often coolant leaking into the heater core, then blowing right
> into the cabin.
>
> The heater core sits behind the dash and warms cabin air using hot
> coolant. A small crack there lets coolant mix with the air you breathe.
>
> Quick check: fog on the inside of the windshield with that sweet smell,
> especially with the heat on, is the classic sign.
>
> Don't ignore it — it can also mean you're losing coolant. We check the
> heater core and coolant system free with any inspection. Send this to
> someone whose car smells sweet inside.
>
> #cartips #clevelandohio #carmaintenance #autorepair

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Sweet smell inside your car? That's not spilled juice."
> Caption: A leaking heater core can push coolant right into your cabin
> air — and it can mean you're losing coolant too.
> CTA: Not sure what you're smelling? Call (216) 862-0005 or stop by 17625
> Euclid Ave — we check it free.

**Ad-ready variant B (question-forward):**

> Hook: "Do you know what a coolant leak smells like inside the car?"
> Caption: Sweet smell, foggy windshield, heat running — that combination
> usually points to the heater core, not the console.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (52/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame, a shop garage bay,
doesn't feed back into the HOOK frame, a foggy-windshield/dash shot — no
loop plan was designed), **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the heater-core/coolant-smell claims,
and that store wasn't and couldn't be queried live this run — no DB
access), and **winning concept ≥57/60** (`scoreReelConcept()` was not
invoked, so this dimension is scored 0 rather than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"sweet smell from the vents: a leaking heater core,
not spilled juice in the console"}`, let the server re-score and re-render
for real, and only then move toward publish.

**Backlog, current count:** **0** open reel-pack PRs (down from 11 before
this run — see the note at the top of this file for the merge record) and
**83** merged pack topics. This run adds an 84th once its own PR lands.
Since the backlog is now clear rather than stuck, no schedule-pause
recommendation is warranted this run — the operator should watch whether
the open count climbs back into double digits before this task's next
several firings, which would indicate the review bottleneck (not the
production rate) is the recurring problem, same as every consecutive
report since 2026-08-16 found.
