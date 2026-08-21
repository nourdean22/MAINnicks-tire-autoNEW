# Reel production pack — "Dead battery again? It might not be the battery" (2026-08-21)

Scheduled-task run · 2026-08-21 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **PARASITIC**

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
| `HIGGSFIELD_*` / `ADMIN_API_KEY` credentials | **Not present** | `env \| grep -iE "HIGGSFIELD\|ADMIN_API_KEY\|DATABASE_URL\|REEL_\|OPENAI\|ANTHROPIC_API\|META_\|INSTAGRAM\|ELEVENLABS\|TTS"` returned nothing in this session's shell. |
| `DATABASE_URL` (prod TiDB) | **Not present** | Same check — not set in this session's shell. |
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

    ls apps/nickstire/docs/reel-packs/                                          → 68 merged pack directories (2026-08-14 → 2026-08-21)
    search_pull_requests "repo:.../mainnicks-tire-autonew is:pr is:open reel pack in:title"  → 88 total (all history)
    list_pull_requests(state=open)                                              → 0 open PRs right now

**This run found the open-PR backlog at zero**, a sharp change from the prior
three consecutive runs (2026-08-18 through 2026-08-21 07:29Z), which each
found 12–37 open, unreviewed draft PRs and each recommended a batch review or
a slower firing interval. Something cleared the backlog between the last
status-only run (07:29Z) and now — this run did not investigate what (out of
scope for a content-pack run), but with zero open drafts to collide with,
producing a full pack this run carries none of the duplication risk the
prior three runs were guarding against.

Merged topics already on disk (68, spanning 2026-08-14 → 2026-08-21):
penny test, tire expiration, tread-wear fingerprint, battery heat in summer,
check-engine light, squealing-vs-grinding brakes, wheel-bearing hum,
balance-vs-alignment, cabin air filter, coolant color, exhaust-smoke color,
oil-change intervals, plug-vs-patch, pothole damage, repair-authorization
questions, road-salt brake-line corrosion, road-trip tire pre-check,
serpentine-belt squeal, sidewall bulge, spare-tire mileage, "noises that
mean stop driving now", strut bounce-test, summer-heat tire pressure, tire
rotation, transmission-fluid color test, tread-depth rain-vs-snow,
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
warped-rotor brake shake, windshield chip that spreads, AC recharge myth
(sealed system), brake pedal sinks overnight, catalytic converter theft
prevention, differential whine on turns, gas cap check-engine light, valve
stem dry rot, AWD one-new-tire mismatch, sticking brake caliper, lug-nut
re-torque, musty AC smell, radiator fan idle overheat, slow-leak soap test,
tie-rod steering-wobble test, tire sidewall numbers.

**"Battery dying overnight from a parasitic (phantom) drain" is not among
any of the above.** The two existing battery-adjacent topics are visual/
mechanical: `battery terminal corrosion` (what corrosion looks like) and
`won't-start (battery/starter/alternator)` (diagnosing a no-start at the
moment it happens). Neither covers a battery that starts the car fine every
time but is mysteriously dead by morning — a distinct symptom, a distinct
cause (something staying awake and drawing current with the key out), and a
distinct hook ("your battery isn't dying, something's killing it while you
sleep").

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Parasitic (phantom) battery drain overnight | Strong — counterintuitive ("the battery isn't the problem"), relatable morning frustration, clear diagnostic angle distinct from both existing battery topics | Yes | No | ✅ **Selected** |
| Alternator whine vs. power-steering whine (pitch changes with engine RPM vs. wheel angle) | Moderate — good audio-forward hook but close to the merged `power-steering-whine` pack's territory | Yes | Thematically adjacent to an existing merged pack | Parked |
| Key fob / remote-start battery low symptoms | Weak — low stakes, doesn't fit the "worth checking before it strands you" shop-value frame as well | Yes | No | Parked |

"Parasitic battery drain" was selected for a strong counterintuitive hook, a
clean symptom (repeated overnight death vs. corrosion or a one-time no-start),
and confirmed non-overlap with all 68 existing topics.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A battery that starts fine every day but is dead by morning is usually a drain, not a bad battery" | General automotive electrical-diagnostic guidance (a battery that holds charge under normal daily cycling but empties overnight points to a load pulling current with the key out, not cell degradation) — not shop-specific | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. |
| "A trunk or glovebox light, a bad relay, or a module that won't power down can all draw current with the car off" | Same — standard automotive electrical-diagnostic knowledge | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing: "can point to" / listed as possibilities, not asserted as the definite cause — approved soft-language pattern (`client/src/lib/facelessReelStudio.ts`). |
| "Replacing the battery without finding the drain usually just repeats the same dead morning" | Inference presented as a likelihood, deliberately hedged with "usually," not stated as certain | **UNKNOWN against this repo's evidence store**, same reasoning. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, which sidesteps the channel gap noted below. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack, but it would block any future reel script that
wants to quote a price or warranty line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (28s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:04 | "Your battery starts the car fine every day, but it's dead again this morning." |
| 2 · SETUP | 0:04–0:09 | "That's not always a bad battery. Something could be draining it while the car sits off." |
| 3 · VALUE | 0:09–0:17 | "A trunk light, a bad relay, or a module that won't power down can all pull current overnight." |
| 4 · VALUE | 0:17–0:23 | "Buying a new battery without finding the drain usually just repeats the same dead morning." |
| 5 · CTA | 0:23–0:28 | "Nick's Tire and Auto can test for a parasitic drain before you buy another battery. Link in bio." |

**Total runtime: 28 seconds** (within the 15–60s target range).

### Per-beat visual prompts (Higgsfield/Seedance-style, or stock-footage search terms for the `template_stock` free lane)

Standing negative prompt for every beat (faceless format):
`faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

| Beat | Visual prompt | Stock search terms (template_stock lane) |
|---|---|---|
| 1 · HOOK | Close-up of a car dashboard at night, ignition key inserted but dash gauges dark and dead, faint dome-light glow, static camera | "dead car dashboard night", "car won't start dark garage" |
| 2 · SETUP | Macro shot of a car battery under the hood, terminals clean and intact (no corrosion — this is not a bad-battery visual), slow push-in, cool workshop lighting | "car battery under hood closeup", "automotive battery terminals clean" |
| 3 · VALUE | Static close-up of a fuse/relay box with cover open, dim ambient light, one relay slightly highlighted by a shallow rack-focus pull | "car fuse box relay closeup", "automotive relay panel macro" |
| 4 · VALUE | Wide-to-close shot: a new battery box sitting on a shop counter, camera slowly pulls back to reveal the same dark dashboard from beat 1 in soft background blur — visual callback tying "new battery" to "same problem" | "new car battery box shop counter", "auto parts store battery display" |
| 5 · CTA | Wide shot of a clean auto repair shop garage bay, open bay door, warm daylight streaming in | "auto repair shop garage bay interior open door" |

### Assembly instructions (ffmpeg / CapCut — manual, no render performed)

1. **Canvas:** 1080×1920 (9:16), 30fps, H.264, target 15–30 Mbps.
2. **Layer order (bottom to top):** background clip per beat → 20% black
   gradient overlay (top 15% and bottom 20% of frame) for caption legibility
   → burned-in caption text (see `captions.srt`) → optional small logo bug,
   bottom-right, 8% opacity, only on the CTA beat.
3. **Cuts:** hard cut between beats 1→2→3, a 0.3s cross-dissolve on 3→4 (the
   visual callback), hard cut 4→5.
4. **Captions:** burn in from `captions.srt`, bold sans-serif (e.g. Montserrat
   ExtraBold or system equivalent), white fill + black stroke, centered
   lower-third, max 2 lines, all-caps per house style shown in the SRT file.
5. **Audio:** voiceover track ducked -3dB under any music bed; music bed
   itself is **unassigned** — see §6 for why. Leave a silent/ambient
   room-tone track if no music is available at render time so the file isn't
   dead silent.
6. **Render-integrity targets** (matching this repo's real `reelAssembly.ts`
   gate, §5 of the operator skill): container duration and video-stream
   duration both within 0.75s of the 28s beat plan + a 3s CTA hold; ≥80% of
   expected 30fps frame count; the clip must show real motion (not a static
   still) across at least 3 of 5 sampled frames.
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
| Claim-safety wording (no prices, no guarantees, no fearmongering) | **PASS (self-check against the approved pattern bank)** | Script uses "can point to," "usually," no price/warranty claims, no absolute guarantees. Not re-verified by the live validator in `facelessReelStudio.ts` (not invoked this run). |
| Faceless compliance | **PASS (self-check)** | Every visual prompt in §4 excludes faces, hands, and human figures; standing negative prompt applied uniformly. |
| Repetition check | **PASS (directional — see §1 caveat)** | Confirmed absent from 68 merged pack directories and 0 currently open PRs. Not cross-checked against the live `reel_jobs` table (no DB access this run). |

**Self-estimated quality score (not the real gate — see `brief.json` for the
full breakdown): 50/75**, same structural profile as the prior pack in this
series (strong on faceless/claim-safety/beat-structure/muted-first, weak on
`sourcedFact` and `loop` because no `EvidenceRecord` was cited and no loop
seam was designed between beat 5 and beat 1).

---

## 8 · IG/FB copy + ad-ready variants

**Primary caption (organic post):**

> Dead battery again — even though it's not old? 🔋 It might not be the
> battery at all. A trunk light, a bad relay, or a module that won't power
> down can drain it overnight. We test for that before you buy a new one.
> #NicksTireAuto #Euclid #CarBattery #AutoRepair #CarCare #Cleveland

**Ad variant A (problem-first hook):**
- Hook: "Your battery starts the car fine every day — so why is it dead
  every morning?"
- Caption: "A phantom drain can kill a good battery overnight. We find the
  drain, not just replace the part."
- CTA: "Book a battery & electrical check — link in bio."

**Ad variant B (cost-avoidance hook):**
- Hook: "Don't buy a new battery until you rule this out."
- Caption: "A new battery won't fix a drain that's still there. We test
  first."
- CTA: "Send us a message before you buy — link in bio."

**Posting specs:** Instagram Reels + Facebook, 1080×1920 (9:16), MP4 H.264
30fps, 28s runtime, account `@nicks_tire_euclid`, SEND-oriented CTA (per the
existing pattern in this pack series, not a `PURCHASE`-style CTA).

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

**Backlog note:** the open-PR backlog that blocked the last three runs from
producing a full pack is currently at zero (§1). If it climbs back into the
double digits before this PR is reviewed, the recommendation from those
prior runs still stands: batch-review before adding more, or slow the
firing interval at the trigger level (outside what any single firing of
this task can change from inside the run).
