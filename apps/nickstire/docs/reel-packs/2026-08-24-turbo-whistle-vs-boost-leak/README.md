# Reel production pack — "That whistle isn't always a healthy turbo" (2026-08-24)

Scheduled-task run · 2026-08-24 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **BOOSTLEAK**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session; fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` / `REEL_*` / `OPENAI` / `ANTHROPIC_API` / `META_*` / `INSTAGRAM` / `ELEVENLABS` / `TTS` env vars | **Not present** | `env \| grep -Ei "ADMIN_API_KEY\|HIGGSFIELD\|REEL_GENERATION_ENABLED\|REEL_VIDEO_PROVIDER\|REEL_AUTOPOST_ENABLED\|DATABASE_URL"` returned nothing in this session's shell. |
| `ffmpeg` | **Not present** | `which ffmpeg` returned nothing. No local render path even for the free `template_stock` lane. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (the free local-ffmpeg lane, not Higgsfield/Seedance) as of its last-verified date. Not re-confirmed live this run. |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | Not read live | Not set in this session's shell; no server process to query either. |
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

    ls apps/nickstire/docs/reel-packs/                                             → 85 merged pack directories (2026-08-14 -> 2026-08-23) + 2 backlog-status docs
    search_pull_requests "repo:.../mainnicks-tire-autonew is:pr reel pack in:title" → 118 total across history (open + closed)
    list_pull_requests(state=open)                                                 → 5 open PRs total, 4 of them reel packs (all filed 2026-08-23/24)

**Four open, unreviewed reel-pack PRs exist right now** (#1816 sweet
smell/heater core, #1817 washer fluid nozzle/hose/pump, #1818 trunk/hatch
gas strut, #1819 horn fuse/relay/clockspring). That is a real but small
backlog, far below the 12–37-open thresholds that made prior runs stop and
file a status-only PR instead. None of the four open titles overlaps the
turbo/boost topic below, so this run proceeded with a full pack rather than
a backlog-status note.

Merged topics already on disk (85, spanning 2026-08-14 → 2026-08-23) plus
the four in-flight open-PR topics above were scanned for overlap:

    ls apps/nickstire/docs/reel-packs/ | grep -iE 'turbo|boost' → no match

No existing merged pack or open PR mentions a turbocharger or a boost leak.
The nearest thematically-adjacent merged topics were checked individually:

- `power-steering-whine` (08-18) — a whine tied to steering-wheel angle, not
  engine load/acceleration. Distinct trigger and distinct fix.
- `serpentine-belt-squeal` (08-17) — a belt noise at idle/startup, not an
  acceleration-load turbo sound. No overlap.
- `hard-brake-pedal-vacuum-booster` (08-22) — "booster" here is a brake
  vacuum booster, unrelated to turbocharger boost pressure despite the
  shared word. No overlap.
- `engine-overheating-first-60-seconds` (08-19) — general coolant-system
  overheating, not a turbo-specific heat/wear claim. Distinct mechanism.

**"A turbo whistle vs a boost-leak hiss, and what that predicts" is not
among any of the above** — it is a distinct symptom (a specific
acceleration-tied sound most drivers have never been taught to distinguish),
a distinct mechanism (a leak in the charge-air piping, not wear inside a
fuel or belt component), and a distinct stakes framing (reduced power and
turbo overheating, not a stall or a belt failure).

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Turbo whistle vs boost leak hiss | Strong — audio-forward hook fits a faceless format especially well (a sound distinction a viewer can imagine hearing in their own car), counterintuitive angle (most drivers assume any turbo sound is normal), clean 3-step logic (normal whine → leak hiss → power loss + heat) | Yes | No | ✅ **Selected** |
| Steering wheel off-center after a wheel change (not a full alignment fault) | Moderate — decent hook but reads close to the merged `balance-vs-alignment` (08-17) and `tie-rod-steering-wobble-test` (08-20) packs to a casual viewer | Yes | Thematically crowded | Parked |
| AC compressor clutch not engaging (no cold air, no clicking) | Moderate — good hook but risks overlapping the merged `musty-ac-smell` and `ac-recharge-myth` (08-20/08-21) packs on a casual read even though the mechanism differs | Yes | Thematically adjacent to two merged packs | Parked |

"Turbo whistle vs boost leak" was selected for the strongest audio-native
hook of the three (this format is muted-first per the studio's own scoring
rubric, but a described sound distinction still lands in captions), a clean
escalating-stakes structure, and confirmed non-overlap with all 85 merged
topics and all 4 open-PR topics.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A turbo spooling up makes a smooth rising whine; a hiss or spit sound means air is escaping" | General automotive forced-induction diagnostic guidance (a healthy turbo produces a smooth pitch-rising whine under boost; a hissing/spitting sound is a commonly cited symptom of a charge-air leak downstream of the turbo) — not shop-specific | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. A repo-wide grep for "turbo" and "boost leak" across `server/services/evidenceRecords.ts` returned no matches — there is no existing evidence row to cite even if the DB were reachable. |
| "A boost leak means the engine loses power and can trigger a check engine light" | Same — standard automotive knowledge (a boost leak reduces intake pressure the ECU expects, commonly triggering a boost-pressure or lean-condition fault code) | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "can trigger," not stated as certain or universal. |
| "Ignored, the turbo can run hotter than it should, wearing down parts" | Inference presented as a possibility, deliberately hedged with "can," not stated as certain or as a guaranteed timeline | **UNKNOWN against this repo's evidence store**, same reasoning. No invented timeline (no "X miles" or "X weeks" claim), no specific part or price named. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, which sidesteps the channel gap noted below. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack, but it would block any future reel script that
wants to quote a price or warranty line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (22s total, 5 beats)

Matches the studio's own hard format contract (`REEL_OUTPUT_RULES` in
`client/src/lib/facelessReelStudio.ts`: 15–22s, 4–6 beats) exactly, rather
than only the looser 15–60s range in the generic task brief.

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "That high-pitched whistle when you accelerate? Not every turbo sound means the turbo is fine." |
| 2 · SETUP | 0:04–0:09 | "A turbo spooling up makes a smooth rising whine. A hissing or spitting sound is different — that's air escaping where it shouldn't." |
| 3 · VALUE | 0:09–0:14 | "A boost leak means the engine loses power, and it can trigger a check engine light even with no other symptoms." |
| 4 · VALUE | 0:14–0:18 | "Ignore it, and the turbo can run hotter than it should, wearing down parts that aren't cheap to replace." |
| 5 · CTA | 0:18–0:22 | "One sound doesn't confirm a diagnosis. Stop by and we'll listen and check it properly." |

**Total runtime: 22 seconds** (within the 15–60s generic target and exactly
at the studio's own 22s ceiling).

### Per-beat visual prompts (Higgsfield/Seedance-style, or stock-footage search terms for the `template_stock` free lane)

Standing negative prompt for every beat (faceless format):
`faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

| Beat | Visual prompt | Stock search terms (template_stock lane) |
|---|---|---|
| 1 · HOOK | Close-up of a car turbocharger in the engine bay, faint heat haze rising, static camera, dusk ambient lighting | "turbocharger engine bay closeup", "car turbo under hood" |
| 2 · SETUP | Wide rear three-quarter shot of a car accelerating away on a quiet road, motion blur on the wheels, no visible driver | "car accelerating rear view road", "vehicle accelerating highway rear shot" |
| 3 · VALUE | Close-up of a dashboard check engine light illuminating against a dim instrument cluster, static camera | "check engine light dashboard closeup", "car dashboard warning light glowing" |
| 4 · VALUE | Close-up of an engine bay near the turbo and exhaust manifold, subtle heat shimmer, static camera, cool ambient light | "engine bay heat shimmer closeup", "hot engine compartment turbo heat" |
| 5 · CTA | Wide shot of a clean auto repair shop garage bay, open bay door, warm daylight streaming in | "auto repair shop garage bay interior open door" |

### Assembly instructions (ffmpeg / CapCut — manual, no render performed)

1. **Canvas:** 1080×1920 (9:16), 30fps, H.264, target 15–30 Mbps.
2. **Layer order (bottom to top):** background clip per beat → 20% black
   gradient overlay (top 15% and bottom 20% of frame) for caption legibility
   → burned-in caption text (see `captions.srt`) → optional small logo bug,
   bottom-right, 8% opacity, only on the CTA beat.
3. **Cuts:** hard cut between beats 1→2, a 0.3s cross-dissolve on 3→4 (both
   are engine-bay heat/mechanical shots), hard cut 2→3 and 4→5.
4. **Captions:** burn in from `captions.srt`, bold sans-serif (e.g. Montserrat
   ExtraBold or system equivalent), white fill + black stroke, centered
   lower-third, max 2 lines, all-caps per house style shown in the SRT file.
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
renders this: use a royalty-free bed cleared for commercial social use
(e.g. a licensed track from the shop's existing music subscription, if one
exists) and record the asset ID, license scope, and expiry manually — there
is no automated place in this repo to store that record yet.

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
| Claim-safety wording (no prices, no guarantees, no fearmongering) | **PASS (self-check against the approved pattern bank)** | Script uses hedged "can" language throughout, no price/warranty claims, no absolute guarantees, no invented failure timeline or specific part cost. |
| Faceless compliance | **PASS (self-check)** | Every visual prompt in §4 excludes faces, hands, and human figures; standing negative prompt applied uniformly. |
| Repetition check | **PASS (directional — see §1 caveat)** | Confirmed absent from 85 merged pack directories and all 4 currently open PR topics. Not cross-checked against the live `reel_jobs` table (no DB access this run). |

**Self-estimated quality score (not the real gate — see `brief.json` for the
full breakdown): 50/75**, same structural profile as prior packs in this
series (strong on faceless/claim-safety/beat-structure/muted-first/length,
weak on `sourcedFact` and `loop` because no `EvidenceRecord` was cited and
no loop seam was designed between beat 5 and beat 1).

---

## 8 · IG/FB copy + ad-ready variants

**Primary caption (organic post):**

> That whistle when you accelerate isn't always a healthy turbo. 🔊 A smooth
> rising whine is normal — a hiss or spit means air's escaping somewhere it
> shouldn't. That can mean lost power, a check engine light, and a turbo
> running hotter than it should. We listen and check it properly.
> #NicksTireAuto #Euclid #CarCare #AutoRepair #Cleveland #Turbo

**Ad variant A (problem-first hook):**
- Hook: "That whistle when you hit the gas isn't always your turbo working right."
- Caption: "A smooth rising whine is normal. A hiss or spit means a boost
  leak — lost power now, a hotter-running turbo later."
- CTA: "Book a boost-system check — link in bio."

**Ad variant B (stakes-first hook):**
- Hook: "A boost leak doesn't always throw a warning light right away."
- Caption: "If that whistle sounds off, that's your warning. We check it
  now so it doesn't wear down parts that aren't cheap to replace."
- CTA: "Send us a message before it gets worse — link in bio."

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

**Backlog note:** four reel-pack PRs are open and unreviewed right now
(§1) — a real but small backlog, well short of the 12–37-open range that
made prior runs stop entirely. Recommend a batch review soon rather than
letting it grow toward that range again.
