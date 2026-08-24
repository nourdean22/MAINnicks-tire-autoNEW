# Reel production pack — "White smoke + milky oil cap: head gasket warning signs" (2026-08-24)

**Mode:** INTELLIGENCE / SCHEDULED (automated cron firing, no live operator present).
**Status:** `READY FOR HUMAN APPROVAL` — text pack only. No render, no publish, no prod DB read,
no paid generation call was made producing this pack. See "Capability check" below for why.

## 1. Capability check (why this is a pack, not a rendered file)

This run tested, not assumed, its actual tool access before choosing a path:

- `env | grep -iE "HIGGSFIELD|ADMIN_API_KEY|REEL_|DATABASE_URL|META_|INSTAGRAM|OPENAI|ELEVEN|TTS"` —
  **zero matches.** No Higgsfield/Seedance credentials, no `ADMIN_API_KEY` for
  `/api/admin/reel-canary`, no `DATABASE_URL`, no Meta/Instagram token, no ChatGPT/TTS key are
  present in this session's environment.
- `which ffmpeg` — **not found.** No local render tool is installed in this container, so even
  the free `template_stock_clip` ffmpeg lane in `generationLedger.ts` has no binary to run.
- `which capcut` — **not found.** No editing application is available either.
- Net effect: this session has no path to real motion generation, no path to
  `/api/admin/reel-canary`, and no path to `instagramAdmin.publishPost`/Meta posting. Per the
  operator skill's hard rule ("never run a real generation, spend, or publish action ... without
  a live, in-the-moment operator instruction") and root `AGENTS.md`'s protected-operations list,
  a scheduled/cron firing does not satisfy that bar regardless — so those routes would not have
  been called even if credentials were present.
- `getHiggsfieldAccountHealth()`, `REEL_VIDEO_PROVIDER`, `REEL_GENERATION_ENABLED`, and
  `getRecentReelSignals()` were **not read** this run (the first three require live prod process
  env inspection this session doesn't have; the fourth is a production-TiDB read, out of scope
  for an unattended script per `prod-db-guard`). Treat all four as `UNKNOWN` for this run, not
  silently assumed either way.
- Repetition avoidance instead used the two checks the skill actually requires before writing:
  `ls apps/nickstire/docs/reel-packs/` (89 merged/open topic directories — grepped explicitly for
  `head-gasket`, `milky`, `white-smoke`, `coolant-oil`: zero matches) and a GitHub PR search for
  open `reel pack` PRs (6 open drafts as of this run — water pump weep hole, turbo whistle vs.
  boost leak, horn stops working, sweet smell/heater core, trunk strut, washer fluid nozzle —
  none overlapping this topic).

**Per the skill's explicit fallback rule** ("If ... this session has no path to call
`/api/admin/reel-canary` ... do not silently downgrade to a stills-with-voiceover deliverable.
Return `BLOCKED: NO MOTION ROUTE` **or** a full production-ready pack ... never a quietly weaker
asset presented as finished") — this pack takes the second option: a complete, render-ready
production pack, clearly labeled as unrendered.

## 2. Candidate scoring (self-estimated, NOT the server's real `calculateReelQualityScore`)

Estimate against the 75-point rubric in `facelessReelStudio.ts`; the real score is computed
server-side at enqueue and was not run here.

| Dimension | Max | Est. | Why |
|---|---|---|---|
| First-frame scroll-stop | 10 | 9 | White smoke rolling from a tailpipe at idle is a visually arresting, motion-first cold open |
| Muted-first (captions carry it) | 10 | 10 | Full VO is captioned 1:1 below |
| Beat structure | 5 | 5 | 7 discrete beats, each a distinct camera setup |
| Length (15-60s) | 5 | 5 | 30s + 3s freeze = 33s |
| Loopability | 5 | 3 | Clean-idle final beat could loop into the smoke cold open; not a hard seam match |
| Sourced fact | 10 | 4 | Mechanism (coolant/oil cross-contamination through a failed head gasket) is general automotive knowledge, not a `businessFacts`/`EvidenceRecord` citation — see §3 |
| Faceless | 10 | 10 | No people, hands, or faces in any beat |
| Claim safety | 10 | 10 | Only approved soft language used — see §3 |
| Keyword relevance | 5 | 5 | "white smoke from exhaust", "milky oil cap" are high-volume searched terms |
| Winning concept (>=57/60) | 5 | -- | N/A outside a real concept tournament |
| **Total (excl. tournament line)** | **70** | **61** | Self-estimate, below the 70 floor — flag, don't round up |

**Selected concept:** the head-gasket white-smoke/milky-oil reel above (only candidate generated
this run).
**Parked:** none — single-candidate run, not a tournament.

## 3. Claim evidence

No `businessFacts` or `EvidenceRecord` lookups were performed this run (would require a live prod
DB/API read, out of scope for an unattended script). Every claim in the script below is general,
non-shop-specific automotive mechanism knowledge (how a blown head gasket lets coolant and oil
cross-contaminate) — **not** a quotable sourced fact, so the "sourced fact" score above is capped
at partial credit and this pack does **not** claim `EvidenceRecord`-level backing.

- `UNKNOWN`: any Nick's Tire & Auto-specific price, turnaround time, or availability claim. None
  were used in this script by design.
- `UNKNOWN`: whether `FactChannel` covers "reel" content at all — per the skill, it currently
  only covers `sms | voice | web`, so no fact here is channel-cleared for video regardless.
- **Safety-critical framing, handled deliberately:** a real head gasket failure can lead to
  catastrophic engine damage (overheating, hydrolock) if driven on. The script avoids diagnosing
  or alarming ("your engine is dying") and avoids telling the viewer to keep driving — it names
  the two visible clues and routes to "stop by," which is directionally safe advice without a
  guarantee or a scare claim. No repair cost, timeline, or severity estimate is stated.
- Claim-safety wording used throughout: *can point to*, *worth checking*, *one clue*, *does not
  guess*, *stop by and we'll take a look* — all on the approved soft-language list in
  `facelessReelStudio.ts`. No price, no guarantee, no fearmongering language.

## 4. Production pack — script (word-for-word, timed)

Total runtime: 33s (7 motion beats @ ~3-4s each + 3s SAVE freeze). 9:16, muted-first with
burned-in captions (see `captions.srt`).

| Beat | Time | Shot (motion-first, faceless) | Higgsfield/Seedance-style prompt | VO (word-for-word) |
|---|---|---|---|---|
| 1 — HOOK | 0:00-0:04 | Close-up: thick white smoke rolling continuously from a car tailpipe at idle, cold morning light | `close up shot of a car tailpipe at idle, thick white smoke rolling out continuously, cold morning light, condensation visible, photorealistic, cinematic` | "White smoke from your tailpipe that doesn't stop after a minute? Worth checking before you drive further." |
| 2 | 0:04-0:09 | Close-up: engine oil filler cap being lifted off, revealing a pale, frothy, milkshake-colored residue under the cap | `extreme close up of a car engine oil filler cap being lifted off, the underside coated in pale frothy milkshake-colored residue, engine bay lighting, macro detail, photorealistic` | "One clue: pop the oil cap. If it looks like a milkshake instead of black oil, that's coolant mixing in." |
| 3 | 0:09-0:14 | Macro cutaway-style shot: a thin cross-section view of an engine block gasket surface with a visible gap/failure point between cylinder and coolant passage | `macro cutaway diagram-style shot of an engine cylinder head gasket surface, a visible thin gap between the cylinder bore and an adjacent coolant passage, clean technical lighting, photorealistic illustration style` | "The head gasket seals coolant and combustion completely apart. When it fails, the two start mixing." | 
| 4 | 0:14-0:19 | Close-up: coolant reservoir tank with unusual bubbling / rising fluid level at idle | `close up of a translucent car coolant reservoir tank, coolant fluid visibly bubbling and slowly rising with the engine idling, engine bay background, photorealistic` | "Coolant that keeps disappearing, or bubbles in the overflow tank at idle, is a second clue pointing the same direction." |
| 5 | 0:19-0:24 | Close-up: exhaust tailpipe again, sweet-smelling steam-like vapor distinct from normal exhaust, sunlight backlighting the vapor | `close up backlit shot of vapor and light smoke exiting a car exhaust tailpipe, sunlight catching the vapor trail, outdoor daylight, photorealistic` | "Sweet-smelling white vapor, not black or blue smoke — that's the coolant burning off inside the cylinder." |
| 6 | 0:24-0:27 | Wide motion: dipstick being pulled and wiped clean against a white cloth, showing the oil's true color and texture | `close up of an engine oil dipstick being wiped against a white cloth, showing oil color and texture, garage lighting, photorealistic, no hands or human figures visible` | "One clue alone doesn't confirm it — we check both the oil and the coolant before we guess." |
| 7 — CTA / SAVE freeze | 0:27-0:30 (+3s freeze to 0:33) | Wide static hold: clean, dry automotive service bay under bright shop lighting, no signage/logo visible | `wide static shot of a clean automotive service bay interior, bright even lighting, no visible signage, logos, or text, photorealistic, held static frame` | "Stop by and we'll take a look." |

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

## 5. Credit-risk and fallback routing

No generation call was made — no credentials were present to make one, and no local render
binary exists in this session — so no real spend occurred this run. For reference against
`generationLedger.ts` if this pack is later approved and rendered on a real session:

- If routed through `template_stock` (prod's current pinned `REEL_VIDEO_PROVIDER` per
  `docs/operations/REEL-PIPELINE.md`, **not verified live this run** — flagged `UNKNOWN`):
  estimated cost `$0` (local ffmpeg lane, `COST_ESTIMATES_USD.template_stock_clip`).
- If routed through Higgsfield/Seedance: 7 beats x `$0.25` ASSUMPTION-labeled estimate =
  **~$1.75**, before any paid repair pass. This is an operator-tunable estimate in source, not a
  metered price — do not quote it as exact.
- Today's `autonomy_policy_versions` limits and the day's `RESERVATION_FEED_CAP` /
  `RESERVATION_SPACING` counters were **not read** this run (prod DB) — `UNKNOWN` whether today's
  feed-post cap (2/day) or spacing (3h) has room, especially given 6 other reel-pack PRs already
  opened today. Check before enqueueing.

## 6. Audio / music rights

**Real gap, not filled here.** This repo has no music-rights ledger. Recommend a royalty-free bed
(e.g. YouTube Audio Library, Pixabay Music) chosen and license-screenshotted by the human editor
at assembly time — do not treat any specific track as pre-cleared. VO in this pack is text-only
(no TTS was run — no TTS credential is present in this session either); if TTS is added later,
route through `reelVoice.ts`'s existing fail-closed contract per
`nickstire-verifier-reel-pipeline`, don't hand-generate ad hoc.

## 7. QA matrix

| Gate | Result | Basis |
|---|---|---|
| Render-integrity (duration/frame-count/motion-MD5) | `UNKNOWN` | No file was rendered this run — nothing to ffprobe (and no ffmpeg binary present) |
| Rendered QA / vision critic (`renderedQa.ts`) | `UNKNOWN` | No job row exists; nothing to score |
| Consolidated publish gate (`evaluateReelPublishGate`) | `UNKNOWN` | Not invoked — no job to evaluate |
| Repetition ledger (`getRecentReelSignals`) | `UNKNOWN` | Prod DB read skipped this run; substituted with directory + open-PR check (§1) |
| Claim safety (`facelessReelStudio.ts` validators) | `PASS` (manual read, not the real validator function) | Script uses only approved soft-language phrases, no price/guarantee/fear language, no instruction to keep driving |
| Motion-first / faceless | `PASS` (manual read) | Every beat prompt is scene-only; standing negative prompt excludes people/text/logos |

## 8. IG/FB copy + hook/CTA variants

**Primary caption:**
> White smoke from your tailpipe that doesn't clear after a minute? Check your oil cap — if it
> looks like a milkshake instead of black oil, that's coolant mixing in. One clue alone doesn't
> confirm it, but both together are worth a look. Stop by and we'll take a look. 🔧🚗

**Hashtags:** #CarMaintenance #HeadGasket #CarCare #EuclidOhio #NicksTireAndAuto #CarProblems
#AutoRepair #EngineTrouble

**Ad-ready variant A (curiosity hook):**
- Hook: "That white smoke isn't always the weather."
- Caption: "Persistent white smoke plus a milky oil cap can point to coolant and oil mixing where
  they shouldn't. Two clues, one quick check."
- CTA: "Stop by and we'll take a look — no guessing."

**Ad-ready variant B (relatability hook):**
- Hook: "Pop your oil cap before your next oil change."
- Caption: "Frothy, pale residue under the cap is a clue worth checking — especially paired with
  white smoke at startup."
- CTA: "Worth a quick look — swing by."

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY`: self-estimated quality score (61/70,
excluding the tournament line) is below the 70-point floor the real server-side scorer enforces,
driven mainly by the "sourced fact" dimension having no `EvidenceRecord`/`businessFacts`
citation. A human should either accept the mechanism-only framing as-is or route it through the
real brief-gen/evidence pipeline before this is enqueued, rendered, or published. No render, no
publish, no spend, no prod DB write occurred producing this pack. This session additionally
verified — not assumed — that it had zero credentials for Higgsfield, the admin API, the
database, Meta/Instagram, or any TTS provider, and no local render binary (`ffmpeg`) or editing
tool (CapCut) installed; the `BLOCKED: NO MOTION ROUTE` alternative was available and this pack
is the deliberate choice of the full-pack branch instead, per the skill's explicit either/or rule.
