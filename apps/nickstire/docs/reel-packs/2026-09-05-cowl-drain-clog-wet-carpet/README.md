# Reel pack — "Clogged cowl drain floods your floor mats"

- **Run mode:** SCHEDULED (routes identically to INTELLIGENCE — research + pack only, no render, no publish)
- **Generated:** 2026-09-05, unattended scheduled trigger, no live operator present
- **Status:** `READY FOR HUMAN APPROVAL`

## Why no render/publish happened

This run fired from a stored scheduled prompt with no live operator in the loop. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule and root `AGENTS.md`'s protected-operations
list ("Customer-facing side effects... Build preview/draft/copy-only"), a scheduled trigger never satisfies
the "live, in-the-moment operator instruction" required to call `/api/admin/reel-canary`
(`start`/`advance`/`qa`/`publish`), Higgsfield generation, or `instagramAdmin.publishPost`. Separately, this
session has no reachable live server (no running Express process, no `ADMIN_API_KEY`, no DB session,
confirmed by `env` scan — no `DATABASE_URL`, `HIGGSFIELD_*`, `REEL_*`, or `ADMIN_API_KEY` set) — so even an
authorized call would have nowhere to land. Both facts point the same way: produce the pack, not a render.

### Tool/capability check (as asked)

| Tool | Available here? | Note |
|---|---|---|
| ChatGPT | No | This session runs on Claude, not ChatGPT — no ChatGPT connector present |
| TTS (voice synthesis) | No | No text-to-speech tool in this session. Repo has `server/reelVoice.ts` but it needs the live prod server + creds, unreachable here, and gated by the hard rule above regardless |
| Higgsfield | No (repo-wired, not reachable/authorized) | `server/services/higgsfieldStudio.ts` exists but requires a live server session + credentials this sandboxed checkout doesn't have; real generation is also barred on an unattended run |
| Meta (IG/FB) posting | No — protected, never on agent initiative | `instagramAdmin.publishPost` / reel-canary `publish` exist in-repo; posting is explicitly a protected operation regardless of tool reachability |
| Shell / render | Partial | Bash exists; `ffmpeg` is **not installed in this session** (`which ffmpeg` → not found) and no licensed stock footage or synthesized voiceover exists to render from — rendering placeholder footage and calling it "finished" would be the exact failure mode the task warns against |
| CapCut | No | No CapCut connector in this session; manual CapCut assembly steps are included below instead |

Conclusion: tools for a genuine finished render+publish are not available/authorized this run → **production pack**, per the task's own fallback path.

### Duplicate-topic check performed

- `ls apps/nickstire/docs/reel-packs/` — 140+ merged packs (2026-08-14 → 2026-09-04). None cover cowl
  drains, exterior water intrusion, or wet interior carpet. The closest neighbor,
  `2026-08-20-musty-ac-smell-evaporator-vs-filter`, is a distinct failure mode (AC evaporator condensate,
  worse in summer, water on the passenger floor from the AC system) — this pack covers exterior rainwater
  backing up through the windshield cowl channel into the HVAC intake, worse after leaf-fall/rainstorms.
  The two are commonly confused by drivers, which is part of this pack's hook.
- GitHub open-PR search `is:pr is:open "reel pack" in:title` — 10 open drafts found: #2126 tire feathering
  wear, #2121 back-to-school carpool check, #2120 trunk release does nothing, #2118 sunroof won't close,
  #2117 EPS warning light, #2116 fuel filter clogged, #2115 CV axle boot grease-sling, #2114 blind spot
  monitor light, plus #2130/#2129 backlog-status-only (no new pack). None overlap this topic.
- No live DB session available, so `getRecentReelSignals()` (the real 21-day repetition ledger read) was
  **not** called — this check is static (merged dir + open PRs), not the live ledger. Flag as `UNKNOWN` for
  anything the ledger alone would catch (e.g. a same-topic pack merged same-day elsewhere); re-run the live
  check before actually enqueuing this concept.

## 1. Concept

**Driver problem:** it rained overnight (or the car sat under a tree dropping leaves) — now there's a wet
patch in the front footwell carpet and no broken window or obvious leak in sight.

**Mechanic truth:** the cowl panel at the base of the windshield hides a drain channel that routes rainwater
away from the HVAC fresh-air intake and off the body. Leaves and pine needles collect there, especially in
fall, and dam the channel. Once it's dammed, water has nowhere to go but up and over into the intake plenum,
where it drips down into the cabin — most often landing on the front passenger or driver floor. Left alone
it soaks the carpet padding and can turn musty. This is a **different** failure path from AC evaporator
condensate (already covered in this repo's pack library): that one is worse in summer and tied to AC use;
this one is worse after rain or leaf-fall and happens with the AC off.

**Why it's Reel-worthy:** seasonally timely (early September, leaf-fall approaching in the shop's Cleveland
market), universal symptom across most cars, motion-first (leaves in a channel, water backing up, a drip
under the dash — no talking head needed), no pricing/warranty claim required (sidesteps the `businessFacts`
"reel" channel gap entirely), ends on the approved CTA.

**Claim safety:** no price, no guarantee, no "you need X" — validated against the pattern bank in
`facelessReelStudio.ts` (`no-you-need`, `no-this-means-bad`, `no-definitely-need`, `no-free-claims`,
`no-sameday-guarantee`). Script uses only approved soft phrases: *"can be one clue"*, *"stop by and we'll
take a look"* (verbatim from the approved bank, lines 604–609).

**Evidence status:** this is general automotive cowl/drain mechanics (a well-documented design feature and
failure mode across manufacturers), not a shop-specific price/warranty/policy claim, so it does not need a
`business_facts` row. No `EvidenceRecord` was pulled from `evidenceResolver.ts` for this run — no live DB
session. Mark claim-entailment as `UNKNOWN` (not evaluated) until a live session confirms there's no
DB-backed evidence record that should instead be cited verbatim.

## 2. Script — word-for-word, timed

| Time | Narration (VO) |
|---|---|
| 0:00–0:05 | "It rained last night, and now your floor mat is soaked." |
| 0:05–0:10 | "It's probably not a window leak." |
| 0:10–0:15 | "Leaves clog the drain channel under your wiper cowl." |
| 0:15–0:20 | "Water backs up instead of draining outside." |
| 0:20–0:25 | "It spills into the vent intake, then drips down under your dash." |
| 0:25–0:30 | "A musty smell can be one clue something's damming up there." |
| 0:30–0:33 | "Clear the leaves, or stop by and we'll take a look." |

Total runtime: **33s** (30s of beats + 3s SAVE freeze), inside the 15–60s target.

## 3. Storyboard beats + per-beat generation prompts

Standing negative prompt for **every** beat (no exceptions):
`faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

| Beat | Time | On-screen text (muted-first) | Visual + motion | Positive generation prompt |
|---|---|---|---|---|
| 1 | 0–5s | RAINED LAST NIGHT — FLOOR MAT SOAKED | Front footwell carpet, water beaded/pooled, slow push-in | Interior car front footwell, dark carpet visibly soaked with a small pool of water beading on the surface, slow cinematic push-in, dim overcast daylight through the windshield, photorealistic automotive interior detail, 9:16 vertical. |
| 2 | 5–10s | PROBABLY NOT A WINDOW LEAK | Driver window seal exterior, closed, rain beading and running off cleanly | Exterior close-up of a car door window and rubber seal, closed, rain droplets beading and running off cleanly down the glass, overcast wet daylight, photorealistic automotive detail, 9:16 vertical. |
| 3 | 10–15s | LEAVES CLOG THE COWL DRAIN | Top-down view into cowl panel channel at base of windshield, packed with wet leaves | Top-down close-up of a car's windshield cowl panel channel, packed with wet fallen leaves and pine needles blocking a narrow drain slot, overcast daylight, photorealistic automotive detail shot, 9:16 vertical. |
| 4 | 15–20s | WATER BACKS UP, NOT OUT | Water level rising in the leaf-clogged channel, slow overflow over the edge | Close-up of the same windshield cowl drain channel, water level slowly rising against a dam of wet leaves and gently overflowing over the channel's edge, overcast daylight, subtle water motion, photorealistic, 9:16 vertical. |
| 5 | 20–25s | SPILLS INTO THE VENT INTAKE | X-ray cutaway: cowl intake plenum with water trickling down into dash cavity | Technical x-ray cutaway visualization of a car's cowl and HVAC intake plenum behind the windshield, showing a thin stream of water trickling down through the intake housing into the dashboard cavity below; translucent layered materials; cool schematic blue glow; clean dark field; slow orbiting camera; 9:16 vertical. |
| 6 | 25–30s | MUSTY SMELL = ONE CLUE | Interior shot, windshield fogging slightly near the base, condensation forming | Interior car shot from the passenger seat looking toward the windshield base, light condensation and fog slowly forming near the bottom edge of the glass, dim cabin lighting, photorealistic, slow motion, 9:16 vertical. |
| SAVE freeze | 30–33s | CLEAR THE LEAVES — WE'LL TAKE A LOOK | Hold last frame of beat 6 (no new generation) | *(freeze frame, not a generated beat — see assembly)* |

Beat 1 opens at `startSecond: 0` with both a visual and on-screen text, satisfying the render's first-frame
scroll-stop check. No beat uses a static/unmoving shot — each has explicit camera or subject motion, which
is what the render-integrity gate's "≥3 distinct MD5s among 5 sampled frames" check is actually proving.

## 4. Captions

See `captions.srt` in this folder — timed to the VO table above, one cue per beat plus the freeze card.

## 5. Assembly instructions

**Contract to match** (from `reelAssembly.ts` render-integrity gate, "#800/#801" — do not deviate):
container duration within 0.75s of 33s, video-stream duration within 0.75s of 33s (don't let a longer audio
track pad the container while video ends early), ≥80% of expected 30fps frame count (~792 of 990 frames
minimum), ≥3 distinct MD5s among 5 sampled frames.

**Layer order (bottom → top):** background video track (beats 1–6, hard cuts, no cross-dissolve — keeps
each beat's motion legible at speed) → freeze frame (beat 6's last frame, held 3s) → burned-in caption track
(`captions.srt`, muted-first on-screen text per the beat table, NOT the same text as VO — visual/on-screen
text and VO are different registers here, so don't just caption the narration verbatim over beats that have
their own onScreenText field) → VO audio track, ducked 3dB under any music bed → music bed (see rights note
below) → end-card CTA text on the freeze frame.

**ffmpeg (concat + caption burn), 30fps output, 1080x1920:**
```bash
# 1. Concat the 6 beat clips (already 30fps, 9:16) with hard cuts
ffmpeg -f concat -safe 0 -i beats.txt -c copy beats_concat.mp4

# 2. Extract + hold last frame of beat 6 for the 3s SAVE freeze
ffmpeg -sseof -1 -i beat6.mp4 -vframes 1 freeze.png
ffmpeg -loop 1 -i freeze.png -t 3 -r 30 -vf "scale=1080:1920" freeze.mp4

# 3. Concat beats + freeze
ffmpeg -f concat -safe 0 -i full.txt -c copy assembled_33s.mp4

# 4. Burn captions + mix VO
ffmpeg -i assembled_33s.mp4 -i vo.mp3 -vf "subtitles=captions.srt:force_style='Fontsize=20,Bold=1,Alignment=2,MarginV=140'" \
  -map 0:v -map 1:a -c:v libx264 -pix_fmt yuv420p -r 30 -c:a aac -shortest final.mp4

# 5. Verify against the render-integrity contract before calling it done
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 final.mp4
ffprobe -v error -select_streams v:0 -show_entries stream=duration -of default=noprint_wrappers=1 final.mp4
```

**CapCut (manual):** import the 6 beat clips in order on the video track, hard cuts (no transitions) at the
5s marks; duplicate the last frame of beat 6 and extend it 3s for the freeze; add the caption text per-beat
from the table above as CapCut text layers (bold, bottom-third, high-contrast); import VO as a separate
audio track; add a royalty-free music bed under it at low volume; export 1080x1920, 30fps, H.264.

## 6. Posting specs — IG/FB copy

**Platform:** Instagram Reels + Facebook Reels (cross-post). **Aspect:** 9:16, 1080x1920. **Duration:** 33s.

**Caption:**
> Wet floor mat after last night's rain? 🍂 It's probably not a window leak — leaves clog the drain channel
> under your windshield cowl, water backs up instead of draining out, and it spills into the vent intake
> where it drips down under your dash. A musty smell can be one clue. Clear the leaves, or stop by and
> we'll take a look. 🔧
>
> #NicksTireAndAuto #Euclid #CarMaintenance #FallCarCare #CarProblems #AutoRepair #MechanicTips #CarCare

### Ad-ready variants (2)

**Variant A — problem-first hook**
- Hook: "Your floor mat is soaked. It's not a window leak."
- Caption: same body as above, trimmed to the first two sentences for the ad card.
- CTA: "Stop by and we'll take a look."

**Variant B — curiosity hook**
- Hook: "Leaves can flood your car's interior. Here's how."
- Caption: leads with the cowl-drain-to-intake explanation, same closing line.
- CTA: "Clear the leaves, or stop by and we'll take a look."

## 7. Credit-risk and fallback routing

Not a metered read — `getHiggsfieldAccountHealth()` was not called (no live server session this run), so
treat balance as `UNKNOWN`. Cost is an **estimate** against `COST_ESTIMATES_USD` in
`server/services/generationLedger.ts`, re-verify before actually enqueuing:

- If `REEL_VIDEO_PROVIDER` is pinned to the paid `seedance` lane: 6 generated beats × $0.25 (labeled
  ASSUMPTION in source) ≈ **$1.50 estimated**.
- Per `docs/operations/REEL-PIPELINE.md` (last read in a prior session, re-verify — not a live read this
  run): prod has historically pinned `REEL_VIDEO_PROVIDER=template_stock`, the free local-ffmpeg lane. On
  that lane this concept would need **licensed/owned stock footage** for the 6 shots above instead of AI
  generation — none is sourced yet; that's a real gap to close before a `template_stock` render, not a $0
  free pass.
- Daily cap: `autonomy_policy_versions.limits.maxGenerationCostPerDayUsd` — reported elsewhere as $10/day;
  `UNKNOWN` as of this run (no live DB read). Re-check the current policy row before spending against it.
- `RESERVATION_FEED_CAP` (2 posts/day) and `RESERVATION_SPACING` (3h) also gate this at enqueue time — not
  evaluated here, check `content_reservations` before assuming a slot is open.

## 8. Audio / music rights — real gap, not glossed over

No music-rights ledger exists in this repo (confirmed in `nickstire-reel-operator` skill doc). This pack
does **not** assert any track is cleared. Safest default absent a ledger: use the platform's own
royalty-free music library at posting time inside Instagram/Facebook's native editor (zero external
clearance needed) rather than an external track. If an external track is used instead, log source, license
scope, territory, and expiry manually — there is nowhere in-repo to record it yet.

## 9. QA matrix

Nothing below was actually run this session — no live server, no render, no generation call. Reporting
`PASS` on any of these without a real read-back would be exactly the "jobId came back" failure this repo's
own runbook calls out. All gates:

| Gate | Result | Why |
|---|---|---|
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED` | no render occurred |
| Render-integrity (`reelAssembly.ts` #800/#801) | `BLOCKED` | no render occurred |
| Repair routing (`repairRouter.ts`) | `BLOCKED` | nothing to repair, nothing rendered |
| 7-way automation decision (`qualityAutomation.ts`) | `BLOCKED` | no job exists |
| Consolidated publish gate (`qualityGate.ts`) | `BLOCKED` | no job to evaluate |
| Repetition ledger (`getRecentReelSignals`) | `UNKNOWN` | no live DB session; static dir/PR check only (§ above) |
| Claim entailment (`evidenceResolver.ts`) | `UNKNOWN` | no live DB session; no evidence record pulled |
| Quality score (`calculateReelQualityScore`, 70/75 floor) | `UNKNOWN` (self-estimate ~68–71/75, not authoritative) | scored by eye against the rubric, not by the real function — re-score for real before enqueueing |

## 10. Final status

**`READY FOR HUMAN APPROVAL`** — production pack only. No generation, spend, render, or publish action was
taken. To move this forward: an operator gives a live, in-the-moment instruction to run `PRODUCTION`/`DRAFT`
mode (`POST /api/admin/reel-canary {action:"start", topic:"clogged cowl drain floods floor mats"}`), which
re-runs the real preflight, quality score, and repetition ledger against current prod state before anything
renders.
