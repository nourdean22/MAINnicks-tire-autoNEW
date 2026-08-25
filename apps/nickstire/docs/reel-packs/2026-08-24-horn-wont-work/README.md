# Reel production pack — "Your horn just went silent. Here's why" (2026-08-24)

Scheduled-task run · 2026-08-24 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **HORNOUT**

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
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / `DATABASE_URL` / `REEL_*` / `OPENAI` / `ANTHROPIC_API` / `META_*` / `INSTAGRAM` / `ELEVENLABS` / `TTS` env vars | **Not present** | `env \| grep -iE "HIGGSFIELD\|ADMIN_API_KEY\|DATABASE_URL\|REEL_\|OPENAI\|ANTHROPIC_API\|META_\|INSTAGRAM\|ELEVENLABS\|TTS"` returned nothing in this session's shell. |
| `ffmpeg` | **Not present** | `which ffmpeg` returned nothing. No local render path even for the free `template_stock` lane. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `apps/nickstire/docs/operations/REEL-PIPELINE.md` states prod reads `template_stock` (verified 2026-08-11) — the paid Higgsfield lane was dropped, reels render on the free local-ffmpeg lane. Not re-confirmed live this run. |
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

    ls apps/nickstire/docs/reel-packs/                                              → 89 merged pack directories (2026-08-14 → 2026-08-23), none dated 2026-08-24 yet
    search_pull_requests "repo:.../mainnicks-tire-autonew is:pr is:open reel pack in:title" → 3 open PRs, all filed 2026-08-23 evening

**Three open, unreviewed reel-pack PRs exist right now** (#1816 heater-core
sweet smell, #1817 washer fluid won't spray, #1818 trunk/hatch gas strut) —
well under the 12–37-open range that made prior runs stop and file a
status-only PR instead. None of the three open titles, and none of the 89
merged topics, overlaps a horn/electrical-relay topic, so this run proceeded
with a full pack.

Directly relevant near-neighbors, checked individually against the merged
list and the three open PRs:

- `key-fob-dead-battery-no-start` (08-21) — a fob/immobilizer no-start
  issue, not a horn circuit. No overlap.
- `power-window-stuck-halfway` (08-21) — a different accessory circuit
  (window motor/regulator), different symptom, different fix path. No overlap.
- `spark-plug-wire-arcing` (08-21) and `timing-chain-rattle-cold-start`
  (08-21) — engine-ignition electrical, not body-electrical/horn circuit.
  No overlap.
- `door-lock-actuator-stripped-gear` (08-23) — a mechanical gear failure
  inside one door's actuator, not a shared electrical fault (fuse/relay/
  clockspring) that kills the horn across the whole car. Distinct mechanism
  and distinct stakes (convenience vs. a genuine safety/warning-signal loss).

A repo-wide search for "horn" across all 89 merged pack directory names and
the 3 open PR titles returned no matches.

**"Your horn suddenly stops working — is it the fuse, the relay, or the
steering wheel clockspring?" is not among any of the above** — it is a
distinct symptom (silence, not noise), a distinct diagnostic ladder (fuse →
relay → clockspring, in that order, each cheaper to check than the next),
and a distinct stakes framing (a horn is a safety/warning device, not a
comfort feature — its loss matters at the exact moment you need it).

> **This is a file-system + PR-title check, not a substitute for the real
> ledger.** An actual `reel_jobs` row for a rejected brief that never got a
> pack written would not show up here — treat "not found in either search"
> as directional, not a guarantee of zero repetition.

---

## 2 · Candidate scores and selection

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Horn suddenly stops working — fuse, relay, or clockspring | Strong — a silence-based hook is unusual for this format (everything else in the series is sound-you-hear or light-you-see; "the sound that should be there and isn't" is a fresh pattern-interrupt), clear 3-step diagnostic ladder, genuine safety stakes | Yes | No | ✅ **Selected** |
| Trunk release button doesn't work but key still opens it | Moderate — decent hook but reads as a close cousin to the open-PR `trunk/hatch gas strut` topic (#1818) to a casual viewer, even though the mechanism (switch/wiring vs. gas strut) differs | Yes | Thematically adjacent to an in-flight open PR | Parked |
| Interior dome light stays on and drains the battery | Moderate — decent hook but close to the merged `battery-parasitic-drain` (08-21) topic's territory; risks reading as a repeat to a casual scroller even though this is one specific, common cause rather than a general diagnostic | Yes | Thematically crowded | Parked |

"Horn won't work" was selected for the strongest pattern-interrupt hook of
the three (a faceless, muted-first format built around captions actually
benefits from a hook about an *absent* sound — it reframes silence as the
attention-grabber instead of fighting the format's own muted-first
constraint), a clean escalating-cost diagnostic ladder, and confirmed
non-overlap with all 89 merged topics and all 3 open-PR topics.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A dead horn is usually a fuse, a relay, or the steering wheel's clockspring — roughly in that order of likelihood" | General automotive electrical-diagnostic guidance (horn circuits are commonly described as fuse → relay → horn switch/clockspring → horn unit, checked cheapest-and-most-likely first) — not shop-specific | **UNKNOWN against this repo's evidence store.** `evidenceResolver.ts` / `evidenceRecords.ts` was not queried live this run (would be a prod DB read, and no `DATABASE_URL` is present in this session). No `EvidenceRecord` citation is attached. A repo-wide grep for "horn" across `server/services/evidenceRecords.ts` returned no matches — there is no existing evidence row to cite even if the DB were reachable. |
| "The clockspring is the coiled ribbon cable behind the steering wheel that lets power reach the horn button while the wheel turns" | Same — standard automotive electrical knowledge (clocksprings are a well-documented steering-column component) | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing is descriptive, not a shop-specific claim. |
| "It can fail from years of steering wheel turns wearing the ribbon" | Inference presented as a possibility, hedged with "can," not stated as certain or with an invented timeline | **UNKNOWN against this repo's evidence store**, same reasoning. No "X miles" or "X years" number invented. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, which sidesteps the channel gap noted below. |

**Gap, stated plainly (same one every prior pack has noted, not new):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack, but it would block any future reel script that
wants to quote a price or warranty line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (20s total, 5 beats)

Matches the studio's own hard format contract (`REEL_OUTPUT_RULES` in
`client/src/lib/facelessReelStudio.ts`: 15–22s, 4–6 beats).

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "You press the horn. Nothing happens." |
| 2 · SETUP | 0:03–0:08 | "That silence usually points to one of three things: a blown fuse, a bad relay, or a worn clockspring." |
| 3 · VALUE | 0:08–0:13 | "The clockspring is the coiled ribbon behind your steering wheel — it lets power reach the horn button while the wheel turns." |
| 4 · VALUE | 0:13–0:17 | "Years of turning can wear that ribbon out, and once it's gone, the horn just goes quiet." |
| 5 · CTA | 0:17–0:20 | "Check the cheap parts first. If it's still silent, stop by and we'll trace it." |

**Total runtime: 20 seconds** (within the 15–60s generic target and inside
the studio's own 22s ceiling).

### Per-beat visual prompts (Higgsfield/Seedance-style, or stock-footage search terms for the `template_stock` free lane)

Standing negative prompt for every beat (faceless format):
`faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

| Beat | Visual prompt | Stock search terms (template_stock lane) |
|---|---|---|
| 1 · HOOK | Close-up of a steering wheel horn pad/center emblem, static camera, soft interior light, nothing else moving | "steering wheel horn button closeup", "car steering wheel center emblem" |
| 2 · SETUP | Close-up of a car fuse box panel with a puller tool resting nearby, one fuse slightly pulled out, workshop lighting | "car fuse box closeup", "automotive fuse panel diagnostic" |
| 3 · VALUE | Close-up of a steering column with the wheel removed, coiled ribbon cable (clockspring) visible, cool workshop lighting, slow push-in | "steering column clockspring closeup", "car steering wheel removed ribbon cable" |
| 4 · VALUE | Close-up of the same clockspring ribbon, slight visual wear/fraying emphasis via lighting angle, static camera — visual callback to beat 3 | "worn ribbon cable closeup", "steering column component wear" |
| 5 · CTA | Wide shot of a clean auto repair shop garage bay, open bay door, warm daylight streaming in | "auto repair shop garage bay interior open door" |

### Assembly instructions (ffmpeg / CapCut — manual, no render performed)

1. **Canvas:** 1080×1920 (9:16), 30fps, H.264, target 15–30 Mbps.
2. **Layer order (bottom to top):** background clip per beat → 20% black
   gradient overlay (top 15% and bottom 20% of frame) for caption legibility
   → burned-in caption text (see `captions.srt`) → optional small logo bug,
   bottom-right, 8% opacity, only on the CTA beat.
3. **Cuts:** hard cut 1→2, hard cut 2→3, a 0.3s cross-dissolve on 3→4 (the
   clockspring wear visual callback), hard cut 4→5.
4. **Captions:** burn in from `captions.srt`, bold sans-serif (e.g. Montserrat
   ExtraBold or system equivalent), white fill + black stroke, centered
   lower-third, max 2 lines, all-caps per house style shown in the SRT file.
5. **Audio:** voiceover track ducked -3dB under any music bed; music bed
   itself is **unassigned** — see §6 for why. Leave a silent/ambient
   room-tone track if no music is available at render time so the file isn't
   dead silent. (Deliberate irony noted, not exploited in-script: this is a
   reel about a missing sound, built muted-first like every reel in this
   series — the joke stays in this note, not in the copy.)
6. **Render-integrity targets** (matching this repo's real `reelAssembly.ts`
   gate, §5 of the operator skill): container duration and video-stream
   duration both within 0.75s of the 20s beat plan + a 3s CTA/SAVE freeze
   hold (~23s final render); ≥80% of expected 30fps frame count; the clip
   must show real motion (not a static still) across at least 3 of 5 sampled
   frames.
7. **Export:** MP4, H.264, 30fps, 1080×1920, target file size under 50MB for
   fast mobile upload.

---

## 5 · Credit-risk and fallback routing

No generation call was made, so no ledger entry was reserved or spent this
run. For reference, if this pack is later run through the real pipeline:

- Per `generationLedger.ts` `COST_ESTIMATES_USD`: on the **`template_stock`**
  lane (prod's current pin per `apps/nickstire/docs/operations/REEL-PIPELINE.md`),
  each clip is **$0** (free local ffmpeg assembly from licensed/stock
  footage). If routed instead through `seedance_clip`, estimate **5 beats ×
  $0.25 = $1.25** against `policy.limits.maxGenerationCostPerDayUsd`
  (documented at $10/day, not re-read live this run).
- `REEL_FALLBACK_TO_TEMPLATE_STOCK` governs degrade-not-dark behavior if a
  paid provider hits a terminal verdict — not exercised here since no
  generation call was made, and the paid provider lane is documented as
  already dropped in prod (§1).
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
| Claim-safety wording (no prices, no guarantees, no fearmongering) | **PASS (self-check against the approved pattern bank)** | Script uses hedged "usually," "can," no price/warranty claims, no absolute guarantees, no invented failure timeline. |
| Faceless compliance | **PASS (self-check)** | Every visual prompt in §4 excludes faces, hands, and human figures; standing negative prompt applied uniformly. |
| Repetition check | **PASS (directional — see §1 caveat)** | Confirmed absent from 89 merged pack directories and all 3 currently open PR topics. Not cross-checked against the live `reel_jobs` table (no DB access this run). |

**Self-estimated quality score (not the real gate — see `brief.json` for the
full breakdown): 50/75**, same structural profile as prior packs in this
series (strong on faceless/claim-safety/beat-structure/muted-first/length,
weak on `sourcedFact` and `loop` because no `EvidenceRecord` was cited and
no loop seam was designed between beat 5 and beat 1).

---

## 8 · IG/FB copy + ad-ready variants

**Primary caption (organic post):**

> Press the horn. Nothing. 🤐 It's usually one of three things — a blown
> fuse, a bad relay, or a worn clockspring behind your steering wheel. Check
> the cheap parts first. If it's still silent, we'll trace it for you.
> #NicksTireAuto #Euclid #CarCare #AutoRepair #Cleveland #CarElectrical

**Ad variant A (problem-first hook):**
- Hook: "You press the horn. Nothing happens."
- Caption: "Usually a fuse, a relay, or the clockspring behind your
  steering wheel wearing out. Start cheap, work up — or let us trace it."
- CTA: "Book a quick electrical check — link in bio."

**Ad variant B (stakes-first hook):**
- Hook: "A silent horn is a safety problem, not just an annoyance."
- Caption: "If your horn stopped working, don't wait for the moment you
  actually need it. We'll find the fuse, relay, or clockspring that failed."
- CTA: "Send us a message before you need it and it's not there — link in bio."

**Posting specs:** Instagram Reels + Facebook, 1080×1920 (9:16), MP4 H.264
30fps, 20s runtime (+3s CTA/SAVE freeze, ~23s final render), account
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

**Backlog note:** three reel-pack PRs are open and unreviewed right now
(§1) — small, well short of the 12–37-open range that made prior runs stop
entirely. No batch-review action needed before this pack.
