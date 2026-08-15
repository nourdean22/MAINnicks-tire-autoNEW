# Reel production pack — "The sidewall bulge" (2026-08-15)

**Run type:** SCHEDULED (automated firing, no live operator present this run) → per
[`reel-operator`](.claude/skills/reel-operator/SKILL.md) v2, SCHEDULED is treated
identically to INTELLIGENCE: research, score, and hand over a pack. **No
`reel-canary` call, no generation, no spend, and no publish happened in this
run** — the skill's hard rule is explicit that a stored/scheduled prompt does
not satisfy the "live, in-the-moment operator instruction" bar required for
any of those actions, and this session had no such live instruction.

Status of this deliverable: **READY FOR HUMAN APPROVAL.** It is a complete
production pack — script, prompts, captions, assembly instructions, posting
copy — not a rendered video. See §9 for why "rendered file exists" is not
being claimed.

---

## 1 · Connected capabilities (this run)

| Check | Result |
|---|---|
| `getHiggsfieldAccountHealth()` (live creds/balance probe) | **NOT QUERIED** — this is a code checkout with no running server session and no live route to call it this run |
| `REEL_VIDEO_PROVIDER` (live env) | **NOT QUERIED live.** Doc-sourced only: `docs/operations/REEL-PIPELINE.md` states prod was verified 2026-08-11 pinned to `template_stock` (the free ffmpeg lane), not `higgsfield`. That doc could be stale by 2026-08-15 — treat as last-known, not current-verified. |
| `REEL_GENERATION_ENABLED` | **UNKNOWN** — not queried live |
| `/api/admin/reel-canary` reachability | **N/A** — SCHEDULED/INTELLIGENCE mode makes zero canary calls by design |
| Repetition ledger (`getRecentReelSignals()`, prod `reel_jobs` table) | **NOT QUERIED.** A live read would be a real production-DB read (`apps/nickstire`'s only `DATABASE_URL` is prod TiDB per `verifier-reel-pipeline`), which this run avoided absent a live instruction. Best available substitute: `docs/REEL-SLATE-2026-07-31.md`, a written 20-topic slate dated 2026-07-31 (16 days before this run). Topic selection below was checked against that list only — **it is not proof nothing newer has run**, since up to 16 days of unlogged production activity could exist. |

**What this means for §9's final status:** even setting aside the hard rule
on spend/publish, this run does not have live confirmation that the motion
route is armed, so a render could not have been attempted honestly even if
the hard rule allowed it.

## 2 · Candidate scoring

One topic was developed to full-pack depth; two others were scored and
parked. Scored 0–5 per dimension (scroll-stop hook, teachability, motion
potential without hands/faces, distinctiveness from the existing 20-topic
slate, claim safety without touching `businessFacts`).

| Candidate | Hook | Teach | Motion | Distinct | Claim-safe | Total /25 | Verdict |
|---|---|---|---|---|---|---|---|
| **Sidewall bulge = pull over, not drive slower** | 5 | 4 | 5 | 5 | 5 | **24** | **Selected** |
| Serpentine belt squeal vs. brake squeal (sound confusion) | 4 | 4 | 3 | 4 | 5 | 20 | Parked — good backup, weaker motion (mostly a static under-hood shot) |
| Transmission fluid color/smell check | 3 | 4 | 3 | 4 | 4 | 18 | Parked — under-hood dipstick shots read close to topic 18 (coolant color) already in the slate |

**Why this one:** not in the 20-item slate (checked against every title in
`REEL-SLATE-2026-07-31.md`); safety-critical in a way that reads as
immediately urgent (scroll-stop); the mechanism (steel-belt separation
flexing under load) is visually distinct from every existing topic's macro
shot; and it needs zero pricing/warranty language, so it doesn't run into the
`businessFacts` reel-channel gap described in §3.

## 3 · Claim evidence

- **Mechanism claim** ("a sidewall bulge is a break/separation in the steel
  belt structure, not a puncture, and can fail suddenly under load/heat"):
  this is uncontroversial, widely-published tire-safety knowledge (matches
  the shape and register of the already-slated penny-test, tread-depth, and
  pothole-damage topics). It was **not** run through `evidenceResolver.ts` /
  `EvidenceRecord` this session — no live DB write for a new evidence record
  happened. Per the skill's own rule, `entailment` therefore reads
  `not_evaluated`, i.e. **UNKNOWN** in the spec's PASS/FAIL/UNKNOWN/BLOCKED
  vocabulary — flagged here rather than silently assumed `supported`.
- **`businessFacts` (pricing/warranty/policy):** none used. `FactChannel` is
  `"sms" | "voice" | "web"` only — there is **no `"reel"` channel** yet, so
  no fact in that store is formally cleared for this use (a real, named gap
  in the skill spec, not new to this run). The script below carries zero
  price, warranty, or turnaround claims specifically to stay inside that gap
  rather than push a claim through a channel that doesn't clear it.
- **Contact info in the CTA block** (phone/address): the `legal.entity` fact
  (`businessFacts.ts`) is channel-scoped to `"web"` only, not even
  `"sms"/"voice"`, let alone `"reel"`. Every reel in `REEL-SLATE-2026-07-31.md`
  already puts this same public phone/address in its CTA despite that gap —
  this pack follows that established precedent, but that is a **judgment
  call carried over from precedent, not a formal clearance**. Flagging it
  rather than presenting it as verified.
- **Local/weather/event claims:** none made. No live source is wired into
  this pipeline (per the skill spec) — correctly omitted rather than assumed.

## 4 · Production pack — "The sidewall bulge"

**Format:** 9:16, 1080×1920, 30fps, H.264 — matches the render-integrity
contract in `reelAssembly.ts`. **Total run time: 24.5s** (21.5s of beats +
the system's fixed 3.0s `SAVE_FREEZE_SECONDS` final freeze). Beat durations
below are deliberately close to `DEFAULT_BEAT_SECONDS = 3` (the system
default) rather than an invented pacing model.

**Standing negative prompt for every generated beat** (per the skill spec —
`faceless` is a hard constraint, not a style choice):
`faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

On-screen text below is **never baked into generation** — it is an `ffmpeg
drawtext` overlay burned in at assembly, exactly matching how
`reelAssembly.ts` and `REEL-SLATE-2026-07-31.md` both do it ("On-screen words
are an ffmpeg overlay, never generated").

### Storyboard

| # | Time | Dur | Visual generation prompt (+ standing negative) | On-screen text (ffmpeg overlay) | Voiceover (word-for-word) |
|---|---|---|---|---|---|
| 1 · HOOK | 0.0–2.0s | 2.0s | Extreme macro push-in on a tire sidewall in hard raking side-light; a soft round bulge just catching a shadow; shallow depth of field; slow, deliberate camera push; cinematic teal-orange grade; tire slowly rotating on dry pavement. | "NOT A FLAT." | "This bump is not a flat tire." |
| 2 · SETUP | 2.0–4.0s | 2.0s | Slow arc/dolly around a parked car's front wheel at golden hour; the sidewall bulge visible from a slightly wider angle; softly out-of-focus garage bay behind; warm practical light only. | "A break under the rubber" | "That's a break in the steel belt underneath." |
| 3 · VALUE 1 | 4.0–7.0s | 3.0s | Macro cross-section-style render of layered tire rubber and steel-belt texture with a visible separation gap; subtle pulsing warm rim-light tracing the gap; no readable text or diagrams, texture only. | "Air pushes on the weak spot" | "Air pushes against that weak spot with every mile." |
| 4 · VALUE 2 | 7.0–10.0s | 3.0s | Tire spinning on a rain-slick road at dusk, motion blur on the tread pattern; the sidewall visibly flexing in and out with each rotation; handheld-feel camera, low angle. | "Every mile makes it worse" | "Every rotation flexes it a little more." |
| 5 · VALUE 3 | 10.0–13.0s | 3.0s | Tire under load on a highway on-ramp at speed, heat shimmer rising off asphalt, warm harsh daylight, motion-streaked background. | "Not a slow leak" | "At highway speed, that steel can let go all at once." |
| 6 · VALUE 4 | 13.0–16.0s | 3.0s | A car pulled fully onto a wide paved shoulder at dusk, blinking hazard lights (practical light source, not a graphic), quiet, safe distance from moving traffic, wide static-ish shot with a slow drift. | "Pull over. Don't limp it." | "A bulge means pull over now, not drive slower." |
| 7 · VALUE 5 | 16.0–18.5s | 2.5s | Match-cut macro comparison: a small nail puncture in tread rubber under calm blue-toned light, cutting to the sidewall bulge under warm red-toned rim-light; same lens, same distance, only the tone and subject change. | "Sidewall damage isn't patchable" | "Tread punctures can often be patched. Sidewall bulges cannot." |
| 8 · CTA | 18.5–21.5s | 3.0s | Wide, calm shot of a tire-shop bay interior at dusk seen through an open door, warm interior light, a tire rack faintly visible in the background, empty foreground, no signage or logos legible. | "Stop by. We'll take a look." | "Not sure what you're seeing? Stop by and we'll take a look." |
| 9 · SAVE FREEZE (system-generated, not a new beat) | 21.5–24.5s | 3.0s | Frozen last frame of beat 8 (`tpad=stop_mode=clone`) — no new generation. | "🚨 SIDEWALL BULGE = PULL OVER" (recap card) | *(VO silent; music bed only, if cleared — see §6)* |

**Full VO transcript (62 words, ~24.5s spoken across 8 beats ⇒ ~2.5 words/sec
average, with beats 5/6/7 running closer to 3–3.3 wps for punchy delivery —
note for the TTS/VO artist: a conversational rate around 1.05–1.1× a neutral
reading pace lands this naturally without rushing):**

> This bump is not a flat tire. That's a break in the steel belt underneath.
> Air pushes against that weak spot with every mile. Every rotation flexes it
> a little more. At highway speed, that steel can let go all at once. A bulge
> means pull over now, not drive slower. Tread punctures can often be
> patched. Sidewall bulges cannot. Not sure what you're seeing? Stop by and
> we'll take a look.

A synced `.srt` caption file (full transcript, beat-aligned timestamps) ships
alongside this pack: `REEL-PACK-2026-08-15-sidewall-bulge.srt`.

## 5 · Asset list

**Primary route (HERO — paid, not armed this run):** Higgsfield Seedance 1.5
Pro, one clip per beat, using the exact per-beat prompts + standing negative
prompt in §4. This is the route that actually produces real generated
footage. **Not usable this run** — no live credential check, and even if
credentials were healthy, generating costs real money and this run has no
live spend authorization (hard rule, §0 of the skill).

**Fallback route (`template_stock`, free, $0/clip) — read the real behavior
before assuming it satisfies "background footage":** per
`server/services/templateStockStudio.ts`, this lane does **not** use stock
video footage at all. It is ffmpeg-generated: a dark base color
(`0x0B0B0F`) swept toward one of four tones, animated with one of six
deterministic per-beat camera moves (`push_in`, `punch_in`, `pull_out`,
`pan_right`, `pan_left`, `drift_up`). It exists so the pipeline never goes
dark when the paid lane is down, not to simulate real footage. **If this pack
is rendered on the free lane, the visuals in §4's prompt column will not
appear — the operator will get moving color-gradient backdrops with the same
on-screen text/VO/captions layered on top, not the described macro shots.**
Flagging this explicitly so "rendered on the free lane" is never mistaken for
"matches the storyboard."

**Voiceover:** `reelVoice.ts` is the real generation module (see
`verifier-reel-pipeline` for its fail-closed contract) — not invoked this
run. `REEL-PIPELINE-HANDOFF.md` (2026-06-18, not re-verified since) documents
Google Cloud TTS Neural2 as the commercial-clean default and ElevenLabs
(voice `Roger`) as a richer alternative requiring attribution for commercial
use — cite both as documented options, not as live-verified this run.

**Music:** see §6 — no cleared asset exists; none is assumed here.

## 6 · Credit-risk and fallback routing

- Per-clip cost estimates, read from `generationLedger.ts`'s
  `COST_ESTIMATES_USD` (source-code constants, not a live metered price):
  `seedance_clip: $0.25` (labeled an ASSUMPTION in that file's own comment),
  `template_stock_clip: $0`, `veo_second_720p: $0.10` (the one Google-published
  real figure).
- **If** this pack were generated on the paid Seedance lane: 8 beats ×
  $0.25 ≈ **$2.00 estimated**, against a documented `maxGenerationCostPerDayUsd`
  cap of **$10/day** (from `docs/runbooks/reel-pipeline.md`'s guardrail
  table — not re-read from a live `autonomy_policy_versions` row this run,
  since that would be a live prod-DB read this session did not make).
- **If** rendered on `template_stock`: **$0**, but see §5's caveat — the
  output would not visually match the storyboard.
- `REEL_FALLBACK_TO_TEMPLATE_STOCK` governs automatic paid→free degrade
  mid-job; not relevant here since no job was created.
- Actual live balance (`getHiggsfieldAccountHealth().balanceCredits`):
  **UNKNOWN** — not queried this run (§1).

## 7 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, not new).
This pack does not name a specific track. If a music bed is added at
assembly, it must be sourced and logged (asset ID, license scope,
territory, expiry, organic-vs-ad clearance) before use — treat as
**BLOCKED** until that ledger entry exists, not as cleared by omission.

## 8 · QA matrix

Nothing was rendered this run, so every render-dependent gate is **NOT RUN**
— not `PASS`, because no field read (job row, gate return, `ffprobe` output)
exists to back a `PASS`:

| Gate | Status | Basis |
|---|---|---|
| Render-integrity gate (#800/#801: duration, frame count, motion-proof MD5s) | **NOT RUN** | no rendered file exists |
| `renderedQa.ts` vision critic | **NOT RUN** | no frames to sample |
| `repairRouter.ts` | **N/A** | no job to repair |
| `qualityAutomation.ts` 7-way decision | **NOT RUN** | no critic verdict to fold |
| `qualityGate.ts` (`evaluateReelPublishGate`) | **NOT RUN** | this is the one gate every autonomous publish door consults; absence of a run is not evidence of a pass |
| `calculateReelQualityScore()` (75-pt brief gate, min 70) | **NOT SCORED** | would require running the brief through `content.generateReelBrief`'s actual scorer; hand-estimating a number here would be exactly the "invented receipt" this skill exists to prevent, so it is omitted rather than guessed |

## 9 · Posting copy

**Primary caption (SEND-oriented, per the corrected objective in
`REEL-SLATE-2026-07-31.md` — reels earn discovery through watch time and
sends, not saves; a "save" CTA belongs to reference formats):**

> That bump on your tire's sidewall is not a flat. It's a break in the steel
> belt underneath, and every mile flexes it a little more.
>
> A tread puncture can often be patched. A sidewall bulge cannot — and at
> highway speed and heat, it can let go all at once.
>
> Send this to someone whose tire has a bump like this.
>
> #tiresafety #cartips #clevelandohio #euclidohio

**Ad-ready variant A (hook-forward, for a paid test):**
- Hook: "This bump on your tire is not a flat."
- Caption: "It's a break in the steel belt underneath — and it gets worse
  every mile. Tread punctures can often be patched. Sidewall bulges can't.
  Not sure what you're looking at? Stop by and we'll take a look."
- CTA: Soft, in-caption only ("stop by") — no button-level guarantee or
  price claim, consistent with the claim-safety bank in
  `facelessReelStudio.ts`.

**Ad-ready variant B (contrast-forward):**
- Hook: "One of these you can patch. One of these you can't."
- Caption: "A nail in the tread — usually fine. A bulge in the sidewall — a
  break in the steel belt that can let go at highway speed. Pull over, don't
  drive slower and hope. Send this to someone who needs to see it."
- CTA: Send-to-a-friend, same as primary.

Both variants avoid every pattern in `CLAIM_SAFETY_PATTERNS` /
`OVERDIAGNOSIS_PATTERNS` (`facelessReelStudio.ts`) — no "you need," no
guaranteed timing, no price, no manufactured urgency language, and the
diagnostic language stays inside the approved soft list (`can`, `may
indicate`-equivalent framing; nothing declares the viewer's tire bad from a
reel).

## Final status

**READY FOR HUMAN APPROVAL.**

Not `PRODUCTION-READY` in the sense of "render this and it's done" — the
free lane's visuals do not match the storyboard (§5) and the paid lane needs
a live spend authorization this run does not have. Not `BLOCKED`, because a
complete, claim-safe, correctly-shaped pack exists and can go straight into
`PRODUCTION`/`DRAFT` mode the moment an operator gives a live instruction to
generate. Not `PUBLISHED WITH READ-BACK` — no `igPostId` or permalink exists
because nothing was generated, assembled, or published this run.
