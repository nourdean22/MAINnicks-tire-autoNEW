# Reel production pack — "Trunk won't stay up: worn gas struts, not the latch" (2026-08-23)

Scheduled-task run · 2026-08-23 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **STRUTSAG**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.

**Backlog note, kept short this run.** The repo now carries **89 reel-pack
topic directories** plus **2 open draft PRs** (#1816 heater core smell,
#1817 washer fluid spray), all produced by this same hourly-ish scheduled
trigger with essentially zero merges. Seven-plus prior packs have already
documented this at length in their PR bodies, and one already sent a direct
push notification to the operator about it. Nothing material has changed
since then, so this run does not repeat the full essay or send a second
notification — see any pack dated 2026-08-22 or 2026-08-23 for the detailed
history if needed. Restated once, briefly: batch-review and merge/close the
backlog when convenient; every pack in it is docs-only with zero live side
effects.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session; fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` credentials | **Not present** | `env \| grep -iE "database_url\|higgsfield\|admin_api_key\|reel_"` returned nothing this run. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (free local-ffmpeg lane), not re-confirmed live this run. |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | Not read live | No server process to query. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires explicit live operator instruction, which this run does not have. |
| ChatGPT / external LLM | N/A | This session's own model wrote the script and prompts below. |
| CapCut / GUI editor | Not available | Editing instructions in §4 are written for a human (or ffmpeg) to execute manually. |

**Conclusion: zero live motion route this run.** Per the skill's "Producing
a pack when the motion route is unavailable" section, the correct output is
a full production-ready pack, not a claimed render. **No MP4 exists.**

**Repetition check (file + PR title search, not the live `reel_jobs` table):**

    ls apps/nickstire/docs/reel-packs/ | grep -iE "trunk|hatch|liftgate|tailgate|gas strut"  → no match
    89 existing pack directories, 2 open PRs (#1816 heater core, #1817 washer fluid) — neither
    overlaps trunk/hatch gas struts.

This is directional, not a substitute for the real `reel_jobs` ledger, which
this session cannot reach (no `DATABASE_URL`).

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Trunk/hatch won't stay up — worn gas struts | Strong — near-universal experience (every driver has fought a sagging trunk lid), clean two-shot visual, distinct safety payoff (a falling lid) | Yes | No — checked against all 89 existing topics and both open PRs | ✅ **Selected** |
| Power window stuck halfway — regulator vs. motor | N/A | — | Already merged (2026-08-21) | Rejected |
| Interior rattle from loose trim clips | Weak — no clean single visual, low diagnostic payoff | Yes | No | Parked |

"Trunk won't stay up" was selected for a strong, near-universal hook, a
clean two-location macro visual (lid + strut cylinder), a genuine safety
angle (a falling lid on someone loading groceries), and no overlap with any
existing topic or open PR.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A trunk/hatch that sinks back down is usually the gas struts, not the latch" | General automotive diagnostic knowledge (gas struts are the standard lift mechanism on trunks/hatches; a failed strut sagging while the latch still engages is a textbook distinction) — not shop-specific | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` was not queried live this run (would be a prod DB read; no `DATABASE_URL` present). No `EvidenceRecord` citation is attached. Narration hedges with "usually," not asserted as universal. |
| "Each strut is a sealed gas cylinder that loses pressure as the seal wears with heat/cold cycling" | Standard mechanism for nitrogen gas struts, widely documented in general automotive repair references | **UNKNOWN against this repo's evidence store**, same reasoning. |
| "Push-test: holds steady = latch fine, drifts down = struts" | Standard shop-floor diagnostic heuristic | **UNKNOWN against this repo's evidence store**, presented as "a quick check," not a substitute for a professional inspection. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` not re-read this run (unnecessary — topic doesn't reference a fact) | **N/A — deliberately avoided**, sidestepping the `FactChannel` gap (no `"reel"` channel exists yet) noted in prior packs. |

---

## 4 · Full production pack

### Script — word-for-word, timed (28s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Your trunk or hatch slowly sinks back down after you open it, or you're propping it up yourself." |
| 2 · SETUP | 0:04–0:09 | "That's not the latch. It's the gas struts, the two rods that hold the lid open, losing pressure." |
| 3 · VALUE | 0:09–0:18 | "Each strut is a sealed gas cylinder. Years of heat and cold cycling wear the internal seal, so pressure leaks out and it can't hold the lid's weight anymore." |
| 4 · VALUE | 0:18–0:24 | "Quick check: push up on the lid. If it holds steady, the latch is fine. If it drifts back down, it's the struts." |
| 5 · CTA | 0:24–0:28 | "Don't let it drop on you while you're loading groceries. We can swap the struts before one lets go completely." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes, self-estimated score): [`brief.json`](./brief.json).

### Asset list

- **Footage (per beat), Higgsfield-style generation prompts** — see
  `brief.json` `beats[].visualPrompt`, each paired with a
  `stockSearchTerms` fallback for a licensed stock-footage lane if
  generation isn't used. Standing negative prompt on every beat:
  `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`.
- **Voiceover:** not generated this run (no TTS route connected). Script
  source is the narration column above, fed verbatim to `reelVoice.ts` at
  real render time.
- **Music bed:** none assigned — see §6 (real gap, not an oversight).
- **Captions:** [`captions.srt`](./captions.srt), 11 cues, bottom-third
  safe-zone timing, all-caps short-line style matching prior packs on this
  account.

### Editing instructions

1. **Layer order (bottom to top):** background footage → subtle color grade
   → caption burn-in (bottom-third) → CTA end-card text on beat 5 only.
2. **Transitions:** hard cuts between beats 1→2→3→4; a short cross-fade
   (6–8 frames) into beat 5, which deliberately reuses beat 1's framing
   (open trunk, side view, strut visible) so the loop point reads as
   intentional rather than a hard jump.
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** neutral/slightly cool grade on beats 1–4 (diagnostic mood),
   warm shift on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 28s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no
   static/looped single image — every beat here is a slow macro push-in,
   orbital move, or a lid drifting downward, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 28s (within the 15–60s target range and the account's
  prior 25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed cadence (7:00 AM or 2:00 PM
  ET, per prior packs) — do not post ad hoc, and check the day's feed-cap/
  spacing status before scheduling (see §5)
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND-oriented ("send this to someone whose trunk does
  this"), matching the account's corrected objective from an earlier pack's
  finding (a SAVE-oriented CTA measured `saved = 0.00` across the account's
  first 8 reels)

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
estimate, not a metered price.

**Daily budget ceiling:** `UNKNOWN` — `maxGenerationCostPerDayUsd` lives in
the latest `autonomy_policy_versions` row, not reachable this run (no
`DATABASE_URL`, no live server). Account balance
(`getHiggsfieldAccountHealth().balanceCredits`) is likewise `UNKNOWN`.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, same one
noted in every prior pack — not a new finding). This pack sidesteps it
deliberately: **no music bed is assigned.** The reel is voiceover +
captions + optional ambient garage room-tone, which scores well on the
pipeline's muted-first requirement since captions alone carry full meaning.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED`
pending an actual render:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; `brief.json` carries a self-estimate (56/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — must return `proceed` before any real publish, and was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption (SEND-oriented):**

> Your trunk or hatch slowly sinks back down after you open it, or you're
> propping it up yourself. That's usually not the latch — it's the gas
> struts, the two rods that hold the lid open, losing pressure.
>
> Each strut is a sealed gas cylinder. Years of heat and cold cycling wear
> the internal seal, so pressure leaks out and it can't hold the lid's
> weight anymore.
>
> Quick check: push up on the lid. If it holds steady, the latch is fine.
> If it drifts back down, it's the struts.
>
> Don't let it drop on you while you're loading groceries. We can swap the
> struts before one lets go completely. Send this to someone whose trunk
> does this.
>
> #cartips #clevelandohio #carmaintenance #autorepair #trunkfix

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Your trunk won't stay up on its own anymore?"
> Caption: That's the gas struts losing pressure, not a broken latch — a
> worn seal, not a broken lid.
> CTA: Not sure what's going on? Call (216) 862-0005 or stop by 17625
> Euclid Ave — we check it free.

**Ad-ready variant B (question-forward):**

> Hook: "Ever wonder what actually holds your trunk lid open?"
> Caption: Two gas struts. When their seal wears out, the lid just can't
> hold its own weight anymore — and one day it can fall.
> CTA: Stop by and we'll take a look, free — no pressure.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (56/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor,
specifically on **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` backs the strut-wear claim, and that store wasn't and
couldn't be queried live this run) and **winning concept ≥57/60**
(`scoreReelConcept()` was not invoked, so this dimension is scored 0 rather
than assumed passing).
Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`,
nothing was generated, rendered, or posted. Not `BLOCKED` outright — the
pack is complete and usable; an operator (or a live-authorized session) can
hand it to the real pipeline via `/api/admin/reel-canary
{action:"start", topic:"trunk or hatch won't stay up: worn gas struts, not
the latch"}`, let the server re-score and re-render for real, and only then
move toward publish.
