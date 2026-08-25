# Reel production pack — "Washer fluid won't spray? Check these three, in order" (2026-08-23)

Scheduled-task run · 2026-08-23 · mode `SCHEDULED`/`INTELLIGENCE` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **WASHERJET**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
never authorizes a real `reel-canary` generate/publish call or a live
production-DB read. This session made none of those calls. See §1 and §9.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `SCHEDULED` / `INTELLIGENCE` — research, score, and hand back a full
pack. Stops short of any `/api/admin/reel-canary` call
(`start`/`advance`/`qa`/`publish`) and short of any live read against the
production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session; fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` / `REEL_*` / `OPENAI` / `ANTHROPIC_API` / `META_*` / `INSTAGRAM` / `ELEVENLABS` / `TTS` env vars | **Not present** | `env \| grep -iE "HIGGSFIELD\|ADMIN_API_KEY\|DATABASE_URL\|REEL_\|OPENAI\|ANTHROPIC_API\|META_\|INSTAGRAM\|ELEVENLABS\|TTS"` returned nothing in this session's shell. |
| `ffmpeg` | **Not present** | `which ffmpeg` returned nothing. No local render path even for the free `template_stock` lane. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (the free local-ffmpeg lane, not Higgsfield/Seedance) as of its last-verified date. Not re-confirmed live this run. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| ChatGPT / external LLM | N/A | This session's own model wrote the script and prompts below — no external LLM call was made or needed. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| CapCut / GUI editor | Not available | No GUI tool in this environment; editing instructions in §4 are written for a human (or ffmpeg) to execute manually. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. That is what §4 below is. **No MP4 exists.**

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/            → 91 merged pack directories (2026-08-14 → 2026-08-23) + 2 backlog-status docs
    list_pull_requests(owner, repo, state=open)    → 3 open PRs total, 1 of them a reel pack: #1816 "sweet smell from vents, leaking heater core"

Only one reel-pack PR is currently open and unreviewed (#1816). That is a
small, healthy backlog — well under the 12–37-open range that made prior
runs (2026-08-18 through 2026-08-21) stop and file a status-only PR instead.
No batch-review pause is warranted this run.

Merged topics on disk (91, spanning 2026-08-14 → 2026-08-23) plus the one
open-PR topic were scanned for overlap with "washer fluid won't spray":

- `wiper-blade-check` (08-17) — the wiper **blade** (rubber edge wear,
  streaking), not the washer **fluid delivery system** (nozzles, hose, pump).
  Adjacent component, distinct mechanism and distinct fix. No overlap.
- `heater-core-sweet-smell` (open PR #1816) — a coolant leak into the cabin,
  unrelated fluid system entirely. No overlap.
- `road-salt-brake-lines` (08-17) — corrosion on brake lines from road salt,
  not the washer system. No overlap.
- `radiator-cap-pressure-test` (08-21) — cooling system, not washer fluid.
  No overlap.

"Washer fluid won't spray" has never appeared in this pack series. Selected
without reservation.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Washer fluid won't spray — three checks in order (nozzle, hose, pump) | Strong — relatable, low-stakes-feeling but genuinely useful "I've had this happen" hook; clean ordered-checklist structure that reads well muted with captions | Yes — no season dependency, works any month | No | ✅ **Selected** |
| Fuel gauge sending unit reads wrong (needle stuck) | Moderate | Yes | **Yes** — merged 2026-08-23 (`fuel-gauge-sending-unit`) | Rejected — duplicate |
| AC compressor clutch cycling on/off (blows cold, then warm) | Moderate-strong, but risks reading as a duplicate of three prior AC packs (`ac-not-blowing-cold`, `ac-recharge-myth-sealed-system`, `musty-ac-smell-evaporator-vs-filter`) to a casual viewer even though the mechanism differs | Yes | Thematically crowded | Parked |

"Washer fluid" was selected for confirmed non-overlap with all 91 merged
topics and the one open-PR topic, an ordered-checklist structure that fits
the format's beat-by-beat pacing naturally, and a hook nearly every driver
has personally hit (hood-mounted washer button does nothing).

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A clogged nozzle is the most common reason nothing sprays" | General automotive service knowledge (debris/wax buildup clogging washer jets is a commonly cited first-check item ahead of pump replacement) — not shop-specific | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read; no `DATABASE_URL` present in this session). A repo-wide grep for "washer" across `server/services/evidenceRecords.ts` returned no matches — no existing evidence row to cite even if the DB were reachable. |
| "A hose that cracked in a hard freeze can leak fluid before it reaches the nozzle" | Standard automotive knowledge (washer lines are a known freeze-crack failure point, especially with under-strength washer fluid left in the system over winter) | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "can leak" — hedged, approved soft-language pattern (`client/src/lib/facelessReelStudio.ts`), not stated as certain. |
| "Only after those two, the pump motor itself is the likely cause" | Diagnostic ordering convention (cheap/visible checks before replacing an electrical component) — general troubleshooting logic, not a specific fact claim | **N/A — procedural framing, not a factual assertion requiring a citation.** |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, sidestepping the channel gap noted below. |

**Gap, stated plainly (same one every prior pack in this series has noted,
not new):** `businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" |
"web"` only — there is no `"reel"` channel. This script doesn't lean on that
store, so the gap doesn't block this pack, but it would block any future
reel script that wants to quote a price or warranty line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (22s total, 5 beats)

Matches the studio's own hard format contract (`REEL_OUTPUT_RULES` in
`client/src/lib/facelessReelStudio.ts`: 15–22s, 4–6 beats).

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Washer fluid won't spray, but the reservoir isn't empty? It's usually not the pump." |
| 2 · SETUP | 0:04–0:09 | "Check the nozzles first. A clogged jet is the most common reason nothing comes out." |
| 3 · VALUE | 0:09–0:14 | "Next, the line itself. A hose that cracked in a hard freeze can leak fluid before it reaches the nozzle." |
| 4 · VALUE | 0:14–0:18 | "Only after those two check out is the pump motor the likely cause." |
| 5 · CTA | 0:18–0:22 | "Three checks, one order. Stop by and we'll find the right one fast." |

**Total runtime: 22 seconds** (within the 15–60s generic task target and
exactly at the studio's own 22s ceiling).

### Per-beat visual prompts (Higgsfield/Seedance-style, or stock-footage search terms for the `template_stock` free lane)

Standing negative prompt for every beat (faceless format):
`faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

| Beat | Visual prompt | Stock search terms (template_stock lane) |
|---|---|---|
| 1 · HOOK | Close-up under an open hood on a windshield-washer fluid reservoir, translucent plastic, fluid visible near full line, static camera | "car washer fluid reservoir closeup", "windshield washer tank under hood" |
| 2 · SETUP | Extreme close-up on a windshield washer nozzle/jet mounted on the hood or cowl panel, static camera, morning dew on the hood | "windshield washer nozzle closeup", "car hood washer jet macro" |
| 3 · VALUE | Close-up following a washer fluid hose routed through the engine bay toward the firewall, static camera, cool workshop lighting | "car washer fluid hose engine bay", "automotive washer line closeup" |
| 4 · VALUE | Close-up on the washer pump motor housing at the base of the reservoir, static camera, neutral lighting | "washer pump motor reservoir base", "automotive washer pump closeup" |
| 5 · CTA | Wide shot of a clean auto repair shop garage bay, open bay door, warm daylight streaming in | "auto repair shop garage bay interior open door" |

### Assembly instructions (ffmpeg / CapCut — manual, no render performed)

1. **Canvas:** 1080×1920 (9:16), 30fps, H.264, target 15–30 Mbps.
2. **Layer order (bottom to top):** background clip per beat → 20% black
   gradient overlay (top 15% and bottom 20% of frame) for caption legibility
   → burned-in caption text (see `captions.srt`) → optional small logo bug,
   bottom-right, 8% opacity, only on the CTA beat.
3. **Cuts:** hard cut between every beat (1→2→3→4→5) — no dissolves needed,
   this script has no visual callback pair to bridge with a cross-dissolve.
4. **Captions:** burn in from `captions.srt`, bold sans-serif (e.g.
   Montserrat ExtraBold or system equivalent), white fill + black stroke,
   centered lower-third, max 2 lines, all-caps per house style shown in the
   SRT file.
5. **Audio:** voiceover track ducked -3dB under any music bed; music bed
   itself is **unassigned** — see §6 for why. Leave a silent/ambient
   room-tone track if no music is available at render time so the file isn't
   dead silent.
6. **Render-integrity targets** (matching this repo's real `reelAssembly.ts`
   gate, §5 of the operator skill): container duration and video-stream
   duration both within 0.75s of the 22s beat plan + a 3s CTA/SAVE freeze
   hold (~25s final render); ≥80% of expected 30fps frame count; the clip
   must show real motion (not a static still) across at least 3 of 5 sampled
   frames.
7. **Export:** MP4, H.264, 30fps, 1080×1920, target file size under 50MB for
   fast mobile upload.

---

## 5 · Credit-risk and fallback routing

No generation call was made, so no ledger entry was reserved or spent this
run. For reference, if this pack is later run through the real pipeline:

- Per `generationLedger.ts` `COST_ESTIMATES_USD`: on the **`template_stock`**
  lane (prod's current pin per `docs/operations/REEL-PIPELINE.md`), each clip
  is **$0** (free local ffmpeg assembly from licensed/stock footage). If
  routed instead through `seedance_clip`, estimate **5 beats × $0.25 =
  $1.25** against `policy.limits.maxGenerationCostPerDayUsd` (documented at
  $10/day, not re-read live this run).
- `REEL_FALLBACK_TO_TEMPLATE_STOCK` governs degrade-not-dark behavior if a
  paid provider hits a terminal verdict — not exercised here since no
  generation call was made.
- Actual Higgsfield account balance: **UNKNOWN** — `getHiggsfieldAccountHealth()`
  was not called (no server process, no credentials in this session).

---

## 6 · Audio and music-rights status

**No music-rights ledger exists in this repo** (confirmed gap, not new to
this run — see the operator skill's "Audio and music rights" section). This
pack does not assign a specific music track. Recommendation for whoever
renders this: use a royalty-free bed cleared for commercial social use and
record the asset ID, license scope, and expiry manually — there is no
automated place in this repo to store that record yet.

Voiceover: not generated this run (no TTS tool connected to this session).
Route when rendered: `reelVoice.ts` (Google Neural2 or ElevenLabs per that
service's provider chain), fed `beats[].narration` from `brief.json`
concatenated in order.

---

## 7 · QA matrix

| Gate | Verdict | Basis |
|---|---|---|
| `calculateReelQualityScore()` (75-point brief gate, `facelessReelStudio.ts`) | **UNKNOWN** | Not invoked — no live app build in this session. Self-estimate below is NOT this function's output. |
| Server-side re-score at enqueue (`content.generateReelBrief` / `enqueueReelJob`) | **BLOCKED** | No live server; enqueue was never attempted. |
| Render-integrity gate (`reelAssembly.ts` duration/frame-count/motion checks) | **BLOCKED** | No render was performed — there is no file to check. |
| `renderedQa.ts` vision critic | **BLOCKED** | No rendered frames exist to critique. |
| `evaluateReelPublishGate()` (`qualityGate.ts`, the consolidated publish gate) | **BLOCKED — evidence gate, not a quality verdict** | Correct state per the operator skill: "absence of evidence is never evidence of quality." This pack has not entered the pipeline, so the gate has nothing to evaluate; it is not a silent pass. |
| Claim-safety wording (no prices, no guarantees, no fearmongering) | **PASS (self-check against the approved pattern bank)** | Script uses hedged "can," no price/warranty claims, no absolute guarantees, no invented failure timeline. |
| Faceless compliance | **PASS (self-check)** | Every visual prompt in §4 excludes faces, hands, and human figures; standing negative prompt applied uniformly. |
| Repetition check | **PASS (directional — see §1 caveat)** | Confirmed absent from all 91 merged pack directories and the one currently open PR topic. Not cross-checked against the live `reel_jobs` table (no DB access this run). |

**Self-estimated quality score (not the real gate — see `brief.json` for the
full breakdown): 50/75**, same structural profile as prior packs in this
series (strong on faceless/claim-safety/beat-structure/muted-first/length,
weak on `sourcedFact` and `loop` because no `EvidenceRecord` was cited and
no loop seam was designed between beat 5 and beat 1).

---

## 8 · IG/FB copy + ad-ready variants

**Primary caption (organic post):**

> Hit the washer button and... nothing? 💦 It's usually NOT the pump. Check
> the nozzle first, then the hose — freeze cracks are common. Pump is the
> last thing to blame. #NicksTireAuto #Euclid #CarCare #AutoRepair
> #Cleveland #WasherFluid

**Ad variant A (problem-first hook):**
- Hook: "Washer fluid button does nothing? Don't buy a new pump yet."
- Caption: "Check the nozzle for clogs and the hose for a freeze crack
  first — most of the time, that's the actual fix."
- CTA: "Not sure which one it is? Stop by — link in bio."

**Ad variant B (checklist hook):**
- Hook: "Three things to check before you replace a washer pump."
- Caption: "Nozzle, then hose, then pump — in that order. Skipping the
  order means paying for a part you didn't need."
- CTA: "Send us a message before you guess — link in bio."

**Posting specs:** Instagram Reels + Facebook, 1080×1920 (9:16), MP4 H.264
30fps, 22s runtime (+3s CTA/SAVE freeze, ~25s final render), account
`@nicks_tire_euclid`, SEND-oriented CTA (per the existing pattern in this
pack series, not a `PURCHASE`-style CTA).

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

This is a complete production-ready pack: word-for-word timed script,
per-beat visual prompts with standing negative prompt, `captions.srt`,
ffmpeg/CapCut assembly instructions matching the real render-integrity
contract, IG/FB copy, and two ad-ready variants. No file was rendered, no
generation/DB/publish call was made, and no live quality-gate evaluation
occurred — every QA-matrix row above is either an honest self-check or an
explicit `UNKNOWN`/`BLOCKED`, never a claimed pass on a gate that wasn't run.
A human (or a live pipeline run with real credentials) still needs to: pick
final stock footage or generate clips, record voiceover, select a
rights-cleared music bed (§6), render, run it through the real quality gate,
and approve before this posts anywhere.

**Backlog note:** only one reel-pack PR is open and unreviewed right now
(#1816, §1) — a healthy state. **Standing recommendation for the operator,
carried forward from every prior pack in this series:** this scheduled task
has now produced 92 packs across 10 days (2026-08-14 → 2026-08-23), at a
pace of up to 8/day, and every single one requires a live human to actually
review, render, and approve before it is worth anything — none of the prior
91 show evidence of having been rendered or posted. If nothing downstream is
consuming this backlog, consider slowing the schedule's firing interval
(a change made at the trigger level, outside what any single firing of this
task can do from inside the run) rather than continuing to accumulate
unreviewed packs at the current rate.
