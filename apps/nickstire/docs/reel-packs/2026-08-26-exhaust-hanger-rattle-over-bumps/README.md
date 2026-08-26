# Reel production pack — "Rattle under the car over every bump? Check the exhaust hanger, not just the muffler" (2026-08-26)

Scheduled-task run · 2026-08-26 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **EXHAUST-HANGER**
· no slate file backs this topic (see §2)

**No generation, DB read, or publish call was made against production this run.**
This is a scheduled/automated firing with no live operator present — the operator
skill's hard rule is explicit that a stored scheduled prompt does not authorize
`reel-canary` generation or publish calls, and that repetition-ledger/quality-score
reads against the live database are themselves a production read, not a free
action. This session made none of those calls. See §1 and §9.

The scheduled prompt itself asked generically to "generate a complete
production-ready faceless short-form video workflow" and to check tool
availability (ChatGPT, TTS, Higgsfield, Meta posting, render, CapCut) before
choosing between a rendered file and a production pack. See §1 for that
checklist, answered plainly rather than assumed.

---

## 1 · Tool-availability checklist and mode

| Tool asked about | Available to this session? | Basis |
|---|---|---|
| ChatGPT / an LLM to write the script | Yes — this session itself | Used directly; no external LLM call needed |
| TTS (voiceover generation) | **No** | No TTS MCP tool or a reachable `reelVoice.ts` live call from this Claude Code repo session |
| Higgsfield (AI video generation) | **No** | `getHiggsfieldAccountHealth()` requires the live server process + `HIGGSFIELD_API_KEY`; `env` in this session has no such key. Also moot — prod is pinned to `template_stock`, not Higgsfield (see below) |
| Meta posting (Instagram/Facebook) | **No** (and would not be used even if reachable) | Protected customer-facing action per root `AGENTS.md`; requires explicit live operator instruction every time, which a scheduled firing never carries |
| Shell / render (ffmpeg) | Partially | Bash/ffmpeg is technically reachable in this container, but there are no source video clips to assemble — nothing to render without the asset-generation step above |
| CapCut or similar editing software | **No** | Desktop/mobile app, not available in this environment |

**Conclusion: tools are missing for a finished render.** Per the scheduled
prompt's own rule ("do not claim a finished file exists unless you have
rendered it — if uncertain, default to the production pack"), this run
produces a **production-ready pack**, not an MP4. This matches the operator
skill's own instruction for exactly this situation ("Producing a pack when
the motion route is unavailable").

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops short
of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`) and
short of any live read against the production TiDB database. Confirmed via
`env | grep -Ei 'ADMIN_API_KEY|HIGGSFIELD|DATABASE_URL|REEL_'` — none present
in this session's environment.

**Other capability reads:**

| Capability | Status this run | Why |
|---|---|---|
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** (the free local-ffmpeg lane), not Higgsfield/Seedance. Treat as last-known, not live-confirmed this run. |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | Not read live | Would require a live server/DB read; per the skill's hard rule and `prod-db-guard`, not queried this run. |
| Claim-safety pattern banks (`FORBIDDEN_CLAIM_PATTERNS` etc.) | **Actually run**, standalone, against this pack's narration | Pure regex, no DB/network — see §4 and `brief.json.claimSafetyVerification`. Real verification, not a self-estimate, for this one narrow check. |

**Repetition-ledger context:** `getRecentReelSignals()` was not queried — it
reads the live `reel_jobs` table on production TiDB. Instead, per the
operator skill's collision-avoidance rule, both required checks were run:

1. `ls apps/nickstire/docs/reel-packs/` — **~97 prior merged pack
   directories** (2026-08-14 through 2026-08-25), none about a broken
   exhaust hanger/isolator specifically. Adjacent-but-distinct merged
   topics: `2026-08-19-heat-shield-rattle` (a heat shield vibrating against
   the body, not a swinging pipe), `2026-08-23-exhaust-suddenly-loud-rusted-muffler`
   (a rusted-through muffler changing the *sound level*, not a rattle/bang
   from a loose pipe), and `2026-08-24-turbo-whistle-vs-boost-leak` (an
   intake/boost-side whistle, unrelated). None of the three cover a
   hanger/isolator failure.
2. `mcp__github__search_pull_requests`, `"reel pack" in:title is:pr is:open`
   — **8 open content PRs** (#1835, #1857, #1865, #1867, #1873, #1875,
   #1876, #1877: exhaust manifold cold-start tick, AC compressor clutch,
   rear defroster, brake light switch/cruise/shift-lock, 4WD/AWD driveline
   bind, torque converter shudder, transmission delayed engagement,
   thermostat stuck open/closed) plus 2 backlog-status-only PRs (#1842,
   #1874). None overlap this topic.

This is a file-system + PR-search check, not a substitute for the real
ledger — a rejected `reel_jobs` brief that never produced a pack would not
show up here, so treat "not found" as directional, not a guarantee of zero
repetition.

**Backlog update, stated plainly:** the last two runs in this directory
(#1842, #1874) reported the open-PR backlog growing same-day, from 127 to
132, and both recommended an operator batch-review. A live check this run
(`search_pull_requests`, `is:pr is:open` on this repo, no title filter)
found **11 open PRs total**, 8 of them reel-pack content and 2 backlog
status notes — down from the 132 reported roughly 24 hours ago. That is
consistent with the operator having acted on the batch-review
recommendation between then and now. Worth confirming with the operator
directly rather than assumed, but the number itself is a live read, not
carried forward from the prior reports.

---

## 2 · Candidate scores and selection

No slate file (`REEL-SLATE-*.md`) currently exists in `apps/nickstire/docs/`.
Topic selection is ad hoc: a common, evergreen driver symptom not yet
covered by title or close paraphrase, chosen from the repetition-avoidance
check in §1.

| Candidate | Hook strength | Evergreen? | Overlap risk | Selected? |
|---|---|---|---|---|
| Exhaust hanger/isolator failure — rattle & bang over bumps | Strong — nearly universal "what's that noise under my car" moment, clear two-tier urgency (light rattle vs. dragging-pipe bang), distinct visual (a sagging/swinging pipe) | Yes | Low — adjacent to heat-shield-rattle and rusted-muffler but names a different failed part and a different symptom mechanism (see §1) | ✅ **Selected** |
| Power window regulator cable snap (window drops into door) | Moderate | Yes | Low | Parked |
| Radiator overflow/coolant reservoir cap failure — losing coolant with no visible leak | Moderate | Yes | Low-moderate — brushes against `radiator-cap-pressure-test` (merged 2026-08-21), similar mechanism | Parked |

Exhaust hanger/isolator was selected for the strongest hook and the
clearest visual distinction from the three closest existing titles, over
two candidates with either a weaker hook or closer overlap to an already-
merged pack.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| A rattle/bang under the car over bumps "can point to" a broken exhaust hanger/isolator, not just the muffler | Standard automotive mechanical knowledge (rubber exhaust hangers/isolators dry-rot and crack with age/heat cycling, letting the pipe swing and strike the underbody or suspension components — a distinct failure mode from a muffler rusting through, which changes sound level rather than causing impact noise) | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read). Phrasing uses "can point to," the approved soft-diagnostic pattern, which is the correct hedge for a claim not verified against the store this run. |
| "A dragging pipe can rip loose and become a hazard" | Standard automotive mechanical knowledge (a pipe that has lost all support can drag on pavement, catch on road debris, or fully detach) | **UNKNOWN against this repo's evidence store**, same reasoning as above. Deliberately avoids the FEARMONGER_PATTERNS bank's "could kill" / "catastroph" / "time bomb" wording — see §4 verification. |
| "Free check, written quote before any work" | `businessFacts.ts` `SEED_FACTS`, `factKey: "repair.pricing_policy"` — code-read only, not a live DB read | **Matches the code default verbatim in substance** ("never quote a number blind — free check, written quote, you don't pay until you say yes"). Same channel gap as every prior pack (see below). |
| Shop name, address, phone | `businessFacts.ts` `SEED_FACTS`, `factKey: "legal.entity"` — code-read only | "Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112" — matches the script's shop-name/address CTA line. |
| No warranty, wait-time, guarantee, or stock claim anywhere in the script | Reviewed against the script directly | **N/A — deliberately avoided.** |

**Gap, stated plainly:** `businessFacts.ts`'s `FactChannel` type is
`"sms" | "voice" | "web"` only — there is no `"reel"` channel. This script's
"free check, written quote" line paraphrases the `repair.pricing_policy`
fact's substance rather than quoting a channel-cleared string, since no reel
channel exists to clear it against. Same gap every prior pack in this
directory has flagged, not newly discovered here.

---

## 4 · Full production pack

### Script — word-for-word, timed (32s total, 7 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "Rattling under your car every time you hit a bump?" |
| 2 · SETUP | 0:03–0:08 | "That's not always the muffler — it's often a broken exhaust hanger." |
| 3 · VALUE | 0:08–0:13 | "A cracked rubber isolator can point to a pipe swinging loose underneath." |
| 4 · VALUE | 0:13–0:19 | "A light rattle: one clue, still fine to drive over, carefully." |
| 5 · VALUE | 0:19–0:25 | "A loud bang or scraping? Stop — a dragging pipe can rip loose and become a hazard." |
| 6 · CTA | 0:25–0:29 | "Do not guess which hanger failed. We check the whole exhaust — free check, written quote before any work." |
| 7 · CTA (SAVE freeze) | 0:29–0:32 | "Nick's Tire & Auto — Euclid Ave, Cleveland. Stop by and we'll take a look." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes, claim-safety verification result): [`brief.json`](./brief.json).

**Claim-safety check — actually run, not just estimated.** All four
relevant real pattern banks (`FORBIDDEN_CLAIM_PATTERNS`,
`OVERDIAGNOSIS_PATTERNS`, `FEARMONGER_PATTERNS`,
`GENERIC_MARKETING_PATTERNS`) plus `PRICE_CLAIM_PATTERN` were copied
verbatim from `client/src/lib/facelessReelStudio.ts` into a standalone Node
script (pure regex, no imports, no DB, no network) and executed against the
full narration text above. **Result: zero findings across all five.** See
`brief.json.claimSafetyVerification` for the method note and result. Still
not the same as invoking `runSafetyChecks()`/`detectFabricatedStats()` on a
live `ReelBrief` object through the actual module, which was not done this
run.

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per
beat.** Per-beat prompts are in `brief.json`. Standing negative prompt for
every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no
API spend).** Per `docs/operations/REEL-PIPELINE.md`, this is what prod
currently renders on. Search terms for free stock (Pexels/Pixabay/Coverr —
search manually; no specific clip URLs are asserted here since none were
verified live this run):

- Beat 1: "car driving over pothole suspension bounce" / "pov driving bumpy road interior"
- Beat 2: "car underbody exhaust pipe rusty" / "mechanic under car flashlight inspection"
- Beat 3: "rubber exhaust hanger cracked close up" / "exhaust pipe mount macro"
- Beat 4: "exhaust pipe hanging slightly underbody" / "car underside static shot garage lift"
- Beat 5: "exhaust pipe dragging sparks pavement" / "car on lift exhaust system wide shot"
- Beat 6: "mechanic inspecting exhaust system car lift" / "gloved hand checking exhaust hanger"
- Beat 7: "auto repair garage bay interior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; script above is exactly what gets
fed to it, already timed to the 32s budget.

### Captions

[`captions.srt`](./captions.srt) — 12 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration
above. Style: white bold sans, black outline/shadow, bottom-third safe
zone — burn in via ffmpeg `subtitles` filter, never as a generated
in-frame element (Seedance/Higgsfield can't spell reliably, and M10
preflight blocks generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat →
   ambient road/garage room-tone/SFX (optional, see §6) → voiceover track →
   burned-in caption track → end-card CTA text (beat 7 only, shop name +
   address).
2. **Assembly:** concatenate the 7 beat clips in order, cut hard on each
   beat boundary (no crossfade — matches the render-integrity gate's
   expectation of distinct per-beat frames, not a dissolve-blurred
   transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** neutral daylight tone on beats 1–2 (POV driving, underbody
   inspection), bright clinical work-light on beat 3 (isolator macro), calm
   neutral tone on beat 4 ("still fine to drive" state), shift
   warmer/more saturated red-amber and add slight handheld shake on beat 5
   ("stop" urgency), neutral garage tone on beat 6, warm inviting shift on
   beat 7 (CTA).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 32s, video-stream duration
   within 0.75s of 32s, ≥80% of expected 30fps frame count, ≥3 distinct
   MD5s among 5 sampled frames (motion proof — no static/looped single
   image; every beat here is deliberately a camera move, part swap, or
   state change, not a still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 32s (within the 15–60s target range)
- **Posting slot:** do not schedule ad hoc. Check whether today's feed-post
  cap (2/day, §5) is already claimed by `dailyReelPost.ts` (if
  `REEL_AUTOPOST_ENABLED=true`) or by one of the 8 open-PR packs landing
  first, before this one is queued.
- **Caption/hashtags:** see §8 below
- **CTA type:** SAVE/informational close (see `ctaTypeNote` in `brief.json`)

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live
balance check):

| Route | Per-unit cost | 7-beat estimate |
|---|---|---|
| `template_stock` (**current prod pin** per REEL-PIPELINE.md) | $0/clip, local ffmpeg | **$0** |
| `seedance_clip` | $0.25/clip (labeled ASSUMPTION in source — unverified) | ~$1.75 |
| `veo_second_720p` | $0.10/sec | ~$4.55 (7 clips × ~6.5s avg) |
| Voiceover (`elevenlabs_vo`) | $0.05 | $0.05 |
| Brief compile (`gemini_brief`) | $0.01 | $0.01 |

**Estimated total for this pack on the actual prod-pinned route:** ~$0.06
(VO + brief only; clips are free on `template_stock`). This is an
operator-tunable estimate, not a metered price — treat as directional.

**Daily budget ceiling:** `UNKNOWN` — `maxGenerationCostPerDayUsd` lives in
the latest `autonomy_policy_versions` row, which was not read this run
(live DB). Account balance (`getHiggsfieldAccountHealth().balanceCredits`)
is likewise `UNKNOWN` — not probed.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. With
8 packs already sitting as open content PRs and this making a 9th, several
of these should be expected to actually trigger once real enqueues are
attempted — this run does not resolve that queue, only adds one item to it.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, same as
every prior pack in this directory). This pack sidesteps it deliberately
rather than asserting a track is cleared: **no music bed is assigned.**
The reel is voiceover + captions + one optional royalty-free ambient/SFX
layer (road noise under beats 1–2, a soft metallic rattle/clank under beat
5), which also scores well on the pipeline's muted-first requirement since
the captions alone carry full meaning. If the operator wants a music bed,
that requires a specific track with asset ID, source, license scope,
territory, and expiry tracked by hand — this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED`
pending an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Claim-safety pattern banks (forbidden/overdiagnosis/fearmonger/generic/price) | `facelessReelStudio.ts` detectors | **PASS** | Actually executed (regex copied verbatim, run standalone) against the full narration — zero findings. See §4 and `brief.json.claimSafetyVerification`. |
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/`brief.json` carries a self-estimate that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption:**

> Rattle or bang under your car every time you hit a bump?
>
> It's not always the muffler — a cracked rubber exhaust hanger can point
> to a pipe swinging loose underneath.
>
> Light rattle? One clue, still fine to drive over, carefully.
> Loud bang or scraping? Stop — a dragging pipe can rip loose and become a
> hazard.
>
> Do not guess which hanger failed. Free check, written quote before any
> work.
>
> #exhaustsystem #cartips #whatsthatnoise #autorepair #clevelandohio

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Why does my car rattle every time I hit a bump?"
> Caption: A metallic rattle under the car usually isn't the muffler — it's
> a cracked rubber hanger letting the exhaust pipe swing loose. Light
> rattle, still fine to drive over carefully. Loud bang or scraping under
> the car, stop — a dragging pipe can rip loose.
> CTA: Not sure what's loose under there? Stop by 17625 Euclid Ave — free
> check, written quote before any work.

**Ad-ready variant B (question-forward):**

> Hook: "Do you know the difference between a rattle you can drive on and
> one you can't?"
> Caption: A light metallic rattle over bumps is one clue — a cracked
> exhaust hanger, not an emergency. A loud bang or scraping sound is
> different — that's a pipe already dragging, and it can rip loose.
> CTA: Bring it by — we check the whole exhaust system, free check,
> written quote before any work.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: no live re-score from the server's authoritative
`calculateReelQualityScore()` has run (self-estimate only, see
`brief.json`), and no `EvidenceRecord` in `evidenceResolver.ts` currently
backs the hanger/isolator or dragging-pipe claims — that store wasn't
queried live this run to check. The claim-safety pattern banks were
actually run and returned clean (§4, §7), which is a real gate result, not
a self-estimate — but that is one gate among several the real
`calculateReelQualityScore()`/`evaluateReelPublishGate()` still need to
clear for real. Not `PUBLISHED WITH READ-BACK` — no `reel-canary` call, no
`igPostId`, nothing was generated, rendered, or posted. Not `BLOCKED`
outright — the pack is complete and usable; an operator (or a
live-authorized session) can hand it to the real pipeline via
`/api/admin/reel-canary {action:"start", topic:"broken exhaust hanger —
rattle and bang over bumps, not always the muffler"}`, let the server
re-score and re-render for real, and only then move toward publish.

**Backlog note for the operator:** §1 found the open reel-pack PR count at
11 (8 content + 2 status), down sharply from the 132 reported ~24 hours ago
in PR #1874 — apparent evidence the prior batch-review recommendation was
acted on. Against ~97 merged pack directories and a 2-post/day feed cap,
supply still runs well ahead of plausible posting throughput; this pack is
one more addition to that queue, consistent with this run's mandate
(produce one non-duplicate pack), not a claim that the underlying
supply/throughput mismatch is resolved.
