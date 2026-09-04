# Reel pack — "Backup camera goes black mid-reverse"

- **Run mode:** SCHEDULED (routes identically to INTELLIGENCE — research + pack only, no render, no publish)
- **Generated:** 2026-09-04, unattended scheduled trigger, no live operator present
- **Status:** `READY FOR HUMAN APPROVAL`

## Why no render/publish happened

This run fired from a stored scheduled prompt with no live operator in the loop.
Per `.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule and root
`AGENTS.md`'s protected-operations list ("Customer-facing side effects... Build
preview/draft/copy-only"), a scheduled trigger never satisfies the "live,
in-the-moment operator instruction" required to call `/api/admin/reel-canary`
(`start`/`advance`/`qa`/`publish`), Higgsfield generation, or
`instagramAdmin.publishPost`. Separately, this session has no reachable live
server (no running Express process, no `ADMIN_API_KEY`, no DB session) — so
even a authorized call would have nowhere to land. Both facts point the same
way: produce the pack, not a render.

### Tool/capability check (as asked)

| Tool | Available here? | Note |
|---|---|---|
| ChatGPT | No | This session runs on Claude, not ChatGPT — no ChatGPT connector present |
| TTS (voice synthesis) | No | No text-to-speech generation tool in this session. Repo has `server/reelVoice.ts` but it needs the live prod server + creds, unreachable here, and gated by the hard rule above regardless |
| Higgsfield | No (repo-wired, not reachable/authorized) | `server/services/higgsfieldStudio.ts` exists but requires a live server session + credentials this sandboxed checkout doesn't have, and real generation is barred on an unattended run |
| Meta (IG/FB) posting | No — protected, never on agent initiative | `instagramAdmin.publishPost` / reel-canary `publish` exist in-repo; posting is explicitly a protected operation regardless of tool reachability |
| Shell / render | Partial | Bash + Adobe video render tools exist, but there is no licensed stock footage or synthesized voiceover to render *from* right now — rendering placeholder footage and calling it "finished" would be the exact failure mode the task warns against |
| CapCut | No | No CapCut connector in this session; manual CapCut assembly steps are included below instead |

Conclusion: tools for a genuine finished render+publish are not available/authorized this run → **production pack**, per the task's own fallback path.

### Duplicate-topic check performed

- `ls apps/nickstire/docs/reel-packs/` — 130+ merged packs (2026-08-14 → 2026-08-28), none on backup cameras.
- `gh`/GitHub search `is:pr is:open "reel pack" in:title` — 6 open drafts (#2037 clutch pedal, #2041 alarm false-trigger, #2044 seatbelt light, #2045 power seat, #2046 gas pedal, #2076 backlog-status-only). None overlap this topic.
- No live DB session available, so `getRecentReelSignals()` (the real repetition ledger read) was **not** called — this check is static (merged dir + open PRs), not the live 21-day ledger. Flag as `UNKNOWN` for anything the ledger alone would catch (e.g. a same-topic pack merged same-day elsewhere) and re-run the live check before actually enqueuing this concept.

## 1. Concept

**Driver problem:** reversing, glance at the dash — camera feed is black or frozen, right when it's needed.
**Mechanic truth:** three independent failure points share this symptom — the lens/housing, the wiring loom that flexes every time the hatch opens (a real mechanical fatigue point), or the head-unit screen/module. Flicker-before-failure is a real diagnostic clue (wiring fatigue reads as intermittent; a dead camera reads as always-black; a dead screen reads as black on every camera, not just reverse).
**Why it's Reel-worthy:** universal symptom (most cars 2018+), motion-first (hatch opening/closing, screen flicker, connector detail — no talking head needed), no pricing/warranty claim required (sidesteps the `businessFacts` "reel" channel gap entirely), ends on the approved CTA.

**Claim safety:** no price, no guarantee, no "you need X" — validated against the pattern bank in
`facelessReelStudio.ts` (`no-you-need`, `no-this-means-bad`, `no-definitely-need`, `no-free-claims`,
`no-sameday-guarantee`). Script uses only approved soft phrases: *"one clue"*, *"do not guess"*,
*"stop by and we'll take a look"* (verbatim from the approved bank, lines 604–609).

**Evidence status:** this is general automotive wiring-fatigue mechanics (repeated hinge-flex → conductor
fatigue is a well-known failure mode), not a shop-specific price/warranty/policy claim, so it does not need
a `business_facts` row. No `EvidenceRecord` was pulled from `evidenceResolver.ts` for this run — no live DB
session. Mark claim-entailment as `UNKNOWN` (not evaluated) until a live session confirms there's no
DB-backed evidence record that should instead be cited verbatim.

## 2. Script — word-for-word, timed

| Time | Narration (VO) |
|---|---|
| 0:00–0:05 | "Your backup camera goes black right when you need it most." |
| 0:05–0:10 | "It's not always the camera. Three parts share the blame." |
| 0:10–0:15 | "The lens, the wiring through the hatch hinge, or the screen itself." |
| 0:15–0:20 | "That wire flexes every single time you open the trunk." |
| 0:20–0:25 | "Thousands of open-close cycles later, the copper inside just fatigues." |
| 0:25–0:30 | "A flickering picture before it dies is one clue where to start." |
| 0:30–0:33 | "Do not guess which part — stop by and we'll take a look." |

Total runtime: **33s** (30s of beats + 3s SAVE freeze), inside the 15–60s target.

## 3. Storyboard beats + per-beat generation prompts

Standing negative prompt for **every** beat (no exceptions):
`faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

| Beat | Time | On-screen text (muted-first) | Visual + motion | Positive generation prompt |
|---|---|---|---|---|
| 1 | 0–5s | BACKUP CAM GOES BLACK MID-REVERSE | Dash screen close-up, feed flickers to black while reversing | Interior car dashboard infotainment screen mounted in center console, displaying a rearview backup-camera feed of a dim garage; feed flickers with static interference then cuts to solid black; close framing on the screen only; subtle handheld vehicle vibration; night interior ambient light; photorealistic automotive footage; 9:16 vertical. |
| 2 | 5–10s | IT'S NOT ALWAYS THE CAMERA | Rear bumper camera housing, lens fogged with condensation, slow push-in | Extreme close-up on a rear bumper camera housing, lens ringed with light condensation/fog, slow cinematic push-in, shallow depth of field, overcast daylight, photorealistic automotive detail shot, 9:16 vertical. |
| 3 | 10–15s | LENS. WIRING. OR SCREEN. | X-ray cutaway: camera → hinge wiring → head unit | Technical x-ray cutaway visualization of a vehicle's rear end showing the wiring path from the bumper camera through the trunk hatch hinge to the dashboard head unit; translucent layered materials; cool schematic blue glow; clean dark field; precise engineering aesthetic; slow orbiting camera; 9:16 vertical. |
| 4 | 15–20s | WIRE FLEXES EVERY OPEN | Hatch opens/closes in a loop, loom visibly flexing at the hinge | Vehicle trunk hatch opening and closing in a smooth continuous loop, close framing on the hinge pivot area where a black wiring loom visibly flexes and loops with each cycle, studio-lit garage background, photorealistic, 9:16 vertical. |
| 5 | 20–25s | COPPER FATIGUES OVER TIME | Macro shot, corroded connector pins, rotating on turntable | Macro product shot of an automotive wiring pigtail connector with light green-white corrosion on the pins, slowly rotating on a dark turntable, dramatic rim lighting, shallow depth of field, photorealistic, 9:16 vertical. |
| 6 | 25–30s | FLICKER FIRST = ONE CLUE | Dash screen flickers picture/static, then cuts black, slow-mo | Interior car dashboard infotainment screen, backup-camera feed flickering rapidly between a clear picture and static noise before cutting to black, slow motion, close framing on the screen only, night interior ambient light, photorealistic, 9:16 vertical. |
| SAVE freeze | 30–33s | STOP BY — WE'LL TAKE A LOOK | Hold last frame of beat 6 (no new generation) | *(freeze frame, not a generated beat — see assembly)* |

Beat 1 opens at `startSecond: 0` with both a visual and on-screen text, satisfying the render's
first-frame scroll-stop check. No beat uses a static/unmoving shot — each has explicit camera or
subject motion, which is what the render-integrity gate's "≥3 distinct MD5s among 5 sampled frames"
check is actually proving.

## 4. Captions

See `captions.srt` in this folder — timed to the VO table above, one cue per beat plus the freeze card.

## 5. Assembly instructions

**Contract to match** (from `reelAssembly.ts` render-integrity gate, "#800/#801" — do not deviate):
container duration within 0.75s of 33s, video-stream duration within 0.75s of 33s (don't let a longer
audio track pad the container while video ends early), ≥80% of expected 30fps frame count (~792 of 990
frames minimum), ≥3 distinct MD5s among 5 sampled frames.

**Layer order (bottom → top):** background video track (beats 1–6, hard cuts, no cross-dissolve — keeps
each beat's motion legible at speed) → freeze frame (beat 6's last frame, held 3s) → burned-in caption
track (`captions.srt`, muted-first on-screen text per the beat table, NOT the same text as VO — this repo
treats visual/on-screen-text and VO as different registers, so don't just caption the narration verbatim
over beats that have their own onScreenText field) → VO audio track, ducked 3dB under any music bed →
music bed (see rights note below) → end-card CTA text on the freeze frame.

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

**CapCut (manual):** import the 6 beat clips in order on the video track, hard cuts (no transitions) at
the 5s marks; duplicate the last frame of beat 6 and extend it 3s for the freeze; add the caption text
per-beat from the table above as CapCut text layers (bold, bottom-third, high-contrast); import VO as a
separate audio track; add a royalty-free music bed under it at low volume; export 1080x1920, 30fps, H.264.

## 6. Posting specs — IG/FB copy

**Platform:** Instagram Reels + Facebook Reels (cross-post). **Aspect:** 9:16, 1080x1920. **Duration:** 33s.

**Caption:**
> Backup camera go black right when you're reversing? 👀 It's not always the camera — the wiring loom
> that runs through your hatch hinge flexes every single time you open the trunk, and after thousands of
> cycles that copper just fatigues. A flickering picture before it dies is one clue. Don't guess which
> part — stop by and we'll take a look. 🔧
>
> #NicksTireAndAuto #Euclid #CarMaintenance #BackupCamera #CarProblems #AutoRepair #MechanicTips #CarCare

### Ad-ready variants (2)

**Variant A — problem-first hook**
- Hook: "Your backup camera just went black. Mid-reverse."
- Caption: same body as above, trimmed to the first two sentences for the ad card.
- CTA: "Stop by and we'll take a look."

**Variant B — curiosity hook**
- Hook: "3 parts can kill your backup camera. Only one of them is the camera."
- Caption: leads with the hinge-wiring-fatigue explanation, same closing line.
- CTA: "Don't guess which part — stop by and we'll take a look."

## 7. Credit-risk and fallback routing

Not a metered read — `getHiggsfieldAccountHealth()` was not called (no live server session this run), so
treat balance as `UNKNOWN`. Cost is an **estimate** against `COST_ESTIMATES_USD` in
`server/services/generationLedger.ts`, re-verify before actually enqueuing:

- If `REEL_VIDEO_PROVIDER` is pinned to the paid `seedance` lane: 6 generated beats × $0.25 (labeled
  ASSUMPTION in source) ≈ **$1.50 estimated**.
- Per `docs/operations/REEL-PIPELINE.md` (last read this session, re-verify — not a live read):
  prod currently pins `REEL_VIDEO_PROVIDER=template_stock`, the free local-ffmpeg lane. On that lane this
  concept would need **licensed/owned stock footage** for the 6 shots above instead of AI generation — none
  is sourced yet; that's a real gap to close before a `template_stock` render, not a $0 free pass.
- Daily cap: `autonomy_policy_versions.limits.maxGenerationCostPerDayUsd` — reported elsewhere as $10/day;
  `UNKNOWN` as of this run (no live DB read). Re-check the current policy row before spending against it.
- `RESERVATION_FEED_CAP` (2 posts/day) and `RESERVATION_SPACING` (3h) also gate this at enqueue time —
  not evaluated here, check `content_reservations` before assuming a slot is open.

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
| Quality score (`calculateReelQualityScore`, 70/75 floor) | `UNKNOWN` (self-estimate ~68–72/75, not authoritative) | scored by eye against the rubric, not by the real function — re-score for real before enqueueing |

## 10. Final status

**`READY FOR HUMAN APPROVAL`** — production pack only. No generation, spend, render, or publish action
was taken. To move this forward: an operator gives a live, in-the-moment instruction to run
`PRODUCTION`/`DRAFT` mode (`POST /api/admin/reel-canary {action:"start", topic:"backup camera goes
black mid-reverse"}`), which re-runs the real preflight, quality score, and repetition ledger against
current prod state before anything renders.
