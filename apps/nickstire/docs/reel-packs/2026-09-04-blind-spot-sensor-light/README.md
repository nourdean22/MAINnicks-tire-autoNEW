# Reel pack — "Blind spot light stays on — it might not be broken"

- **Run mode:** SCHEDULED (routes identically to INTELLIGENCE — research + pack only, no render, no publish)
- **Generated:** 2026-09-04, unattended scheduled trigger, no live operator present
- **Status:** `READY FOR HUMAN APPROVAL`

## Why no render/publish happened

This run fired from a stored scheduled prompt with no live operator in the loop. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule and root `AGENTS.md`'s
protected-operations list ("Customer-facing side effects... Build preview/draft/copy-only"), a
scheduled trigger never satisfies the "live, in-the-moment operator instruction" required to call
`/api/admin/reel-canary` (`start`/`advance`/`qa`/`publish`), Higgsfield generation, or
`instagramAdmin.publishPost`. Separately, this session has no reachable live server (no running
Express process, no `ADMIN_API_KEY`, no DB session — confirmed by `env` scan, all empty) — so even
an authorized call would have nowhere to land. Both facts point the same way: produce the pack, not
a render.

### Tool/capability check (as asked)

| Tool | Available here? | Note |
|---|---|---|
| ChatGPT | No | This session runs on Claude, not ChatGPT — no ChatGPT connector present |
| TTS (voice synthesis) | No | No text-to-speech tool in this session. Repo has `server/reelVoice.ts` but it needs the live prod server + creds, unreachable here, and gated by the hard rule above regardless |
| Higgsfield | No (repo-wired, not reachable/authorized) | `server/services/higgsfieldStudio.ts` exists but requires a live server session + credentials this sandboxed checkout doesn't have; real generation is barred on an unattended run either way |
| Meta (IG/FB) posting | No — protected, never on agent initiative | `instagramAdmin.publishPost` / reel-canary `publish` exist in-repo; posting is explicitly a protected operation regardless of tool reachability |
| Shell / render | Partial | Bash + Adobe video render tools exist, but there is no licensed stock footage or synthesized voiceover to render *from* right now — rendering placeholder footage and calling it "finished" would be the exact failure mode the task warns against |
| CapCut | No | No CapCut connector in this session; manual CapCut assembly steps are included below instead |

Conclusion: tools for a genuine finished render+publish are not available/authorized this run →
**production pack**, per the task's own fallback path.

### Duplicate-topic check performed

- `ls apps/nickstire/docs/reel-packs/` — 140+ merged packs (2026-08-14 → 2026-09-04, including four
  posted earlier today: backup-camera-black-screen, fall-car-care-checklist,
  heated-seats-not-working, remote-start-not-working). None cover blind-spot monitoring.
- `gh`/GitHub search `is:pr is:open` across the whole repo — one open PR (#2096, unrelated statenour
  Agent OS work). No open reel-pack drafts to collide with.
- No live DB session available, so `getRecentReelSignals()` (the real 21-day repetition ledger read)
  was **not** called — this check is static (merged dir + open PR list), not the live ledger. Flag
  as `UNKNOWN` for anything the ledger alone would catch; re-run the live check before actually
  enqueueing this concept.

## 1. Concept

**Driver problem:** merging or changing lanes, the blind-spot indicator light in the mirror won't
turn off — or worse, stays dark and never warns at all — and the driver has no idea if that means a
real fault or just road grime.

**Mechanic truth:** blind-spot monitoring radar sensors sit low in the rear bumper corners, exactly
the height that catches mud, road salt spray, snow pack, and parking-lot slush. A covered sensor
throws the same dash warning as a genuinely failed one, because the radar can't distinguish "blocked"
from "broken" — it just reports "can't see." The other common cause is a bumper repair or tap that
shifted the sensor's aim even slightly; radar sensors are calibrated to a precise angle, and a
shifted sensor reports faults or drops detection without any visible damage. Wiping the sensor area
clean and clearing road grime is the first, free thing to try before assuming a repair is needed.

**Why it's Reel-worthy:** universal and growing symptom (BSM standard on most 2018+ trims), motion-
first (bumper corner close-up, mud/spray, dash icon, mirror indicator — no talking head needed), no
pricing/warranty claim required (sidesteps the `businessFacts` "reel" channel gap entirely), safety-
relevant without fearmongering, ends on the approved CTA.

**Claim safety:** no price, no guarantee, no "you need X" — validated against the pattern bank in
`facelessReelStudio.ts` (`no-you-need`, `no-this-means-bad`, `no-definitely-need`, `no-free-claims`,
`no-sameday-guarantee`). Script uses only approved soft phrases: *"can point to"*, *"worth checking"*,
*"stop by and we'll take a look"* (verbatim from the approved bank, lines 604–609).

**Evidence status:** this is general ADAS-sensor mechanics (radar sensors reporting "obstructed" on
dirt/grime, and requiring precise aim after body work — both well-documented, non-shop-specific
facts), not a shop-specific price/warranty/policy claim, so it does not need a `business_facts` row.
No `EvidenceRecord` was pulled from `evidenceResolver.ts` for this run — no live DB session. Mark
claim-entailment as `UNKNOWN` (not evaluated) until a live session confirms there's no DB-backed
evidence record that should instead be cited verbatim.

## 2. Script — word-for-word, timed

| Time | Narration (VO) |
|---|---|
| 0:00–0:05 | "That blind spot light won't turn off. Every lane change, there it is." |
| 0:05–0:10 | "It might not be broken. It might just be blind." |
| 0:10–0:15 | "The sensor sits low in the bumper corner — right where mud and slush collect." |
| 0:15–0:20 | "A covered sensor reports the same fault as a failed one. It can't tell the difference." |
| 0:20–0:25 | "The other cause: a bumper tap that shifted the sensor's aim, even slightly." |
| 0:25–0:30 | "A stuck warning light can point to either — wipe it clean first, that's free." |
| 0:30–0:33 | "Still stuck on? Stop by and we'll take a look." |

Total runtime: **33s** (30s of beats + 3s SAVE freeze), inside the 15–60s target.

## 3. Storyboard beats + per-beat generation prompts

Standing negative prompt for **every** beat (no exceptions):
`faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

| Beat | Time | On-screen text (muted-first) | Visual + motion | Positive generation prompt |
|---|---|---|---|---|
| 1 | 0–5s | BLIND SPOT LIGHT WON'T TURN OFF | Side mirror housing, amber triangle warning icon glowing steady, car passing in adjacent lane reflected in mirror | Close-up on a car's side mirror housing, an amber triangular blind-spot warning icon glowing steadily near the mirror glass edge, a passing vehicle briefly reflected in the mirror surface, daylight highway driving, photorealistic automotive footage, 9:16 vertical. |
| 2 | 5–10s | MIGHT NOT BE BROKEN | Rear bumper corner, low angle, small black sensor housing embedded in bumper skin | Low-angle close-up on a vehicle's rear bumper corner, a small black radar sensor housing embedded flush in the bumper skin, shallow depth of field, overcast daylight, photorealistic automotive detail shot, 9:16 vertical. |
| 3 | 10–15s | SENSOR SITS WHERE GRIME COLLECTS | Slow-motion road spray/mud splashing up onto rear bumper corner from a passing wheel | Slow-motion shot of road spray and mud splashing up from a vehicle's rear wheel well directly onto the bumper corner where a sensor housing sits, wet asphalt, overcast daylight, photorealistic automotive footage, 9:16 vertical. |
| 4 | 15–20s | COVERED = SAME FAULT AS BROKEN | Technical overlay: radar cone graphic from sensor, blocked by an opaque mud layer, cone disappears | Technical schematic visualization of a radar detection cone emanating from a bumper-corner sensor, a semi-transparent brown mud layer overlays the sensor and the cone flickers then vanishes, cool schematic blue-and-amber glow, clean dark field, precise engineering aesthetic, 9:16 vertical. |
| 5 | 20–25s | OR: BUMPER TAP SHIFTED THE AIM | Macro shot, sensor housing with faint scuff mark, sensor tilts a few degrees off-axis | Macro close-up of a bumper-mounted radar sensor housing with a faint scuff mark on its edge, the housing subtly rotating a few degrees off its original axis, dramatic rim lighting, shallow depth of field, photorealistic, 9:16 vertical. |
| 6 | 25–30s | WIPE IT CLEAN — THAT'S FREE | Hand-free microfiber cloth wiping mud off the sensor area in a slow wipe motion, dash icon fading from lit to off | Close-up of a microfiber cloth (no hand visible, cloth appears to move on its own via a mounted rig) wiping mud and grime off a rear bumper sensor housing in one slow deliberate motion, followed by a cut to a dashboard blind-spot warning icon fading from lit amber to off, photorealistic, 9:16 vertical. |
| SAVE freeze | 30–33s | STILL ON? WE'LL TAKE A LOOK | Hold last frame of beat 6 (no new generation) | *(freeze frame, not a generated beat — see assembly)* |

Beat 1 opens at `startSecond: 0` with both a visual and on-screen text, satisfying the render's
first-frame scroll-stop check. No beat uses a static/unmoving shot — each has explicit camera or
subject motion, which is what the render-integrity gate's "≥3 distinct MD5s among 5 sampled frames"
check is actually proving. Beat 6 avoids showing a human hand per the standing negative prompt — note
the generation prompt calls for a rig-mounted cloth motion, not a hand; if the actual render shows a
hand, that beat must be regenerated or re-cropped before assembly, not shipped as-is.

## 4. Captions

See `captions.srt` in this folder — timed to the VO table above, one cue per beat plus the freeze card.

## 5. Assembly instructions

**Contract to match** (from `reelAssembly.ts` render-integrity gate, "#800/#801" — do not deviate):
container duration within 0.75s of 33s, video-stream duration within 0.75s of 33s (don't let a longer
audio track pad the container while video ends early), ≥80% of expected 30fps frame count (~792 of 990
frames minimum), ≥3 distinct MD5s among 5 sampled frames.

**Layer order (bottom → top):** background video track (beats 1–6, hard cuts, no cross-dissolve —
keeps each beat's motion legible at speed) → freeze frame (beat 6's last frame, held 3s) → burned-in
caption track (`captions.srt`, muted-first on-screen text per the beat table, NOT the same text as VO
— this repo treats visual/on-screen-text and VO as different registers, so don't just caption the
narration verbatim over beats that have their own onScreenText field) → VO audio track, ducked 3dB
under any music bed → music bed (see rights note below) → end-card CTA text on the freeze frame.

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
> That blind spot light won't shut off? 🚗 It might not be broken — the sensor sits low in your rear
> bumper, right where mud, salt spray, and slush collect. A covered sensor throws the same warning as
> a failed one. Wipe the sensor area clean first, that's free. Still stuck on after that? It can point
> to a bumper tap that shifted the sensor's aim. Stop by and we'll take a look. 🔧
>
> #NicksTireAndAuto #Euclid #CarMaintenance #BlindSpotMonitor #ADAS #CarProblems #AutoRepair #MechanicTips

### Ad-ready variants (2)

**Variant A — problem-first hook**
- Hook: "Your blind spot light won't turn off. Every single lane change."
- Caption: same body as above, trimmed to the first two sentences for the ad card.
- CTA: "Stop by and we'll take a look."

**Variant B — curiosity hook**
- Hook: "Your blind spot sensor isn't broken. It's blind."
- Caption: leads with the mud/grime explanation, same closing line.
- CTA: "Wipe it clean first — still stuck? We'll take a look."

## 7. Credit-risk and fallback routing

Not a metered read — `getHiggsfieldAccountHealth()` was not called (no live server session this run),
so treat balance as `UNKNOWN`. Cost is an **estimate** against `COST_ESTIMATES_USD` in
`server/services/generationLedger.ts`, re-verify before actually enqueueing:

- If `REEL_VIDEO_PROVIDER` is pinned to the paid `seedance` lane: 6 generated beats × $0.25 (labeled
  ASSUMPTION in source) ≈ **$1.50 estimated**.
- Per `docs/operations/REEL-PIPELINE.md` (last read this session, re-verify — not a live read): prod
  currently pins `REEL_VIDEO_PROVIDER=template_stock`, the free local-ffmpeg lane. On that lane this
  concept would need **licensed/owned stock footage** for the 6 shots above instead of AI generation —
  none is sourced yet; that's a real gap to close before a `template_stock` render, not a $0 free pass.
- Daily cap: `autonomy_policy_versions.limits.maxGenerationCostPerDayUsd` — reported elsewhere as
  $10/day; `UNKNOWN` as of this run (no live DB read). Re-check the current policy row before spending
  against it.
- `RESERVATION_FEED_CAP` (2 posts/day) and `RESERVATION_SPACING` (3h) also gate this at enqueue time —
  not evaluated here; four other packs were produced today (2026-09-04), so check
  `content_reservations` before assuming a slot is open — this is likely the 5th topic proposed today,
  well past any daily feed-post cap, so treat this concept as a queued candidate for a future day, not
  an "enqueue now" pack.

## 8. Audio / music rights — real gap, not glossed over

No music-rights ledger exists in this repo (confirmed in `nickstire-reel-operator` skill doc). This
pack does **not** assert any track is cleared. Safest default absent a ledger: use the platform's own
royalty-free music library at posting time inside Instagram/Facebook's native editor (zero external
clearance needed) rather than an external track. If an external track is used instead, log source,
license scope, territory, and expiry manually — there is nowhere in-repo to record it yet.

## 9. QA matrix

Nothing below was actually run this session — no live server, no render, no generation call.
Reporting `PASS` on any of these without a real read-back would be exactly the "jobId came back"
failure this repo's own runbook calls out. All gates:

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

**`READY FOR HUMAN APPROVAL`** — production pack only. No generation, spend, render, or publish
action was taken. To move this forward: an operator gives a live, in-the-moment instruction to run
`PRODUCTION`/`DRAFT` mode (`POST /api/admin/reel-canary {action:"start", topic:"blind spot light
stays on"}`), which re-runs the real preflight, quality score, and repetition ledger against current
prod state before anything renders. Given four other packs already went out today, also confirm the
day's `RESERVATION_FEED_CAP` (2/day) has capacity before scheduling this one.
