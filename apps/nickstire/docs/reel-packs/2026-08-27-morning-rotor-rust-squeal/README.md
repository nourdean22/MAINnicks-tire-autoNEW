# Reel pack — "grinding/squealing brakes, but only the FIRST stop of the day"

Scheduled run (no live operator present). Mode: **INTELLIGENCE / production-ready pack** —
per `.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, this run made **zero**
live calls to `/api/admin/reel-canary`, `higgsfieldStudio.ts`, or `reelVoice.ts`, and read
**zero** rows from the production TiDB database. Nothing here has been generated, rendered,
scored by the server, or spent against the generation ledger. This is a hand-authored pack
for a human to run through the real pipeline.

## Backlog check (done before writing anything)

- `ls apps/nickstire/docs/reel-packs/` — 128 topic dirs, 2026-08-14 through 2026-08-27.
  No existing pack covers this angle. Closest neighbors and why this is distinct:
  `squealing-vs-grinding-brakes` (pad-wear indicator vs. metal-on-metal, not
  time-of-day-dependent), `warped-rotor-brake-shake` (vibration/pulsation, not noise),
  `brake-fluid-moisture-test` / `spongy-brake-pedal` / `brake-pedal-sinks-overnight`
  (pedal feel, not rotor noise), `road-salt-brake-lines` (line corrosion, not rotor
  surface rust).
- `gh`-equivalent (`search_pull_requests`) for open `reel pack` PRs: **2 open**
  (#1932 engine pinging/knocking, #1927 steering wheel vibration at highway speed) —
  down from the 22 open PRs the 2026-08-27 11:30 status note flagged as stuck. The
  backlog is being worked down; this run adds one new pack rather than another status
  note. Neither open PR overlaps this topic.

## 1. Capabilities and repetition context (read-only, static code only)

No live health check, env read, or DB query was made — this session has no production
credentials or DB access, and the hard rule bars a "just checking" live call from an
unattended run. Everything below is from committed source/docs, not a live probe:

- `docs/operations/REEL-PIPELINE.md`: `REEL_VIDEO_PROVIDER` is documented as pinned to
  `template_stock` in prod (verified 2026-08-11 per that doc) — the paid Higgsfield lane
  was dropped, so real rendering today would use the free local-ffmpeg lane, which the doc
  notes is **not draft-first**.
  `REEL_GENERATION_ENABLED` / `REEL_PUBLISH_ENABLED` current live values: **UNKNOWN** — no
  Railway env access from this session.
- `getHiggsfieldAccountHealth()` result: **UNKNOWN** — not called (live prod probe, skipped
  by policy for an unattended run even though the skill marks it read-only).
- `generationLedger.ts` `COST_ESTIMATES_USD`: `template_stock_clip: 0`, `seedance_clip: 0.25`
  (labeled ASSUMPTION in source), `veo_second_720p: 0.10` (Google-published). Since prod is
  pinned to `template_stock`, an actual render of this pack would book **$0.00** in video
  cost against `maxGenerationCostPerDayUsd`, plus whatever `elevenlabs_vo` ($0.05) or
  `gemini_brief` ($0.01) the brief-compile step incurs — those still require a live
  `reel-canary` call this run did not make.
- Repetition ledger (`getRecentReelSignals`, `reel_jobs` table): **UNKNOWN** — requires a
  prod DB read, not attempted. Directory + open-PR check above is the best available
  substitute for this run.

## 2. Candidate concepts (scored 0–5 per dimension, self-assessed against
   `calculateReelQualityScore` in `client/src/lib/facelessReelStudio.ts` — NOT re-run
   server-side; a real score requires the live enqueue re-check)

| Concept | Scroll-stop | Sourced-fact | Faceless fit | Claim safety | Notes |
|---|---|---|---|---|---|
| **Selected:** morning rotor rust → first-stop grinding | 4 | 2 | 5 | 5 | Strong visual hook (frosty car, rotor close-up), but the core claim is general auto knowledge, not a `businessFacts`/`EvidenceRecord` citation — see §3 |
| Parked: "why does my exhaust smell different after rain" | 3 | 2 | 4 | 4 | Weaker visual hook, similar evidence gap; held back for a future run |
| Parked: "coolant reservoir level: cold vs hot" | 3 | 3 | 5 | 5 | Solid but close to `radiator-cap-pressure-test` already in the backlog; held back |

Selected concept wins on scroll-stop (visible frost/rust, immediate relatable friction) and
is verifiably NOT a duplicate of any existing pack (see backlog check above).

## 3. Claim evidence

- **No `EvidenceRecord` exists** for "rotor surface rust causes first-stop brake noise that
  clears after a few pedal applications" — checked `evidenceResolver.ts` /
  `evidenceRecords.ts` directly, zero matches for `rust`/`rotor`/`brake`. This is general
  automotive-safety knowledge (rust film forms on exposed cast-iron rotor faces from
  humidity/rain overnight and is abraded off by the pads on first use), not a
  business-specific or sourced fact — scripted accordingly with soft, non-diagnostic
  language and explicitly flagged as `UNKNOWN` provenance rather than invented as sourced.
- **No `businessFacts` row was used.** `FactChannel` is `"sms" | "voice" | "web"` only —
  there is no `"reel"` channel yet, so nothing in `SEED_FACTS` is cleared for this pack's
  channel. The CTA below uses only the public brand name, no price/hours/policy claim.
- Approved soft-diagnostic phrasing used verbatim from `SOFT_DIAGNOSTIC_ALLOWED`
  (`facelessReelStudio.ts:579-586`): "can point to," "worth checking," "one clue," "do not
  guess," "stop by and we'll take a look." No forbidden patterns
  (`no-this-means-bad`, `no-definitely-need`, `no-your-x-is-broken`, `no-you-need`,
  `no-unsafe-scare`, `no-sameday-guarantee`, `no-stock-claims`, `no-fake-urgency`) appear
  in the script below — checked by hand against `OVERDIAGNOSIS_PATTERNS` /
  `CLAIM_SAFETY_PATTERNS` regexes in the same file.

## 4. Script (word-for-word, timed)

Faceless. Muted-first: every line is an on-screen caption; a voiceover is optional
sweetening, not load-bearing. Total runtime target: **26s of beats + 3s SAVE freeze = 29s**
(inside the 15–60s spec range and matching `reelAssembly.ts`'s
`videoTotal = beats + SAVE_FREEZE_SECONDS` contract).

| Beat | Time | On-screen caption (verbatim) | Visual |
|---|---|---|---|
| 1 — Hook | 0:00–0:04 | GRINDING BRAKES — but only the FIRST stop of the day? | Static shot, frosty/dew-covered car in a driveway at dawn, breath-fog in frame |
| 2 | 0:04–0:09 | If your car sat overnight — or in the rain — this can point to something on the rotor, not the pads | Slow push-in on a wheel/rotor edge visible through the spokes, dew beads visible |
| 3 | 0:09–0:15 | A thin layer of surface rust can form on the rotor face. It's one clue, not a verdict | Macro/close-up of a rotor face (product shot, no hands, no people) with a faint reddish-brown sheen |
| 4 | 0:15–0:20 | It usually wipes off within the first few stops of the drive | Car pulling away from a static frame, motion blur on the wheel |
| 5 | 0:20–0:26 | Still grinding after that? Worth checking. Do not guess — stop by and we'll take a look | Exterior static shot of the shop signage/storefront (daytime, no people) |
| SAVE freeze | 0:26–0:29 | SAVE THIS \| DM "BRAKES" | Beat 5's final frame held 3s per `SAVE_FREEZE_SECONDS`, "SAVE THIS" overlay top-of-frame per `reelAssembly.ts:768` |

No dialogue/VO script beyond the captions above — this concept is caption-only by design
(muted-first scoring dimension), so no separate word-for-word narration track is needed. If
a VO pass is added later, read the captions verbatim at a measured pace — do not paraphrase,
since the claim-safety wording was chosen deliberately.

## 5. Per-beat generation prompts (Higgsfield-style, for whichever motion route is
   actually armed when a human runs this)

Standing negative prompt for every beat (per skill spec):
`faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. "Wide static shot, a sedan parked in a residential driveway at dawn, light frost and dew
   on the windshield and body panels, cold blue-hour lighting, visible breath-fog in the
   air, no people, photorealistic, vertical 9:16 framing."
2. "Slow push-in camera move toward a car's front wheel, alloy rim, dew beads visible on the
   rim and tire sidewall, shallow depth of field, overcast morning light, no people,
   photorealistic, vertical 9:16 framing."
3. "Macro close-up of an automotive brake rotor face mounted on a wheel hub, faint reddish-
   brown surface rust film across the braking surface, cool grey garage lighting, product-
   photography style, no people, no hands, vertical 9:16 framing."
4. "Rear three-quarter shot of a sedan pulling away from a stationary position on a
   residential street, motion blur on the wheels, morning light, no people visible in or
   near the vehicle, photorealistic, vertical 9:16 framing."
5. "Static daytime exterior shot of a small independent tire and auto repair shop storefront,
   clean signage, bay doors, parked customer cars, no people in frame, photorealistic,
   vertical 9:16 framing."

Continuity note: per `REEL_IMAGE_CONDITIONING`, beat 1's screened final frame should be
passed as `--start-image` to beats 2–4 so the same vehicle/environment carries through —
this pack assumes whoever renders it wires that the normal way the pipeline already does.

## 6. Assembly instructions (ffmpeg/CapCut), matching the render-integrity gate

The real gate (`reelAssembly.ts` "#800/#801") checks, on the RENDERED FILE, not the brief:

- Container duration within 0.75s of `beats total + 3s` (29s here).
- Video-stream duration (not just container/audio) within the same tolerance — a render
  whose video track ends early but whose audio track pads it out will fail this even if
  the container duration looks right.
- ≥80% of the expected 30fps frame count for the full duration.
- ≥3 distinct MD5 hashes among 5 sampled frames — i.e., real motion, not a still image
  looping.

To satisfy this by hand in CapCut or ffmpeg:

1. Normalize each of the 5 beat clips to vertical (1080×1920), 30fps, trimmed to the beat
   durations in the table above (4s / 5s / 6s / 5s / 6s = 26s total).
2. Concatenate beats 1→5 in order, no crossfade longer than ~0.2s (hard cuts read cleaner
   for this hook style).
3. Burn in captions per beat using the exact verbatim text in §4 — bottom-third safe area,
   high-contrast bold sans, muted-first legibility (must read with sound off).
4. Freeze beat 5's final frame for exactly 3 additional seconds (`tpad=stop_mode=clone:
   stop_duration=3` in ffmpeg terms), and overlay `SAVE THIS | DM "BRAKES"` top-of-frame
   only during that 3s freeze window so it never collides with the beat 5 caption.
5. Confirm final export is 29s ±0.75s, 30fps throughout (including the freeze — clone-pad,
   not a single held frame, so the frame-count check still passes), and that at least 3 of
   5 sampled frames differ (i.e., don't render the freeze as a literal single static PNG
   loop with no encoder motion — clone-padding a real video frame satisfies this; a plain
   still image does not).

## 7. Credit-risk and fallback routing

- If a human runs this through the real `reel-canary` pipeline with `REEL_VIDEO_PROVIDER`
  still pinned to `template_stock`: **$0.00** video cost (free local-ffmpeg lane, per
  `generationLedger.ts`), degrading further only via `REEL_FALLBACK_TO_TEMPLATE_STOCK`
  if some other provider were pinned instead.
  If run through Higgsfield/Seedance instead: ~$0.25/clip × 5 beats ≈ **$1.25** (the source's
  own ASSUMPTION-labeled estimate, not a metered price).
  Add ElevenLabs VO ($0.05) and brief-compile ($0.01) if those steps run: **≈$0.06** on top.
- Today's `RESERVATION_FEED_CAP` (2 posts/day), `RESERVATION_SPACING` (3h), `REPEAT_TOPIC`
  (7 days), and `maxGenerationCostPerDayUsd` limits: **UNKNOWN** — read from
  `autonomy_policy_versions`, a live DB table not queried this run. A human running this
  pack should check that table before enqueueing.

## 8. Audio / music rights

**No rights ledger for music exists in this repo** — confirmed gap per the operator skill.
This pack is captions-only with no music bed specified; if a human adds one, they must
independently confirm license scope/territory/expiry before publishing to any channel,
organic or paid. Treat this field as `BLOCKED` until that ledger exists or a human attaches
a cleared track by hand.

## 9. QA matrix (this run — no render exists yet, so most gates are `BLOCKED: not run`)

| Gate | Status | Basis |
|---|---|---|
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED: not run` | no render exists |
| Repair routing (`repairRouter.ts`) | `BLOCKED: not run` | no render exists |
| 7-way automation decision (`qualityAutomation.ts`) | `BLOCKED: not run` | no job exists |
| Consolidated publish gate (`qualityGate.ts`) | `BLOCKED: not run` | no job exists |
| Client-side quality score (`calculateReelQualityScore`) | `UNKNOWN` — self-assessed only, see §2 table | not executed against real function, hand-estimated |
| Server re-score at enqueue | `BLOCKED: not run` | no enqueue call made (policy) |
| Claim-safety regex sweep (`CLAIM_SAFETY_PATTERNS`/`OVERDIAGNOSIS_PATTERNS`) | `PASS` (manual) | hand-checked script text against every listed regex in `facelessReelStudio.ts:540-563`; none match |
| Render-integrity gate (duration/frames/motion) | `BLOCKED: not run` | no render exists; §6 gives the human the exact contract to hit |

## 10. IG/FB copy + two ad-ready variants

**Organic caption (IG/FB):**
> Cold morning, first brake of the day sounds a little rough? Might just be surface rust on
> the rotor — one clue, not a verdict. Save this so you remember what to check before you
> assume the worst. 🔧
> #NicksTireAndAuto #Euclid #Cleveland #BrakeCare #CarMaintenanceTips #AutoRepair

**Ad variant A** (hook-forward):
- Hook: "Your brakes aren't broken — they're just cold."
- Caption: "Surface rust on a rotor can cause a rough first stop after sitting overnight or
  in the rain. It's usually gone in a few pedal presses. Still grinding after that? Worth a
  look."
- CTA: "DM 'BRAKES' or stop by Nick's Tire & Auto — Euclid Ave, Cleveland."

**Ad variant B** (question-forward):
- Hook: "Why do my brakes grind ONCE, then go quiet?"
- Caption: "It's one of the most common 'is something wrong with my car' questions we get.
  Usually: surface rust, not a real problem. But we'd rather you ask than guess."
- CTA: "Save this. Questions? Stop by — we'll take a look, no pressure."

## 11. Final status

**READY FOR HUMAN APPROVAL.** No generation, spend, DB write, or publish action was taken.
A human operator with live pipeline access should: confirm current
`REEL_GENERATION_ENABLED`/`REEL_VIDEO_PROVIDER`/policy-limit values, run this brief through
`reel-canary` `{action:"start"}` → `{action:"advance"}` → `{action:"qa"}`, and only then
decide on `{action:"publish"}` — never inferred from this pack alone.

---
_Generated by [Claude Code](https://claude.ai/code)_
