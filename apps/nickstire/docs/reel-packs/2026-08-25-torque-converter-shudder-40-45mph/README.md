# Reel production pack — "That shudder at 40-45? Not your tires" (2026-08-25)

Scheduled-task run · 2026-08-25 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **TCSHUDDER**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present —
the operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
See §1 and §9.

The scheduled prompt itself asked generically to "generate a complete
production-ready faceless short-form video workflow" and to check tool
availability (ChatGPT, TTS, Higgsfield, Meta posting, render, CapCut) before
choosing between a rendered file and a production pack.

---

## 1 · Tool-availability checklist, mode, and backlog check

| Tool asked about | Available to this session? | Basis |
|---|---|---|
| ChatGPT / an LLM to write the script | Yes — this session itself | Used directly; no external LLM call needed |
| TTS (voiceover generation) | **No** | No TTS MCP tool or `reelVoice.ts` live call is reachable from this Claude Code repo session |
| Higgsfield (AI video generation) | **No** | `getHiggsfieldAccountHealth()` requires the live server process + `HIGGSFIELD_API_KEY`; not reachable here |
| Meta posting (Instagram/Facebook) | **No** (and would not be used even if reachable) | Protected customer-facing action per root `AGENTS.md`; requires explicit live operator instruction every time, which a scheduled firing never carries |
| `ADMIN_API_KEY` / `DATABASE_URL` / `REEL_*` / `HIGGSFIELD_*` env vars | **Not present** | `env \| grep -iE "REEL_\|ADMIN_API_KEY\|DATABASE_URL\|HIGGSFIELD"` returned nothing in this session's shell |
| `ffmpeg` | **Not present** | `which ffmpeg` returned nothing — no local render path even for the free `template_stock` lane |
| CapCut or similar editing software | **No** | Desktop/mobile app, not available in this environment |

**Conclusion: zero live motion route this run.** Per the operator skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack, not a claimed render. **No MP4
exists.** §4 below is that pack.

**Repetition-ledger context — file + PR check (not the live `reel_jobs`
table, which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/                                              → 101 merged pack directories (2026-08-14 -> 2026-08-25) + 2 backlog-status docs
    search_pull_requests "repo:.../mainnicks-tire-autonew is:pr is:open reel pack in:title" → 5 open pack-content PRs + 2 backlog-status PRs
    list_pull_requests(state=open)                                                  → 8 open PRs total (matches the search count + 1 unrelated dependabot PR)

**A prior run this same UTC day (PR #1874, 21:30) reported 132 open PRs and
recommended a batch review + pausing this task's firing interval.** This
run's own live read, minutes later, found only **8 open PRs** — meaning
that backlog has since been cleared (merged or closed) by the operator. That
is a big, positive state change, not a contradiction to paper over: this
run trusts its own fresh live read (root `AGENTS.md`'s source-of-truth
hierarchy ranks live production/API evidence above a prior report), and
proceeds with a normal pack rather than another status-only note. The five
still-open pack-content PRs are small and recent (filed 15:32-20:34 UTC
today): #1835 exhaust manifold leak/cold-start tick, #1857 AC compressor
clutch/low-pressure cutoff, #1865 rear defroster grid-line break test,
#1867 brake light switch/cruise/shift-lock, #1873 4WD/AWD driveline bind.
None overlaps the topic below.

Merged topics (101, spanning 2026-08-14 -> 2026-08-25) plus the five
in-flight open-PR topics above were scanned for overlap:

    ls apps/nickstire/docs/reel-packs/ | grep -iE 'torque|converter|shudder|lockup|transmission'
      -> lug-nut-retorque (unrelated: wheel lug torque spec, not a transmission)
      -> catalytic-converter-theft-prevention (unrelated: exhaust catalytic converter, not a torque converter)
      -> misfire-shudder-coil-vs-plug (2026-08-25, same day — read in full, see below)
      -> transmission-fluid-color-test (dipstick fluid-color check, not a symptom/diagnostic topic)

**"Misfire shudder: coil vs plug" (merged today) was read in full to confirm
non-overlap**, since it is the one existing pack that shares the word
"shudder." That pack's shudder is an **ignition-system** symptom — tied to
acceleration/engine load generally, diagnosed by swapping a coil vs a spark
plug. This pack's shudder is a **transmission-system** symptom — tied to one
narrow **cruise-speed window (40-45mph)** specifically, not acceleration,
and caused by the torque converter's lockup clutch slipping rather than
locking cleanly. Distinct mechanism (transmission hydraulics vs ignition
spark), distinct trigger (a speed window vs acceleration/load), and distinct
fix path (fluid/clutch service vs coil/plug replacement). Not a duplicate.

`transmission-fluid-color-test` (2026-08-20) is a maintenance-check topic
(inspect the dipstick, judge fluid color/smell) with no symptom or failure
claim — this pack is a symptom-diagnosis topic (a specific shudder a driver
can feel). Adjacent system, distinct content shape, not a duplicate.

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Torque converter lockup shudder at 40-45mph | Strong — precise, counterintuitive hook (a narrow speed window most drivers have never connected to a specific mechanism), clean escalating-stakes structure (misdiagnosed as tires/misfire -> heat -> fluid wear) | Yes | No (transmission category is the most underrepresented system in the 101 merged packs — 3 prior topics) | ✅ **Selected** |
| Wheel alignment camber wear on one tire edge | Moderate — reads close to the merged `uneven-tire-wear-patterns` (08-18) and `balance-vs-alignment` (08-17) packs to a casual viewer | Yes | Thematically crowded (tire category already has 15 merged topics) | Parked |
| Manual-transmission grinding into gear (worn synchro) | Moderate — real, distinct mechanism, but a smaller addressable audience (manual transmissions are a minority of the shop's likely customer base) than an automatic-only symptom | Yes | Not covered | Parked |

"Torque converter shudder" was selected for the strongest hook of the three
(a precise, checkable symptom window most drivers have never had explained),
confirmed non-overlap with all 101 merged topics and all 5 open-PR topics,
and because transmission/clutch is the thinnest-covered system category in
the pack history to date (3 of 101 merged topics), making this pack a
genuine content gap rather than a variation on an already-dense category.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Around 40-45mph, the transmission locks a clutch inside the torque converter to save fuel" | General automotive-transmission knowledge (torque converter lockup clutch engagement in a cruise-speed range, most commonly cited as roughly 35-45mph depending on vehicle/gearing, is standard automatic-transmission design used to eliminate converter slip and improve fuel economy) — not shop-specific, and deliberately not stated as a single universal number ("around 40 to 45," not "exactly") | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). A repo-wide grep for "torque converter" and "lockup" across `server/services/evidenceRecords.ts` returned no matches — no existing evidence row to cite even if the DB were reachable. |
| "When that clutch slips instead of locking cleanly, you feel a shudder" | Standard automotive-transmission diagnostic knowledge (a slipping torque converter lockup clutch is a commonly documented cause of a light vibration/shudder felt specifically in the lockup engagement speed range) | **UNKNOWN against this repo's evidence store**, same reasoning as above. |
| "Left alone, that slipping clutch generates heat and wears down the fluid faster than normal" | Inference presented as a possibility, deliberately hedged, no invented timeline or mileage figure, no specific part or price named | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing avoids "will," uses "wears down... faster than normal" without a number. |
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
`client/src/lib/facelessReelStudio.ts`: 15-22s, 4-6 beats) exactly, rather
than only the looser 15-60s range in the generic task brief.

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00-0:04 | "Feel a light shudder right around 40 to 45 miles an hour that goes away if you speed up or slow down? That's not your tires." |
| 2 · SETUP | 0:04-0:09 | "At that speed, your transmission locks a clutch inside the torque converter to save fuel. When that clutch slips, you feel a shudder instead of a smooth lockup." |
| 3 · VALUE | 0:09-0:14 | "Drivers often blame a misfire or bad tires, because it only shows up in that one narrow speed window." |
| 4 · VALUE | 0:14-0:18 | "Left alone, that slipping clutch builds heat and wears down your transmission fluid faster than normal." |
| 5 · CTA | 0:18-0:22 | "One shudder doesn't confirm a diagnosis. Stop by and we'll check your transmission properly." |

**Total runtime: 22 seconds** (within the 15-60s generic target and exactly
at the studio's own 22s ceiling).

### Per-beat visual prompts (Higgsfield/Seedance-style, or stock-footage search terms for the `template_stock` free lane)

Standing negative prompt for every beat (faceless format):
`faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

| Beat | Visual prompt | Stock search terms (template_stock lane) |
|---|---|---|
| 1 · HOOK | Close-up of a car speedometer needle holding steady around 40-45mph on a dashboard gauge cluster, static camera, daylight interior | "car speedometer closeup 40mph", "dashboard gauge cluster speed needle" |
| 2 · SETUP | Wide shot of a sedan cruising smoothly on a suburban road at moderate steady speed, gentle motion blur on the wheels, no visible driver | "car cruising suburban road wide shot", "sedan driving steady speed road" |
| 3 · VALUE | Close-up of the underside of a vehicle on a lift in a repair bay, transmission housing visible, static camera, workshop lighting | "car on lift underside transmission closeup", "vehicle hoist garage undercarriage" |
| 4 · VALUE | Close-up of amber transmission fluid pooled in a metal drain pan, static camera, workshop lighting | "transmission fluid drain pan closeup", "amber fluid metal pan garage" |
| 5 · CTA | Wide shot of a clean auto repair shop garage bay, open bay door, warm daylight streaming in | "auto repair shop garage bay interior open door" |

### Assembly instructions (ffmpeg / CapCut — manual, no render performed)

1. **Canvas:** 1080x1920 (9:16), 30fps, H.264, target 15-30 Mbps.
2. **Layer order (bottom to top):** background clip per beat -> 20% black
   gradient overlay (top 15% and bottom 20% of frame) for caption legibility
   -> burned-in caption text (see `captions.srt`) -> optional small logo bug,
   bottom-right, 8% opacity, only on the CTA beat.
3. **Cuts:** hard cut between beats 1-2 and 2-3, a 0.3s cross-dissolve on
   3-4 (both are garage/fluid shots), hard cut 4-5.
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
7. **Export:** MP4, H.264, 30fps, 1080x1920, target file size under 50MB for
   fast mobile upload.

---

## 5 · Credit-risk and fallback routing

No generation call was made, so no ledger entry was reserved or spent this
run. For reference, if this pack is later run through the real pipeline:

- Per `generationLedger.ts` `COST_ESTIMATES_USD`: on the **`template_stock`**
  lane (prod's current pin per `docs/operations/REEL-PIPELINE.md`), each clip
  is **$0** (free local ffmpeg assembly from licensed/stock footage). If
  routed instead through `seedance_clip`, estimate **5 beats x $0.25 =
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
| Claim-safety wording (no prices, no guarantees, no fearmongering) | **PASS (self-check against the approved pattern bank)** | Script uses hedged phrasing throughout ("often," "can," no absolute numbers or timelines), no price/warranty claims, no fabricated failure timeline or specific part cost. |
| Faceless compliance | **PASS (self-check)** | Every visual prompt in §4 excludes faces, hands, and human figures; standing negative prompt applied uniformly. |
| Repetition check | **PASS (directional — see §1 caveat)** | Confirmed absent from 101 merged pack directories and all 5 currently open PR topics; the one adjacent "shudder" title was read in full and confirmed distinct (§1). Not cross-checked against the live `reel_jobs` table (no DB access this run). |

**Self-estimated quality score (not the real gate — see `brief.json` for the
full breakdown): 50/75**, same structural profile as prior packs in this
series (strong on faceless/claim-safety/beat-structure/muted-first/length,
weak on `sourcedFact` and `loop` because no `EvidenceRecord` was cited and
no loop seam was designed between beat 5 and beat 1).

---

## 8 · IG/FB copy + ad-ready variants

**Primary caption (organic post):**

> Feel a light shudder right around 40-45mph that goes away if you speed up
> or slow down? That's not your tires. 🔧 Your transmission locks a clutch
> inside the torque converter at that speed to save fuel — when it slips
> instead of locking clean, you feel a shudder. Left alone, that builds heat
> and wears your fluid down faster. We check it properly.
> #NicksTireAuto #Euclid #CarCare #AutoRepair #Cleveland #Transmission

**Ad variant A (problem-first hook):**
- Hook: "That shudder around 40-45mph isn't your tires or a misfire."
- Caption: "Your transmission locks a clutch at that speed to save fuel. When
  it slips instead of locking clean, you feel it — and it wears your fluid
  down faster the longer it goes on."
- CTA: "Book a transmission check — link in bio."

**Ad variant B (stakes-first hook):**
- Hook: "A slipping torque converter clutch doesn't always throw a warning
  light."
- Caption: "If you feel a shudder in one narrow speed window, that's your
  warning. We check it now so it doesn't build heat and wear your fluid down
  early."
- CTA: "Send us a message before it gets worse — link in bio."

**Posting specs:** Instagram Reels + Facebook, 1080x1920 (9:16), MP4 H.264
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

**Backlog note:** this run found 8 open PRs total (5 pack-content, 2
backlog-status, 1 unrelated dependabot) — a large improvement from the 132
a prior same-day run reported at 21:30. That prior report's recommendation
to batch-review the backlog appears to have been acted on; no further
status-only report is needed this run.
