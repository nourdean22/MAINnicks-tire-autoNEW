# Reel Pack — "Light's Off Doesn't Mean You'll Pass" (Ohio E-Check Readiness Monitors)

Produced by an automated scheduled run (2026-08-20) via `nickstire-reel-operator`, mode
**INTELLIGENCE/SCHEDULED**. No live operator instruction was present for this run, so per the
skill's hard rule and root `AGENTS.md`'s protected-operations list, **no real generation, spend,
or publish action was taken** — this is a text production pack only. Nothing below should be read
as "rendered" or "posted."

## 1. Mode, timestamp, connected capabilities

- **Mode:** INTELLIGENCE/SCHEDULED (never PUBLISH — a scheduled firing has no live operator to
  authorize a customer-facing side effect, per `AGENTS.md` "Protected operations").
- **Timestamp:** 2026-08-20, automated cron firing.
- **Connected capabilities — checked, not assumed:**
  - `getHiggsfieldAccountHealth()` — **NOT CALLED.** This session has no path to the running
    server or its admin API (no `ADMIN_API_KEY`, no reachable `/api/admin/reel-canary`); the
    session shell has zero Higgsfield/`REEL_*`/`DATABASE_URL` env vars (`env | grep` confirmed
    empty). Higgsfield credential status: **UNKNOWN**.
  - `REEL_VIDEO_PROVIDER` — not read live. Per `apps/nickstire/docs/operations/REEL-PIPELINE.md`
    (verified 2026-08-11, the doc's own claim), **prod is pinned to `template_stock`**, i.e. the
    free local-ffmpeg lane, not Higgsfield/Seedance. Treat "Higgsfield" as **not the active route**
    unless an operator confirms the pin changed.
  - `REEL_GENERATION_ENABLED` — **UNKNOWN** (no live read).
  - ChatGPT/LLM script-drafting — this pack's script was authored directly in this session, not
    via a separate LLM call.
  - TTS (ElevenLabs) — **not available**; no voice was generated. Script below is written to be
    self-teaching via on-screen text (muted-first, per the repo's own quality gate), with VO
    treated as optional and unproduced.
  - Meta/Instagram posting — **not available** and not attempted; this is a PUBLISH-gated action
    the hard rule blocks for any non-live, scheduled run regardless of tool availability.
  - Shell/render (ffmpeg) — a shell is available, but there is no source footage to assemble (no
    Higgsfield clips were generated), so no render was attempted. Fabricating a file from nothing
    would violate "do not claim a finished file exists unless you have rendered it."
  - CapCut — not available in this environment; assembly instructions below are written so a human
    can execute them in CapCut, Premiere, or ffmpeg directly.
- **Repetition-ledger context:** `getRecentReelSignals()` (reads prod `reel_jobs`) was **NOT
  CALLED** — no live DB access from this session, and root `AGENTS.md` explicitly forbids treating
  a `.env`/worktree DB binding as safe to hit "just to check." As a substitute, this session read
  the real, merged evidence available locally: the 36 merged packs in
  `apps/nickstire/docs/reel-packs/` and the 8 currently-open draft PRs (`gh`-equivalent via the
  GitHub MCP `search_pull_requests`/`list_pull_requests` tools, both checked — the skill's own
  incident log shows why checking only the directory is insufficient). None of the 44 covered
  topics is E-Check/readiness-monitors, so this concept is not a duplicate of merged OR in-flight
  work as of this run. (This is a proxy for the real repetition ledger, not the ledger itself —
  flagged as a gap below, not silently treated as equivalent.)

## 2. Candidate concept — scores and selection

One concept was developed and selected (single-concept run; no tournament was run against
competing concepts, since that requires the live critic-panel machinery this session can't reach).

**Concept: "Readiness Monitors" (myth_buster / ECHECK)**

| Dimension | Score /10 | Why |
|---|---|---|
| Hook | 8 | Calm, unlit dashboard is a familiar, low-stakes opener; the "right?" cliffhanger earns the next beat |
| Truth | 9 | Grounded in the actual OBD-II readiness-monitor mechanism behind Ohio E-Check rejections — not a fabricated shop stat |
| Save | 8 | Directly answers "why did I fail E-Check with no light on" — a real, googleable driver confusion |
| Local | 9 | E-Check is a Cuyahoga-County-and-six-neighbors-only requirement tied to vehicle registration; this is about as Cleveland-specific as a claim gets |
| Absurdity | 6 | Modest — "glowing dashboard inhabitants" carries some useful-absurdity, but the concept leans informational over playful |
| Fit | 8 | Directly serviceable at Nick's (pre-E-Check scan), no overreach into unrelated repairs |

**Total: 48/60** — below the repo's `STUDIO_DEFAULTS.conceptMinScore` (57/60) bar used by the live
Studio's concept tournament. Reported honestly rather than inflated: a single hand-authored
concept without a competing pool and without the live LLM critic panel is not expected to clear a
bar designed for a multi-concept tournament. This is the concept selected because it's the only one
produced this run, not because it cleared the tournament bar — flag this to the operator before
treating it as "tournament-approved."

**Parked concepts:** none — single-concept run, no alternates generated.

## 3. Claim evidence

`businessFacts.ts`/`evidenceResolver.ts` were **not queried live** (no DB access). Brand facts
below are taken from the git-versioned `STUDIO_BRAND` constant in
`apps/nickstire/client/src/lib/facelessReelStudio.ts` (source-of-truth tier 3, current schema —
not a live DB read, but not invented either):

- Name: Nick's Tire & Auto · Handle: `@nicks_tire_euclid` · Site: nickstire.org
- Address: 17625 Euclid Ave, Cleveland, OH 44112 · Phone: (216) 862-0005
- Reputation: 4.9-star, 1,685+ Google reviews · ASE-certified service capability

**Mechanic-truth claim and its sources (labels only, per `SourceNote` — no live URL fetch was
run):**

| Claim | Source | Kind | Entailment |
|---|---|---|---|
| Ohio's E-Check emissions test (Cuyahoga + six neighboring NE Ohio counties) can reject a vehicle for incomplete OBD-II readiness monitors, independent of whether the check-engine light (MIL) is illuminated | Ohio EPA E-Check program public FAQ | proof | **not_evaluated** — this session has no live `evidenceResolver.ts`/`EvidenceRecord` read-back; treat as UNKNOWN-until-verified, not as a cleared `EvidenceRecord` |
| Readiness monitors reset to "Not Ready" after a battery disconnect, cleared trouble code, or ECU replacement, and require completed drive cycles to re-set | General OBD-II/SAE J1979 monitor-completion behavior (standard, publicly documented, non-shop-specific) | proof | **not_evaluated** — same caveat |

**Explicit UNKNOWNs (not omitted):**
- No live `EvidenceRecord.entailment` verdict exists for either claim in this run — both are
  provenance-only (a source label, not a resolver-confirmed quotable statement).
- `businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only — there is **no
  `"reel"`/`"social"` channel**, so even the brand facts above are not channel-cleared for reel use
  by that store; they're read from the git-versioned constant as the closest available
  source-of-truth, and that substitution is disclosed here rather than hidden.
- Local/weather/event currency (e.g., "E-Check season is now") — **UNKNOWN**, omitted from the
  script entirely per the skill's own rule.

No price, warranty, guarantee, or fabricated first-person shop-statistic claims appear anywhere in
this pack (checked by hand against `FORBIDDEN_CLAIM_PATTERNS`, `OVERDIAGNOSIS_PATTERNS`,
`FEARMONGER_PATTERNS`, `GENERIC_MARKETING_PATTERNS`, `PRICE_CLAIM_PATTERN`, and
`FABRICATED_STAT_PATTERN` in `facelessReelStudio.ts` — hand-checked, not run through the live
validator functions, since that requires a build step this pack doesn't warrant on its own).

## 4. Production pack

### Format contract (repo's real render-integrity gate, not the generic 15–60s ask)

`apps/nickstire/client/src/lib/facelessReelStudio.ts`'s `REEL_OUTPUT_RULES` and the render-integrity
gate in `reelAssembly.ts` define the actual enforced contract: 1080×1920, H.264 MP4, yuv420p, 30fps,
faststart, 4–6 beats, **15–22s total** (beats + a 3s SAVE freeze), faceless. This pack targets that
stricter contract rather than the scheduling prompt's looser 15–60s, since the repo's own render
gate is what a real render would actually be checked against.

**Beats: 5 (0–17s) + 3s SAVE/CTA freeze = 20s total.**

| # | 0:00–0:03 | Beat 1 |
|---|---|---|
| Visual | A dark car dashboard interior at idle, calm, no warning lights lit anywhere on the cluster |
| Motion | Slow static hold, no camera movement — deliberate stillness to sell "everything looks fine" |
| On-screen text | `NO LIGHT. NO WORRIES... RIGHT?` |
| Purpose | Hook — the familiar, false-safe moment every driver recognizes |
| Audio cue | Low ambient engine idle hum, no music yet (works muted regardless) |
| Safe-zone | Text centered, kept clear of the top ~250px (IG username/actions) and bottom ~200px (caption/UI) |

| # | 0:03–0:06 | Beat 2 |
|---|---|---|
| Visual | Push into the dashboard's dark interior; small dim indicator-light "inhabitants" become visible, mostly unlit, scattered like a tiny glowing-light diorama inside the dash |
| Motion | Slow macro push-in, camera moving deeper into the dashboard world |
| On-screen text | `OHIO E-CHECK CHECKS SOMETHING YOU CAN'T SEE` |
| Purpose | Reveal the hidden mechanism — readiness monitors, described visually not verbally |
| Audio cue | A soft rising synth tone as the reveal happens |
| Safe-zone | Same margins as beat 1 |

| # | 0:06–0:10 | Beat 3 |
|---|---|---|
| Visual | A sweeping scan-line of light passes left to right across the small indicator lights; most flip from dim to lit amber as the sweep passes, one stays stubbornly dark |
| Motion | Horizontal scan-line sweep, otherwise locked-off camera |
| On-screen text | `"READINESS MONITORS." RESET = "NOT READY."` |
| Purpose | Teach the mechanism: monitors reset after a disconnect/code-clear and need to re-complete |
| Audio cue | A soft mechanical scan/sweep sfx |
| Safe-zone | Same margins |

| # | 0:10–0:14 | Beat 4 |
|---|---|---|
| Visual | Split composition: left half shows the calm, all-dark dashboard from beat 1; right half shows the one still-dark indicator light glowing a dim warning amber against the same dark field |
| Motion | Static split hold, a slow subtle pulse on the right-side unlit light only |
| On-screen text | `LIGHT OFF DOESN'T MEAN READY FOR THE TEST` |
| Purpose | Myth vs. reality turn — the moment the belief gets corrected |
| Audio cue | A single low tension note |
| Safe-zone | Text kept in the vertical center gutter between the two split halves |

| # | 0:14–0:17 | Beat 5 |
|---|---|---|
| Visual | The last dark indicator light finally lights up amber; the frame pulls back out to the same wide, calm dashboard composition as beat 1's opening frame, now fully lit |
| Motion | Slow pull-back, mirroring beat 2's push-in in reverse — this is the loop seam |
| On-screen text | `DRIVE IT. LET THE MONITORS FINISH. THEN TEST.` |
| Purpose | Resolution + the loop: last frame visually rhymes with beat 1's opening frame so a replay reads as continuous |
| Audio cue | Ambient hum returns, matching beat 1 — reinforces the loop on repeat |
| Safe-zone | Same margins as beat 1 |

**Loop idea:** beat 5's fully-lit wide dashboard shot is framed and lit to match beat 1's opening
frame almost exactly (same composition, same push distance) so the reel visually breathes back into
its own start on repeat — the only difference is "unlit" became "lit."

**SAVE/CTA freeze (0:17–0:20, appended by ffmpeg, not generated):** solid `#0A0A0A` background
card, `#FDB913` accent rule, static (no motion — this is the mandatory 3s freeze the render-integrity
gate checks for). Overlay text (ffmpeg `drawtext`, never asked of the video model):
`CUYAHOGA E-CHECK QUESTIONS? STOP BY AND WE'LL TAKE A LOOK.` + `nickstire.org` + `(216) 862-0005`.

### Per-beat generation prompts (Higgsfield-style — for whenever a live motion route exists)

**Motion lens: Dashboard Warning-Light World** (`warning_light_world` in `facelessReelStudio.ts`) —
grammar: *"Inside a dark dashboard interior world, glowing indicator lights as inhabitants, deep
blacks with amber and red bokeh glow, macro perspective."* Avoid: *daylight exterior, flat even
lighting.*

**Standing negative prompt, every beat** (per the skill's own instruction for a pack with no live
motion route): `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

| Beat | Prompt | Additional negative (lens-specific) |
|---|---|---|
| 1 | Dark car dashboard interior at night, deep black field, all indicator lights unlit, calm and still, macro perspective, cinematic ambient glow, no camera movement | daylight exterior, flat even lighting |
| 2 | Slow macro push-in through a dark dashboard interior, small dim indicator lights scattered like distant embers, deep blacks with amber bokeh glow, macro perspective | daylight exterior, flat even lighting, legible gauge numerals |
| 3 | Inside a dark dashboard world, a horizontal sweep of soft light passing across a field of small round indicator lights, most flipping from dim grey to glowing amber, one remaining unlit, deep black background, macro perspective | daylight exterior, flat even lighting, legible readout text, screen displaying characters |
| 4 | Split-frame composition, left half a calm all-dark dashboard interior, right half a single dim indicator light pulsing a low amber glow against deep black, symmetrical macro perspective | daylight exterior, flat even lighting, legible text or numerals on either half |
| 5 | Slow pull-back through a dark dashboard interior as the last indicator light turns amber, revealing a wide, fully-lit, warm-glowing field of small indicator lights against deep black, macro perspective, mirrors an opening establishing shot | daylight exterior, flat even lighting |

Every beat's visual/motion text was checked by hand against `FACE_SUBJECT_PATTERN` (no
face/hand/limb subject) and `IN_FRAME_TEXT_PATTERN` (no beat asks the generator to render legible
text, logos, gauges, or readouts — "amber glow" and "indicator lights" are physical light sources,
not spelled content) from `facelessReelStudio.ts`. All on-screen teaching text is an ffmpeg overlay
added after generation, never part of the generation prompt itself.

### Assembly instructions (ffmpeg — CapCut equivalent noted per step)

1. **Render or source 5 clips** matching the beat prompts above, each ≥3s, 1080×1920, ≥30fps. *(No
   clips exist yet — this step is the one that requires a live motion route: Higgsfield/Seedance,
   Veo, or the `template_stock` free-ffmpeg-stock lane. Manual work: generate via whichever provider
   `REEL_VIDEO_PROVIDER` is actually pinned to, or hand-pick 5 stock clips matching the visual
   descriptions if using CapCut's stock library.)*
2. Trim each clip to its exact beat duration (3s/3s/4s/4s/3s) — CapCut: drag clip edges on the
   timeline to these exact lengths; ffmpeg: `ffmpeg -i clip.mp4 -t 3 -c copy beat1.mp4` per clip.
3. Concatenate in order via the ffmpeg concat demuxer (`ffmpeg -f concat -safe 0 -i list.txt -c copy
   beats.mp4`) or CapCut's timeline drag-and-drop in beat order.
4. Scale/pad every clip to exactly 1080×1920, `yuv420p`, 30fps, H.264, `-movflags +faststart` —
   ffmpeg: `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" -c:v libx264 -pix_fmt yuv420p -movflags +faststart`.
5. Burn in the on-screen text per beat, timed to each beat's start/end window, using
   `captions.srt` (ffmpeg `subtitles=captions.srt` filter, or CapCut's caption import) — keep text
   inside the safe-zone margins noted per beat.
6. Append the 3s static SAVE/CTA card (a single `#0A0A0A` PNG/frame held for 3s,
   `ffmpeg -loop 1 -t 3 -i savecard.png ...` concatenated after beat 5) with the CTA `drawtext`
   overlay described above.
7. If a voiceover is produced later (TTS not run in this session), mux it as a second audio track
   under an optional music bed — **do not source or mix a music track without resolving the rights
   gap below first.**
8. Export final MP4: 1080×1920, H.264, yuv420p, 30fps, faststart, ~20s total.
9. **Verify before treating as finished** — run `ffprobe` and confirm: container duration within
   0.75s of 20s, video-stream duration (not just container) within 0.75s of 20s, ≥480 frames (80%
   of the 600 expected at 30fps for 20s), and ≥3 distinct MD5s across 5 sampled frames (proves real
   motion, not a static loop). This mirrors the repo's own render-integrity gate (`reelAssembly.ts`
   "#800/#801") — none of these checks have been run in this session because no file exists yet.

### Captions

See `captions.srt` in this directory — timed 1:1 to the beats above.

### IG/FB copy + two ad-ready variants

**Primary caption (organic feed):**
> Light's off on your dash. You still failed E-Check. Here's the part nobody explains: Ohio's
> E-Check doesn't just read your check-engine light — it reads whether your car's own readiness
> monitors finished re-checking themselves after a battery disconnect or a cleared code. No light
> doesn't mean ready. Drive it a bit, let the monitors finish, then test. Cuyahoga E-Check
> questions? Stop by and we'll take a look. #ECHECK

**Ad variant A (hook-forward):**
- Hook: "Your check engine light is off. You still failed E-Check."
- Caption: "It's not a broken part — it's an incomplete readiness monitor. Ohio's E-Check reads
  that too. Let your car finish its own re-check before you test."
- CTA: "Cuyahoga E-Check questions? Stop by and we'll take a look."

**Ad variant B (curiosity-forward):**
- Hook: "There's a check inside your check engine light system."
- Caption: "Readiness monitors reset after a battery disconnect or a cleared code — and Ohio's
  E-Check fails an incomplete one, light on or off."
- CTA: "Stop by and we'll take a look before your E-Check appointment."

**Hashtags (≤5, Instagram's real 2025+ cap — `INSTAGRAM_HASHTAG_CAP` in `facelessReelStudio.ts`):**
`#ECheck #ClevelandDrivers #CarCareTips #NicksTireAndAuto #OhioEmissions`

## 5. Credit-risk and fallback routing

- **Per-clip cost estimate** (`COST_ESTIMATES_USD` in `server/services/generationLedger.ts`,
  operator-tunable, not a metered price): if rendered on the prod-pinned `template_stock` lane, **$0
  marginal cost** (free local ffmpeg, no API call). If a paid route is used instead:
  `seedance_clip: $0.25` (labeled an unverified ASSUMPTION in the source), or Veo at
  `$0.10/second × ~4s/beat × 5 beats ≈ $2.00` (the one Google-published real figure). **This
  session did not reserve, spend, or touch `generationLedger.ts`'s RESERVE/SETTLE flow** — no live
  DB access, and doing so would be a real spend action this scheduled run isn't authorized to take.
- **Today's `maxGenerationCostPerDayUsd` limit and remaining budget: UNKNOWN** — requires a live
  read of the latest `autonomy_policy_versions` row; not read this run.
- **Guardrail exposure if this pack is later enqueued for real:** subject to the real, ordered
  checks in `docs/runbooks/reel-pipeline.md` — `RESERVATION_FEED_CAP` (2 posts/day),
  `RESERVATION_SPACING` (3h), `REPEAT_CTA` (72h), `REPEAT_TOPIC` (7 days), then the daily budget
  cap. None of these were checked live this run; an operator enqueuing this pack should expect
  preflight (M10) to catch a repeat-topic block for free before any spend, per that doc.
- **Fallback routing:** if a paid provider is pinned and hits a terminal verdict,
  `REEL_FALLBACK_TO_TEMPLATE_STOCK` (off by default per that doc) governs whether the job degrades
  to the free lane instead of failing outright — operator should confirm this flag's current state
  before assuming a paid-route failure won't silently downgrade output quality.

## 6. Audio and music rights

**Real gap, not silently dropped:** this repo has **no music-rights ledger**. No asset ID, license
scope, territory, expiry, or organic/ad clearance record exists for any music bed in this codebase.
**Status: BLOCKED.** Do not attach a music track to this reel without first securing and recording
a license through Instagram's in-app licensed audio library (organic-only) or an equivalent
cleared source for paid placement — and without a ledger to record it in, that clearance currently
lives nowhere durable. The reel as designed above is intentionally muted-first (every beat teaches
via on-screen text) so it functions with no music bed at all if this gap isn't closed before
posting.

## 7. QA matrix

| Gate | Verdict | Backing evidence |
|---|---|---|
| Rendered QA / vision critic (`renderedQa.ts`) | **UNKNOWN** | No file was rendered; there is nothing for a vision critic to score |
| Repair routing (`repairRouter.ts`) | **UNKNOWN** | No render attempt occurred, so no repair was ever triggered |
| 7-way automation decision (`qualityAutomation.ts`) | **UNKNOWN** | Requires a real critic verdict + job row, neither exists |
| Consolidated publish gate (`qualityGate.ts` `evaluateReelPublishGate`) | **UNKNOWN** (not `pass`) | Not called — no live server/DB path from this session. Absence of evidence is not evidence of quality: this is reported as `UNKNOWN`, never silently treated as passing |
| Brief-level quality score (`calculateReelQualityScore`, 70/75 min) | **ESTIMATE ≈70/75** (self-computed, not server-verified) | Hand-scored against the documented rubric: hook 10/10, muted-first 10/10, beat structure 5/5, length 5/5, loop 5/5, sourced fact 10/10, faceless+wordless 10/10, claim safety 10/10, keyword 5/5, winning-concept-≥57/60 **0/5** (concept scored 48/60, below the tournament bar — see §2). This is a hand computation against the published rubric, not a run of the actual TypeScript validator, and is reported as an estimate accordingly |
| Render-integrity gate (duration/frame-count/motion-proof, `reelAssembly.ts` #800/#801) | **N/A — no file exists to check** | Cannot be evaluated without a rendered MP4 |
| Faceless/wordless design-time check | **PASS (hand-verified)** | Every beat's visual/motion text checked against `FACE_SUBJECT_PATTERN` and `IN_FRAME_TEXT_PATTERN` in §4 — no match found |
| Claim-safety patterns (forbidden claims, overdiagnosis, fearmongering, price, generic marketing, fabricated stats) | **PASS (hand-verified)** | Script and captions checked by hand against all six pattern banks in `facelessReelStudio.ts` (§3) — no match found |
| Instagram hashtag cap (≤5) | **PASS** | 5 hashtags used, at the cap, not over |

## 8. IG/FB copy + ad variants

See §4 above (primary caption + variants A/B) — not repeated here.

## 9. Final status

**READY FOR HUMAN APPROVAL.**

Not `PRODUCTION-READY` — no file has been rendered, no live quality-gate or render-integrity check
has actually run, and the concept did not clear the tournament concept-score bar (only one concept
was produced, hand-scored 48/60 against a 57/60 bar). Not `BLOCKED` — every checkable-by-hand gate
(claim safety, faceless/wordless, structural contract, sourcing) passed, and a complete, usable
script/prompt/caption/assembly pack was produced with no fabricated evidence. Not `PUBLISHED WITH
READ-BACK` — nothing was published; this was never in scope for a scheduled, non-live-authorized
run.

**What still requires manual/human work:**
1. Generate the 5 beat clips through whichever motion route is actually live (confirm
   `REEL_VIDEO_PROVIDER` first) — **or** render them via CapCut/stock footage matching the visual
   descriptions in §4.
2. Assemble per the ffmpeg/CapCut instructions in §4, step-by-step.
3. Resolve the music-rights gap in §6 before attaching any audio bed (or ship muted-first as
   designed).
4. Run the actual render-integrity and rendered-QA checks against the real output file.
5. An operator must review and explicitly authorize posting — this pack does not self-publish, and
   no cron or scheduled firing may authorize that step per `AGENTS.md`.

