# Reel pack — "One wheel hotter than the others?" (sticking brake caliper)

**Status: PRODUCTION-READY (pack only — no rendered file exists).**
Scheduled run, `.claude/skills/nickstire-reel-operator/SKILL.md`. This session has no
motion-render route, no DB access, and no live operator instruction, so per that skill's
hard rule this pack is the deliverable — not a render, not a publish.

## 1. Mode, timestamp, capability check

- Mode: `PRODUCTION` (pack-only; this is a scheduled/automated firing, so `PUBLISH` is
  out of scope per the skill's hard rule — a stored scheduled prompt never satisfies the
  live-instruction requirement).
- Run timestamp: 2026-08-20 (session clock; exact time not authoritative — see `currentDate` note).
- Capability probe (this session, this container):
  - `which hf higgsfield ffmpeg` → none found.
  - `env | grep -E 'DATABASE_URL|ADMIN_API_KEY|REEL_GENERATION_ENABLED|REEL_VIDEO_PROVIDER|REEL_AUTOPOST_ENABLED|HIGGSFIELD'` → empty. No prod DB, no admin API key, no Higgsfield credentials reachable from here.
  - Consequence: `getHiggsfieldAccountHealth()`, `/api/admin/reel-canary`, `reelRepetitionHistory.ts`'s live DB read, and any publish door are all **UNKNOWN / not reachable from this session** — not "checked and clean." This matches every prior scheduled run of this task; no session invoked by this trigger has ever had a real render or publish path.
- Repetition-ledger context: no live DB read available, so I substituted a manual duplicate
  check against the two real sources of truth the skill names:
  - `ls apps/nickstire/docs/reel-packs/` — 51 merged date-slug directories (2026-08-14
    through 2026-08-20), none titled around brake-caliper drag / one-wheel-hot.
  - `list_pull_requests(state=open)` on this repo — 4 open, all "reel pack: ..." drafts,
    all created today: #1738 (wheel wobble / tie rod vs bearing), #1739 (musty AC smell),
    #1741 (lug-nut re-torque), #1742 (AWD tread-depth matching). No overlap with this topic.
  - **Backlog note, not new information:** the standing `BACKLOG-STATUS-2026-08-20-0900.md`
    in this directory documents this same trigger firing roughly hourly with zero review
    throughput (17 open PRs at 09:00, cleared to 4 by whenever this run fired). 4 is under
    the 5-PR pause threshold that status note set, so this run proceeds — but the underlying
    cadence problem is unresolved and out of this session's control (`CronList`/`CronCreate`
    here are session-local, not the external trigger). Flagging again rather than re-writing
    a full status file, per that note's own recommendation to make a no-op cheap.

## 2. Candidate scores

Only one concept was developed this run (single-topic scheduled pack, not a tournament).
Scored against the skill's real 75-point rubric dimensions (self-scored — the server-side
`calculateReelQualityScore()` re-check does not run in this session):

| Dimension | Weight | Self-score | Why |
|---|---|---|---|
| First-frame scroll-stop | 10 | 8/10 | Wheel/rotor macro with heat-shimmer cue is a visual pattern-interrupt, not a generic car shot |
| Muted-first (captions carry it) | 10 | 10/10 | Every line is short, caption-legible, no audio-only meaning |
| Beat structure | 5 | 5/5 | 6 beats + 3s freeze, matches render-integrity contract shape |
| Length | 5 | 5/5 | 33s, inside 15–60s |
| Loop | 5 | 3/5 | End card doesn't hard-loop to beat 1; acceptable but not optimized |
| Sourced fact | 10 | 7/10 | Mechanic-truth claim (dragging caliper → excess heat/wear) is standard automotive repair knowledge, not pulled from `businessFacts.ts`/`evidenceResolver.ts` (no live DB access this run — see §3) |
| Faceless | 10 | 10/10 | No people/hands in any beat prompt; negative prompt enforced |
| Claim safety | 10 | 10/10 | No price, no guarantee; uses approved soft language only |
| Keyword | 5 | 4/5 | "brake," "caliper," "hot wheel" are searchable repair-intent terms |
| Winning concept ≥57/60 | 5 | n/a | single concept, not a tournament — not scored |
| **Total (of 70 scored)** | | **62/70** | Advisory only — server has not re-scored this |

**Reel not "PASS"** in the sense the skill means it (that requires the real 70/75 server gate)
— this is a self-estimate for pack quality, reported as such.

## 3. Claim evidence

No live read of `evidenceResolver.ts` / `evidenceRecords.ts` / `businessFacts.ts` is possible
from this session (no DB connection). Every factual claim in the script is therefore
`UNKNOWN` against this repo's own evidence store, not verified — flagged explicitly rather
than omitted:

- "A sticking caliper keeps pad pressure on the rotor after brake release, causing drag and
  excess heat on that wheel" — **UNKNOWN (not resolved against `EvidenceRecord`)**. This is
  standard, widely-documented automotive repair knowledge (dragging/sticking caliper as a
  cause of one-wheel overheating, uneven pad wear, and vehicle pull), but it has no
  `snapshotHash`/`entailment` verdict from this repo's evidence pipeline in this run.
- "Excess drag from a stuck caliper can accelerate rotor wear" — **UNKNOWN**, same reason.
- No price, warranty, hours, or local/weather claim is made anywhere in the script — so
  `businessFacts.ts` channel-scoping gap (no `"reel"` channel yet) doesn't block this pack,
  but is worth restating: it still has no reel-channel clearance path today.
- Recommendation: before this pack is used to generate/publish anything, a session with real
  evidence-store access should resolve the two claims above to at least `"supported"` or
  attach the qualifier language already present in the script ("can point to," not "is").

## 4. Production pack

### Concept
**Hook:** "One wheel hotter than the others after a short drive?" — a sticking brake
caliper is one of the mechanically plausible reasons, explained without diagnosing anything
specific to a viewer's car.

### Script — word-for-word, timed

| Beat | Time | Narration (read at natural pace, ~2.3 words/sec) |
|---|---|---|
| 1 | 0:00–0:04 | "One wheel hotter than the others after a short drive?" |
| 2 | 0:04–0:09 | "That's not always the brakes working hard. It can point to a caliper that's sticking." |
| 3 | 0:09–0:14 | "A stuck caliper keeps squeezing the pad against the rotor, even after you let off the brake." |
| 4 | 0:14–0:19 | "That drag builds heat, and it's one clue behind a car that pulls to one side." |
| 5 | 0:19–0:24 | "Don't guess by touch alone. A hot wheel is a sign, not a diagnosis." |
| 6 | 0:24–0:29 | "Worth checking before your next long drive." |
| 7 (freeze/CTA) | 0:29–0:33 | "Stop by and we'll take a look. Nick's Tire & Auto." |

Total runtime: **33 seconds** (30s of beats + 3s SAVE freeze, matching the render-integrity
gate's storyboard contract of beats + 3s freeze).

### Per-beat visual generation prompts (Higgsfield/Seedance-style)

Standing negative prompt for every beat (per skill spec):
`faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — "Close-up macro shot of a car's front wheel and brake rotor through the
   spokes, parked in bright daylight, shallow depth of field, subtle heat-shimmer distortion
   rising off the rotor surface, cinematic automotive photography, no people."
2. **0:04–0:09** — "Slow push-in on a brake caliper and rotor assembly seen through alloy
   wheel spokes, brushed metal and glinting highlights, moody garage side-lighting, no people."
3. **0:09–0:14** — "Macro shot of a brake caliper piston and pad area, dust and brake material
   texture visible, dramatic raking light, mechanical detail, no people."
4. **0:14–0:19** — "Wide tracking shot of a car driving away down a residential street, wheel
   and rotor in soft foreground blur, background motion blur, no readable plate, no people."
5. **0:19–0:24** — "Close dolly shot across a worn rotor surface showing heat-discoloration
   and light scoring, blurred shop background, industrial lighting, no people."
6. **0:24–0:29** — "Wide establishing shot of a tire-shop service bay interior, warm inviting
   lighting, tools and lift visible, no readable signage, no people."
7. **0:29–0:33 (freeze/end card)** — Still frame held from beat 6's final frame; CTA text and
   logo are composited in post (see Editing, below), not generated into the clip.

### Fallback stock-footage search terms (no generation route available)

If sourcing from a stock library (Pexels/Storyblocks/Artgrid) instead of generation:
"car wheel close up daylight," "brake rotor caliper macro," "mechanic tool brake pad
close up (no hands/face in frame)," "car driving away residential street," "auto repair
shop bay interior wide."

### Captions / SRT

See `captions.srt` in this directory — timings match the script table above exactly.

### Editing / assembly instructions (CapCut or ffmpeg-equivalent)

1. **Base video track:** beats 1–6 as hard cuts (no crossfade) at the timestamps above;
   beat 6's last frame held static for the 3s freeze (0:29–0:33).
2. **Overlay track (beat 1 only):** heat-shimmer/distortion effect, low opacity, confined to
   the rotor area — optional if not present in the generated/stock clip already.
3. **Audio track 1 (voiceover):** single continuous VO reading the script above,
   loudness-normalized to **-14 LUFS**, no music ducking needed if music bed is kept low.
4. **Audio track 2 (music bed):** see Audio/rights gap in §6 — do not select a specific
   track without operator/license clearance. Genre guidance: light, tense-but-not-scary
   percussive underscore, ~90–110 BPM, ducked under VO.
5. **Caption burn-in:** bold sans-serif, white fill + black stroke/shadow, bottom-third safe
   area, one line at a time, timed to `captions.srt`. Must remain legible with sound off
   (muted-first).
6. **End card (0:29–0:33):** composite CTA text "Stop by and we'll take a look." + shop name
   "Nick's Tire & Auto" + logo bug over the frozen beat-6 frame. No price, no phone number
   asserted here (not verified against `businessFacts.ts` this run — see §3).
7. **Export:** 1080×1920 (9:16), 30 fps, H.264 High Profile, target 8–12 Mbps VBR, audio AAC
   192 kbps stereo. This matches the render-integrity gate's expectations (≥80% of expected
   30fps frame count, motion present — not a static image).

**All of the above is manual work for a human editor in CapCut (or equivalent) — no file has
been rendered by this session.**

## 5. Credit-risk and fallback routing

No live read of `generationLedger.ts` cost estimates or the day's `autonomy_policy_versions`
limits is possible (no DB access this run). Reported as `UNKNOWN`, not estimated:

- Per-clip cost: `UNKNOWN` here, but the repo's own code comment marks `seedance_clip: $0.25`
  as an ASSUMPTION, not a metered price — treat any number quoted elsewhere the same way.
- `REEL_VIDEO_PROVIDER` routing: `UNKNOWN` from this session; per
  `docs/operations/REEL-PIPELINE.md` prod has been pinned to `template_stock` (free local
  ffmpeg lane) rather than a paid provider — do not assume this pack would cost anything if
  it were run through the real pipeline.
- Daily budget/guardrail state (`RESERVATION_FEED_CAP`, `REPEAT_TOPIC`, `BUDGET_DAILY_EXCEEDED`):
  `UNKNOWN` — not reachable.

## 6. Audio / music rights

**Real gap, restated, not papered over:** this repo has no music-rights ledger. No specific
track is asserted as cleared anywhere in this pack. The editing instructions above give a
genre description only; whoever assembles this pack must source music from a license they
can confirm covers commercial/organic social use before publishing.

## 7. QA matrix

| Gate | Result | Basis |
|---|---|---|
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED` | No render exists; nothing to critique |
| Repair routing (`repairRouter.ts`) | `BLOCKED` | No job exists |
| 7-way automation decision (`qualityAutomation.ts`) | `BLOCKED` | No job exists |
| Consolidated publish gate (`qualityGate.ts`) | `BLOCKED` | No job exists; never called this run |
| Render-integrity contract (duration/frame-count/motion-proof) | `UNKNOWN` | Only checkable against an actual rendered file |
| Human-approval / hash-checked publish door | `BLOCKED` | Not reached; no publish attempted or authorized |

Every row above is `BLOCKED`/`UNKNOWN` because no render or job exists — this is the correct
outcome for a scheduled, no-live-operator run per the skill's hard rule, not a gate failure.

## 8. IG/FB copy + ad-ready variants

**Primary caption (organic IG/FB Reels):**
> One wheel running hotter than the others after a short drive? It can point to a brake
> caliper that's sticking — worth checking before it turns into a bigger repair. Stop by and
> we'll take a look. 🔧
> #BrakeCare #CarMaintenanceTips #AutoRepair #EuclidOhio #NicksTireAndAuto

**Ad-ready variant A (hook/caption/CTA):**
- Hook: "Touch your wheels after a drive. One hotter than the rest?"
- Caption: "A dragging brake caliper is one clue — not a guess, a reason to get it checked."
- CTA: "Stop by Nick's Tire & Auto and we'll take a look."

**Ad-ready variant B (hook/caption/CTA):**
- Hook: "Your car might be telling you something — one wheel at a time."
- Caption: "A sticking caliper can quietly wear a rotor down. Catch it early."
- CTA: "Worth a quick check. Stop by anytime."

## 9. Final status

**READY FOR HUMAN APPROVAL.**

Not `PRODUCTION-READY` in the fullest sense: §3's two mechanic-truth claims are unresolved
against this repo's evidence store, and §6's music bed is unselected pending rights
clearance. Not `PUBLISHED WITH READ-BACK` — no publish was attempted or authorized (this is
a scheduled, non-live-operator run; the skill's hard rule forbids inferring publish
permission from a stored schedule). Not `BLOCKED` — the pack itself is complete and usable by
a human editor today, pending the two follow-ups above.
