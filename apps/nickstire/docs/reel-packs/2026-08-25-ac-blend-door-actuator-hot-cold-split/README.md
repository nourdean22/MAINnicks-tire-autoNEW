# Reel production pack — "AC blows hot on one side, cold on the other? It's not the compressor" (2026-08-25)

Scheduled-task run · 2026-08-25 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **BLENDCHECK**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

**⚠️ Backlog — now 98 topics, growing ~9-10/day, still no read-back that
anything is being reviewed. Read before merging this PR.** This is the same
finding raised in at least eight consecutive packs since 2026-08-16, and the
count has not stopped growing: **89 merged packs on disk** (up from 78 two
days ago) **plus 9 open, unmerged draft PRs** (#1816-#1826, spanning
2026-08-23 21:34 through 2026-08-25 09:34) **= 98 topics produced.** This
session has no way to confirm any of the 89 merged ones were ever turned
into an actual rendered/published Reel — merging a docs PR is not evidence
a video exists. If nothing downstream is consuming these packs, the
recommendation is the same as every prior run's: **pause new pack
production and reconcile the backlog before adding a 99th topic.** This run
adds one anyway, per the scheduled task's instructions, but the growth rate
is the more urgent fact than any single topic below.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session; fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` credentials | **Not present** | `env \| grep -iE "REEL_\|HIGGSFIELD\|ADMIN_API_KEY\|DATABASE_URL"` returned no matching values in this session's shell. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (the free local-ffmpeg lane, not Higgsfield/Seedance) as of its last-verified date. Not re-confirmed live this run. |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | Not read live | Not set in this session's shell; no server process to query. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| Local render (ffmpeg / CapCut) | **Not available** | `which ffmpeg` returned nothing (not installed) in this session's shell; no CapCut or equivalent GUI editor present. |
| ChatGPT / external LLM | N/A | This session's own model wrote the script and prompts below — no external LLM call was needed or made. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is §4 below. **No MP4 exists.**

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls -d apps/nickstire/docs/reel-packs/2026-*/ | wc -l          → 89 merged packs
    search_pull_requests "... is:pr is:open reel pack in:title"    → 9 open draft PRs

Open draft PRs at time of this run: water pump weep hole leak (#1821),
turbo whistle vs boost leak hiss (#1820), horn stops working (#1819), car
shudders under acceleration / coil vs plug (#1826), failing O2 sensor /
rough idle / poor MPG (#1825), sweet smell from vents / leaking heater core
(#1816), white smoke + milky oil cap / head gasket (#1823), trunk/hatch
won't stay up / gas strut wear (#1818), washer fluid won't spray (#1817).
None of these concern HVAC blend-door/actuator behavior.

**"AC blows cold on one side, warm on the other — blend door actuator, not
the compressor" is not among any of the 89 merged packs or 9 open PRs
above.** The closest prior topics are `ac-not-blowing-cold` (merged 08-18,
about the AC not cooling at all — compressor/refrigerant framing),
`musty-ac-smell-evaporator-vs-filter` (merged 08-20, a smell diagnostic, not
temperature), `heater-not-blowing-hot` (merged 08-20, heat side only, no
dual-zone framing), and `ac-recharge-myth-sealed-system` (merged 08-21,
about refrigerant recharge, a different subsystem). None address the
split-temperature symptom or the blend-door-actuator mechanism — that
framing is new.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| AC blows cold on one side, warm on the other — blend door actuator | Strong — visually distinctive split-temperature hook, reframes a "compressor is dead" fear into a cheaper, specific-part diagnosis | Yes | No | ✅ **Selected** |
| Cabin fan speed stuck on one setting (blower motor resistor variant) | Moderate — overlaps thematically with the already-merged `blower-motor-resistor` pack (08-21) | Yes | Yes (adjacent, same component family) | Parked |
| AC compressor clutch not engaging (no cold air at all, any zone) | Moderate — close to the merged `ac-not-blowing-cold` pack's framing | Yes | Yes (overlapping angle) | Parked |

"Blend door actuator, split temperature" was selected for a strong,
visually distinct hook (two vents, one cold one warm, side by side), a
mechanism the driver can self-diagnose by ear (clicking behind the dash),
and confirmed non-overlap with all 98 existing topics.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A small motor behind your dash aims a flap that mixes hot and cold air for each side" (blend door actuator mechanism) | General automotive HVAC diagnostic knowledge (blend-door actuators controlling dual-zone air-mix flaps is a standard, widely documented HVAC design across most modern vehicles) — not shop-specific | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read; no `DATABASE_URL` present). No `EvidenceRecord` citation is attached. |
| "Hear a clicking or ticking from the dash when you adjust the temperature? That's the motor straining against a stuck door" | Standard shop-floor diagnostic symptom, widely documented in general automotive repair references (a failing/stripped actuator gear producing an audible click when it repeatedly tries and fails to seat is a common, well-known failure signature) | **UNKNOWN against this repo's evidence store**, same reasoning. Narration frames it as "that's usually" / a symptom to notice, not a universal diagnostic guarantee — some actuator failures are silent. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** Sidesteps the channel gap noted below. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack.

**Additional caveat specific to this topic, not in prior packs:** not every
vehicle has dual-zone climate control or a dash-accessible clicking
actuator — single-zone systems and some newer electronic-only actuators
fail silently. The narration avoids claiming universality ("usually," not
"always"), but a human review pass should confirm the hook doesn't overpromise
for single-zone vehicles before publish.

---

## 4 · Full production pack

### Script — word-for-word, timed (28s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "One side of your AC blows ice cold. The other stays warm." |
| 2 · SETUP | 0:04–0:09 | "That's rarely the compressor. It's usually a blend door actuator stuck between hot and cold." |
| 3 · VALUE | 0:09–0:16 | "A small motor behind your dash aims a flap that mixes hot and cold air for each side. When it fails, one side gets stuck." |
| 4 · VALUE | 0:16–0:23 | "Hear a clicking or ticking from the dash when you adjust the temperature? That's the motor straining against a stuck door." |
| 5 · CTA | 0:23–0:28 | "Don't let it turn into a full dash-apart repair. Nick's Tire and Auto can check it before it gets worse." |

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
  placement recommended, all-caps short phrases matching the house caption
  style used in prior packs.

### Editing / assembly instructions (matches the render-integrity contract)

1. Assemble beats in listed order, hard cuts only (no crossfades) between
   beats 1→2 and 2→3; a 4-6 frame quick dissolve is acceptable between 3→4
   to sell the split-comparison macro shot.
2. Each beat's on-screen duration must match its `window` in `brief.json`
   to within 0.75s (mirrors the server's own render-integrity gate,
   `reelAssembly.ts` "#800/#801" — container and video-stream duration
   within 0.75s of the storyboard contract, plus a 3s SAVE-CTA freeze frame
   appended at the end).
3. Burn in captions per `captions.srt` timing, bottom-third safe area
   (avoid the bottom ~12% where IG/FB UI overlays the CTA sticker).
4. Mixed audio: voiceover centered, no music bed (see §6), optional very
   low ambient garage room-tone under beat 5 only.
5. Export 1080x1920, H.264, 30fps, target ≤28s total including the 3s
   freeze — matches `postingSpecs` in `brief.json`.
6. **Muted-first requirement:** captions must carry the full message with
   sound off — verified by re-reading `captions.srt` end-to-end with no
   audio; it does.

---

## 5 · Credit-risk and fallback routing

No generation call was made, so no ledger entry (RESERVE/SETTLE/RELEASE)
exists for this run. Estimated cost if rendered later, from
`generationLedger.ts` `COST_ESTIMATES_USD` (operator-tunable estimates, not
metered prices):

| Route | Estimate | Applies here? |
|---|---|---|
| `template_stock_clip` (free local ffmpeg lane) | $0.00/clip | **Likely route** — `docs/operations/REEL-PIPELINE.md` states prod is currently pinned to `template_stock` via `REEL_VIDEO_PROVIDER`. Not re-confirmed live this run. |
| `seedance_clip` | $0.25/clip (labeled ASSUMPTION in source) | Only if provider is switched off `template_stock`. 5 beats × $0.25 ≈ $1.25 estimated, if used. |
| `veo_second_720p` | $0.10/sec (Google-published) | Not the pinned route per the doc above; not estimated further. |

Today's `autonomy_policy_versions.limits.maxGenerationCostPerDayUsd` was not
read (would require a live DB read against production, which this session
does not have and will not make per the hard rule). Treat daily-budget
headroom as `UNKNOWN` until a session with real DB access confirms it.

---

## 6 · Audio / music rights — real gap, not resolved this run

No rights ledger for music exists in this repo (confirmed by prior packs'
searches, not re-searched this run since no new capability was added).
This pack assigns **no music bed** — voiceover + captions + optional
ambient room-tone only — so no rights claim is made or needed for this
specific asset. If a future editor adds music at render time, a license
record must be created before publish; this gap is a repo-level capability
gap, not something this run can close.

---

## 7 · QA matrix

| Gate | Result | Basis |
|---|---|---|
| `calculateReelQualityScore()` (75-pt brief gate, min 70) | **UNKNOWN** | Function not called — no server process in this session. `brief.json` carries a self-estimate (49/75) only, explicitly labeled as not authoritative. |
| Server re-score at enqueue | **BLOCKED** | No `enqueueReelJob` call made; nothing was enqueued. |
| Render-integrity gate (`reelAssembly.ts` #800/#801 — duration match, frame count, motion-diff MD5) | **BLOCKED — no render exists** | No MP4 was produced this run; there is nothing to probe. |
| `renderedQa.ts` vision critic | **BLOCKED — no render exists** | Same as above. |
| `evaluateReelPublishGate()` consolidated gate | **BLOCKED — no render/enqueue exists** | Same as above; would require a live job row. |
| Claim-safety wording (no in-reel prices, no guarantees, no fearmongering) | **PASS (manual read)** | Script in §4 was re-read end-to-end: no price, no warranty language, no "always"/guarantee claims, no fearmongering — uses "usually," "can," "check it" per the approved soft-language list in `facelessReelStudio.ts`. |
| Muted-first captions | **PASS (manual read)** | `captions.srt` carries the full message text with no audio required; verified in §4 step 6. |
| Faceless / no on-screen humans | **PASS (manual read)** | Every `visualPrompt` in `brief.json` explicitly excludes hands/faces/figures, both in the prompt text and the standing negative prompt. |

---

## 8 · IG/FB copy + ad-ready variants

**Primary post copy:**

> One side of your AC is ice cold. The other's still warm. ❄️🔥 That's
> almost never the compressor — it's usually a blend door actuator stuck
> between hot and cold. Hear a click when you adjust the temp? That's your
> tell. Stop by and we'll take a look before it turns into a bigger repair.
> #nickstireandauto #euclidohio #carac #autorepair #clevelandcars

**Ad variant A (hook-first):**
- Hook: "Why is one side of your AC always warmer than the other?"
- Caption: "It's not always the compressor. A stuck blend door actuator
  can lock one side at the wrong temperature — and it usually clicks when
  it's failing. Worth a quick check before it gets worse."
- CTA: "Send us a message — we'll take a look."

**Ad variant B (symptom-first):**
- Hook: "That clicking sound behind your dash isn't nothing."
- Caption: "If one side of your AC won't match the other, a small motor
  behind the dash may be stuck fighting a jammed flap. Catching it early
  is a lot cheaper than a full dash-apart repair."
- CTA: "Stop by Nick's Tire and Auto — we'll check it out."

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY`, because the
75-point quality gate and render-integrity gate could not be run this
session (§7), and the topic-specific vehicle-scope caveat in §3 needs a
human read before publish. Not `PUBLISHED WITH READ-BACK`: no
`igPostId`/permalink exists, and none was attempted — this is a scheduled,
unattended firing, and the operator skill's hard rule blocks any publish
action without a live, in-the-moment instruction, which this run does not
have.

**Recommended next action for a human reviewer, in order:**
1. Read §0's backlog warning — 98 topics now on disk/in-flight with no
   confirmed downstream consumption. Consider pausing new-pack production
   until that's reconciled, independent of this specific pack's merits.
2. If proceeding with this topic: confirm the single-zone-vehicle caveat
   from §3 doesn't need a caption addition, then run it through a real
   `getHiggsfieldAccountHealth()`-capable session for the 75-pt score and
   an actual render via the `template_stock` or Higgsfield route.
3. Do not call `{action:"publish"}` on this or any other pack from a
   scheduled/unattended context — that requires a live operator instruction
   at the time of the call, per the skill's hard rule.
