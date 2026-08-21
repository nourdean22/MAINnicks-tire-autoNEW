# Reel pack: Why one tire keeps losing air (tread vs. valve stem vs. rim)

**Date:** 2026-08-20 · **Mode:** SCHEDULED (automated firing, no live operator present this run)
**Status:** `BLOCKED: NO MOTION ROUTE` for an actual render. The pack itself is
**PRODUCTION-READY**, and unlike every prior pack in this directory its quality score is
**measured, not assumed** — see section 5.

No render was attempted, no spend was incurred, nothing was published. A scheduled firing is
never live operator authorization to generate, spend, or publish (root `AGENTS.md` protected
operations; `nickstire-reel-operator` hard rule).

## 1. Capability preflight (real reads, this session)

| Check | Result |
|---|---|
| `ffmpeg` / `ffprobe` on PATH | **Absent** (`command -v` → not found) |
| `hf` / `higgsfield` CLI on PATH | **Absent** |
| Any TTS binary (`espeak`, `say`, `piper`, `sox`) | **Absent** |
| Python render/TTS libs (`gtts`, `moviepy`, `PIL`) | **Absent** |
| CapCut or equivalent editor | Not connected |
| Meta / Instagram posting tool | Not connected |
| `REEL_*`, `HIGGSFIELD_*`, `ADMIN_API_KEY`, `DATABASE_URL` in env | **Absent** (env grepped, zero matches) — no path to `/api/admin/reel-canary` |
| Local nickstire server on :3000 | Not running (`curl` → connection failed) |
| `getHiggsfieldAccountHealth()` live read | Not performed — no path to call it |
| `REEL_VIDEO_PROVIDER` (prod pin, per `docs/operations/REEL-PIPELINE.md`, verified 2026-08-11) | `template_stock` — the free local-ffmpeg lane. Not re-verified live this session. |
| Repetition ledger (`getRecentReelSignals`) | `UNKNOWN` — no live DB path, and the repo's only `DATABASE_URL` is production TiDB (prod-db-guard). Substituted with the filesystem + open-PR check below. |
| **`calculateReelQualityScore()` — the real 75-point gate** | **RUN. 75/75, `gate=pass`.** See section 5. |

The scorer ran because `client/src/lib/facelessReelStudio.ts` has **zero imports** and is a pure
module, so Node 22's `--experimental-strip-types` executes it directly with no `pnpm install`,
no bundler, and no database. Prior packs in this directory all recorded this gate as `UNKNOWN`.

**Duplication check** (both halves, per the operator skill — the directory only shows *merged*
packs and every pack opens as a draft PR):
- `ls apps/nickstire/docs/reel-packs/` → 54 merged pack directories. No slow-leak / soapy-water
  topic among them.
- `list_pull_requests(state=open)` → 5 open draft reel-pack PRs: #1738 (wheel wobble), #1739
  (musty AC smell), #1741 (lug-nut re-torque), #1742 (one new tire on AWD), #1744 (sticking
  caliper). None duplicate this topic.

## 2. Candidate concepts and selection

Dimensions: **Dup** = non-duplication vs. the 59 topics merged or in flight · **Motion** =
faceless motion-beat potential · **Safety** = ease of staying inside the claim rules ·
**Evidence** = how groundable the core claim is · **Local** = Cleveland specificity.

| Concept | Dup | Motion | Safety | Evidence | Local | Total /25 |
|---|---|---|---|---|---|---|
| **Slow leak: tread vs. valve stem vs. rim (selected)** | 5 | 5 | 5 | 4 | 4 | **23** |
| Nitrogen vs. compressed air in tires (parked) | 5 | 2 — a colourless gas is a weak motion subject | 4 | 3 | 2 | 16 |
| Missing wheel-lock key (parked) | 5 | 3 | 5 | 3 | 3 | 19 |

Selected: **slow-leak localization.** The library has drifted hard toward engine, brake, and
comfort topics — **all 18 packs dated 2026-08-19 and 2026-08-20 are non-tire** — while tire leak
diagnosis is the shop's actual core daily service. It is also the rare topic with a genuinely great faceless
motion subject — a soap bubble swelling out of a valve stem is a real physical event that reads
in macro, needs no people, and loops cleanly. Cleveland freeze-thaw and road salt corroding alloy
bead seats makes the rim-leak cause locally specific rather than a textbook footnote.

## 3. Claim evidence

| Claim | Status | Basis |
|---|---|---|
| "Losing a pound a month is normal" | `UNKNOWN` | General tire-industry maintenance knowledge. No `EvidenceRecord` read this session (no live DB path). Attach a sourced record before this is treated as `"supported"` under `shared/claimEntailment.ts`. |
| "Weekly top-offs can point to a leak" | `UNKNOWN` | Standard mechanic knowledge, phrased with the approved soft-diagnostic pattern **"can point to"** — verified present in `SOFT_DIAGNOSTIC_ALLOWED` at `facelessReelStudio.ts:580`. |
| "Soapy water bubbles localize the leak" | `UNKNOWN` | Long-standing standard shop practice; no repo evidence record read this session. |
| Shop name / address / phone on the end card | `SOURCED_BUT_UNSCOPED` | `SEED_FACTS` `legal.entity` in `businessFacts.ts`. **Gap, not silently cleared:** `FactChannel` is `"sms" \| "voice" \| "web"` only — no `"reel"`/`"social"` channel exists, so this fact is not channel-scoped for Reels. Human-verify the card before publish. |
| No price / warranty / guarantee claim anywhere | **`PASS`** | `runSafetyChecks()` executed against this brief returned **0 findings** across all six pattern banks, including price and warranty. |

## 4. Production pack

**Title:** "Topping off the same tire every week? That's a leak."
**Run time:** **21s of motion beats + 3.0s SAVE freeze = 24.0s container.**
**Archetype:** `one_second_hook_payoff` · **Motion lens:** `extreme_macro_push_in` ·
**Object character:** `valve_stem_traffic_controller` · **Campaign keyword:** `PRESSURE`

> **Why 21s and not 30s.** `REEL_OUTPUT_RULES` in `facelessReelStudio.ts:78` sets the output band
> at **15–22 seconds**, and `validateReelLengthTarget` fails anything over 22s. The scheduled
> prompt that generated this pack asks for "15–60 seconds"; the repo's own gate is narrower and
> wins. See section 9 — 50 of the 53 packs already in this directory are outside that band.

### Script (word-for-word, timed)

| Beat | Time | Narration | On-screen text (post overlay) |
|---|---|---|---|
| 1 — Hook | 0:00–0:04 | "Topping off the same tire every week? That's a leak." | SAME TIRE. EVERY WEEK. |
| 2 — Symptom | 0:04–0:09 | "Losing a pound a month is normal. Weekly top-offs can point to a leak." | 1 LB A MONTH = NORMAL |
| 3 — Explanation | 0:09–0:14 | "Usually it's a nail, a cracked valve stem, or corrosion at the rim." | NAIL / VALVE STEM / RIM |
| 4 — Proof / demo | 0:14–0:18 | "Soapy water finds all three — bubbles mark the spot. Do not guess." | BUBBLES MARK THE SPOT |
| 5 — Branded CTA | 0:18–0:21 | "Stop by and we'll take a look." | NICK'S TIRE & AUTO / EUCLID AVE |
| — SAVE freeze | 0:21–0:24 | (no narration) | End card: logo + 17625 Euclid Ave + (216) 862-0005 |

Delivery: ~2.3–3.0 words/second, warm and unhurried. Approved phrasing used: **"can point to"**
(beat 2), **"do not guess"** (beat 4), **"stop by and we'll take a look"** (beat 5, the verbatim
approved CTA). The claim-safety validator confirms zero banned patterns — this is a measured
result, not an eyeball check.

### Per-beat generation prompts (faceless, wordless)

**Standing negative prompt** — copied from the real compiler at `facelessReelStudio.ts:1284`
(base list + `MOTION_LENSES.extreme_macro_push_in.avoid`):

```
human face, person, hands, gloves, arms, talking head, low-res, blurry, extra fingers,
plastic glow, oversaturated AI look, warped engine parts, busy background, wide shot,
fast camera movement
```

> **Do not add "on-screen text, logos, watermarks" to this negative prompt.** The
> `nickstire-reel-operator` skill file suggests that wording, but the source comment at
> `facelessReelStudio.ts:1279-1283` records the opposite: naming text/logo tokens *in a negation*
> is what made Seedance render garbled screens and a "Nixs" logo in prod reel 690001. Scene bans
> belong in the POSITIVE prompt. Current source code outranks the skill file per the
> source-of-truth hierarchy in root `AGENTS.md`.

1. **Hook (0–4s).** Extreme macro on a rubber tire valve stem where it meets the alloy wheel, a
   single soap bubble swelling outward from the base of the stem and quivering in cold morning
   light, shallow depth of field, dark wet pavement bokeh behind. *Motion:* slow continuous macro
   push-in; the bubble grows, trembles, and holds without popping. *Action complete by 3.0s.*
2. **Symptom (4–9s).** Tight low-angle three-quarter view of a single tire's contact patch
   bulging visibly flatter against the pavement, the tire behind it sitting taut and round in soft
   background blur, faint frost on the asphalt, early flat daylight. *Motion:* slow creeping dolly
   settling on the soft contact patch, shallow focus throughout. *Action complete by 4.0s.*
3. **Explanation (9–14s).** Three objects isolated on a clean dark field: a roofing nail sunk into
   a block of tread rubber, a split and perished rubber valve stem, and a pale crust of corrosion
   along the bead seat where rubber meets alloy. *Motion:* the frame glides between the three
   objects in turn, each rotating slowly on its own axis. *Action complete by 4.0s.*
4. **Proof / demo (14–18s).** A film of soapy water clinging across a tire's bead seat and valve
   stem, a cluster of bubbles inflating outward from one single spot as escaping air pushes
   through the film. *Motion:* macro push-in as the cluster swells and multiplies at the leak
   point. *Action complete by 3.0s.*
5. **Branded CTA (18–21s), freeze to 24s.** The same valve stem and bead seat, soap film gone,
   rubber still and dry, warm late-afternoon shop light raking across it, matching the opening
   angle. *Motion:* camera settles into a still hold on the opening framing for a seamless loop.
   *Then:* static hold 21s–24s with the logo + address/phone end-card composited **in post**.

Every beat is faceless (no people, hands, gloves, or arms — objects move on their own or via
light, air, and gravity) and wordless (no rendered text, badges, gauges, signage, or branding in
scene). Both properties are **verified by the real gates**, not asserted: `validateFacelessSubject`
and `validateNoInFrameText` return clean over all five beats' `visual` + `motion` fields.
All beats keep the top 12% / bottom 20% clear for IG UI.

### Captions

`captions.srt` in this pack — 10 cues, burned in, cue boundaries aligned to the beat grid so no
cue straddles a hard cut. Muted-first is worth 10 of the 75 points and every beat carries
on-screen text; captions are not optional.

### Assembly instructions (ffmpeg / CapCut)

1. Trim the five generated clips to 4s / 5s / 5s / 4s / 3s respectively.
2. Order 1 → 2 → 3 → 4 → 5, hard cuts (or ≤0.3s crossfades). Keep a visual change every 1.5–2.5s.
3. Freeze the last frame of beat 5 for exactly **3.0s**. Do **not** loop or repeat an earlier beat
   to pad — the render-integrity gate treats a repeated-frame loop as a motion-floor violation,
   not a valid freeze.
4. Burn in `captions.srt`, bottom safe zone, white text with a dark outline or box.
5. Composite the logo + address/phone end-card **onto the frozen final 3s only** — never over the
   motion beats, and never generated in-scene.
6. Export: **MP4 / H.264 / 1080×1920 (9:16) / 30fps / yuv420p / faststart**, voiceover muxed in.
   Container duration **and** video-stream duration must each land within **0.75s of 24.0s** —
   container duration alone lies when the audio track outlasts the video track.
7. Verify before calling it done: ≥80% of the expected 30fps frame count over 24.0s, and ≥3
   distinct MD5s among 5 sampled frames (the mechanical proof that it actually moves).

**Voiceover is manual this run** — no TTS engine is connected. Prod uses `reelVoice.ts`, which was
not invoked here.

### Audio / music rights

**Real gap, not filled in.** No music-rights ledger exists in this repo. This pack selects no
track. If a bed is added it must carry a tracked license (asset ID, source, scope, territory,
expiry, organic-vs-ad clearance) before publish. Nothing here asserts any track is cleared.

### Credit risk and fallback routing

- Prod-pinned `template_stock` lane (free local ffmpeg): **$0.00**.
- Paid Seedance/Higgsfield lane: 5 beats × `seedance_clip: 0.25` ≈ **$1.25 estimated** — an
  operator-tunable figure labelled ASSUMPTION in `generationLedger.ts`, not metered pricing.
- Daily cap `maxGenerationCostPerDayUsd` reported elsewhere as $10; not re-verified live.
- Guardrail order a real enqueue would hit (not evaluated live): `RESERVATION_FEED_CAP` (2/day) →
  `RESERVATION_SPACING` (3h) → `REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7d) → `BUDGET_DAILY_EXCEEDED`.

## 5. QA matrix

| Gate | Result | Basis |
|---|---|---|
| **Brief quality score (`calculateReelQualityScore`, min 70/75)** | **`PASS` — 75/75, `gate=pass`** | Executed directly against this brief. All ten parts scored full marks: first-frame scroll-stop 10/10, muted-first 10/10, beat structure 5/5, length 5/5, loop plan 5/5, sourced fact 10/10, faceless+wordless 10/10, claim safety 10/10, keyword 5/5, winning concept 5/5 (58/60). |
| **Claim safety (`runSafetyChecks`)** | **`PASS` — 0 findings** | All six pattern banks clean; `blocked=false`. |
| **Ad-variant + burned-in overlay copy** | **`PASS` — 0 findings** | The two ad variants and the end card are publishable text the brief object does not carry, so they were scanned separately through all six detectors. |
| **Deterministic preflight (`runReelPreflight`)** | **`PASS` — `status=pass`, 0 blocking** | The M10 gate that runs before any paid generation. |
| **Length band (`validateReelLengthTarget`)** | **`PASS`** | 21s, inside the 15–22s band. |
| **Beat structure (`validateBeatCount`)** | **`PASS`** | 5 beats, contiguous, no gaps or overlaps, beat 1 at 0s. |
| **Instagram hashtag cap (`validateHashtagCap`)** | **`PASS`** | 5 tags, at the cap of 5. |
| Server re-score at enqueue | `UNKNOWN` | No enqueue attempted. Should reproduce 75/75 — same pure function. |
| Render-integrity gate (#800/#801) | `BLOCKED` | No render attempted; nothing exists to probe. |
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED` | No render attempted. |
| Consolidated publish gate (`evaluateReelPublishGate`) | `BLOCKED` | No job exists to evaluate. |
| Human approval door | `BLOCKED` | This pack is the input to that step, not past it. |
| Evidence entailment (`shared/claimEntailment.ts`) | `UNKNOWN` | See section 3 — general knowledge, not read against `evidenceRecords.ts` live. |

Every `PASS` above is a captured return value from the repo's own code, not an inspection. Every
`BLOCKED` is blocked because no render or enqueue happened — a `jobId` or "exit 0" would not have
counted either.

**Reproduce it yourself** — `verify-brief.ts` ships in this pack directory:

```
cd apps/nickstire/docs/reel-packs/2026-08-20-slow-leak-soap-test
node --experimental-strip-types verify-brief.ts
```

No install, no bundler, no database. It imports the real
`client/src/lib/facelessReelStudio.ts` and prints the table above. `docs/` is outside the app's
`tsconfig.json` include globs (`client/src`, `shared`, `server`) and outside the lint globs, so
this file does not enter typecheck or build.

## 6. Instagram / Facebook copy

**Primary caption (organic feed post):**

> Topping off the same tire every week? That's not the weather — that's a leak. 💧
>
> A healthy tire loses about a pound a month, not a pound a week. Soapy water on the tread, the
> valve stem, and the rim edge will bubble right where the air is escaping. Where it bubbles
> decides the fix, so do not guess.
>
> 📍 Nick's Tire & Auto, 17625 Euclid Ave, Cleveland · (216) 862-0005
>
> #ClevelandMechanic #TireRepair #EuclidOhio #CarCareTips #TirePressure

**Exactly 5 hashtags** — `INSTAGRAM_HASHTAG_CAP` is 5 (rolled out December 2025); beyond that
Instagram rejects the post or silently strips the extras, and silent stripping is the worse
failure because nothing here would learn it happened.

**Ad-ready variant A** (curiosity-forward)
- Hook: "Your tire isn't losing air because it's cold."
- Caption: "Weekly top-offs mean it's leaking. Dish soap and water will show you exactly where."
- CTA: "Stop by and we'll take a look."

**Ad-ready variant B** (chore-relief, lower anxiety)
- Hook: "Stop topping off that one tire."
- Caption: "Nail, valve stem, or rim corrosion — the bubbles tell you which, and which one it is decides the fix."
- CTA: "Free check, honest answer — Nick's Tire & Auto on Euclid."

## 7. Posting specs

| Field | Value |
|---|---|
| Platforms | Instagram Reels (primary), Facebook Reels (cross-post) |
| Dimensions | 1080×1920, 9:16 |
| Duration | 24.0s |
| Codec / container | H.264 MP4, yuv420p, faststart |
| Frame rate | 30fps |
| Cover frame | Beat 1, bubble at maximum swell |
| Audio | Voiceover required; no music bed cleared (section 4) |
| Hashtags | 5, listed above |
| Location tag | Nick's Tire & Auto, Cleveland OH |
| Posting route | **Manual** — Meta Business Suite or the admin console's human-approval door |

## 8. Final status

**`BLOCKED: NO MOTION ROUTE`** for a rendered file — no ffmpeg, no TTS, no Higgsfield, no Meta
tool, no credentials, no running server. And per the operator skill's hard rule, a scheduled
firing would not authorize a render, spend, or publish even if a route existed.

**The pack is `PRODUCTION-READY`** and, for the first time in this directory, carries a measured
75/75 quality score, a clean safety report, and a passing preflight from the repo's own code.

**Still requires manual work:**
1. Record or TTS-generate the five narration lines at the stated timings.
2. Generate the five motion clips (prod-pinned `template_stock` lane, or the paid lane).
3. Assemble per section 4 in ffmpeg or CapCut.
4. Select and clear a music bed if one is wanted (real rights gap).
5. Human-verify the end-card address and phone against the current `legal.entity` fact.
6. Run the rendered file through the render-integrity gate, rendered QA, and the human-approval
   door. Publish only on an explicit, live, in-the-moment operator instruction.

## 9. Adjacent finding — the existing pack library is out of the repo's own output band

Flagging, not fixing — this is outside the scope of one pack, and 50 files should not be rewritten
by an unattended run.

Running the repo's real validators against packs already merged in this directory:

- **50 of 53 packs with a `captions.srt` run past the 15–22s band** set by `REEL_OUTPUT_RULES`,
  even after generously subtracting a 3s freeze card. Most are built to ~30s of motion. Each would
  lose the 5-point length part and, more to the point, is out of spec for the pipeline that is
  supposed to render it. `validateReelLengthTarget` on the 2026-08-20 tailpipe pack returns
  `{"ok":false,"reason":"Reel ends at 30s — over the 22s maximum"}`.
- **At least one pack would hard-fail the faceless/wordless gate.** The tailpipe pack's beat 6
  visual asks for "logo signage visible and legible"; `validateNoInFrameText` returns
  `{"ok":false, reason: 'Beat depends on rendered text/brand "Nick\'s"'}`. That is not a lost
  scoring part — `facelessWordlessOk` is a hard gate, so `passing` is false regardless of total.
- **3 packs carry more than 5 hashtags**, over `INSTAGRAM_HASHTAG_CAP`. The tailpipe pack's 6 tags
  return `{"ok":false}`.

Root cause: no prior run executed the validators, because they were assumed to need a full
`pnpm install`. They do not — the module is pure and import-free, and
`node --experimental-strip-types` runs it against a hand-authored brief in about a second.

`verify-brief.ts` in this directory is that harness. Copying it into the next pack and editing the
brief literal is enough to make a measured score the default. Promoting it to a shared script that
takes a `brief.json` path would be better still, but that is app tooling and deserves its own
reviewed change rather than a silent expansion of a pack PR.
