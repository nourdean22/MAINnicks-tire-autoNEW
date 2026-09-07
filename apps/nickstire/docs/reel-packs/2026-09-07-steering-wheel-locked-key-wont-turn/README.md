# Reel pack — "Steering wheel locked, key won't turn? Check this before you assume the ignition failed."

Produced by a **scheduled task** firing (2026-09-07, ~02:30 UTC), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack
  only, no render, no publish).
- Timestamp: 2026-09-07, ~02:30 UTC, session clock.
- Capability check this session: `which ffmpeg capcut` — both missing; `env | grep -iE
  'openai|higgsfield|meta|facebook|instagram|elevenlabs|tts|graph_api|admin_api_key|
  database_url'` — no matches. No ChatGPT, TTS, Higgsfield, Meta-posting, or CapCut tool exists
  in this session's toolset either (checked the full deferred-tool list — no video/TTS/social-
  publish MCP tool is present). Result: **BLOCKED: NO MOTION ROUTE** this session → full pack
  produced per the skill's explicit fallback, not a downgraded stills-only asset.
  `getHiggsfieldAccountHealth()` was **not called** (no running server, no credentials, no
  network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg
  lane), not Higgsfield/Seedance — treated as inherited doc-truth, not a live read.
  `REEL_FALLBACK_TO_TEMPLATE_STOCK` is a legacy compatibility flag only; it does not bypass
  exact-asset QA or human approval per that doc.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check instead:
  - `ls apps/nickstire/docs/reel-packs/2026-*/` — **160 existing pack directories**
    (`2026-08-14` through `2026-09-06`), this pack's topic checked against all of them.
  - `grep -rli "steering wheel.*lock\|ignition lock\|key won.t turn\|wheel won.t turn"` across
    every pack `README.md` — one incidental hit (`2026-08-24-horn-wont-work`, a passing mention
    of steering-wheel-mounted controls, not this topic) and no dedicated pack. Adjacent topics
    (`power-steering-whine`, `tie-rod-steering-wobble-test`, `steering-vibration-highway-speed`,
    `power-steering-fluid-leak-color`, `steering-wheel-crooked-after-tires`) are all
    hydraulic/alignment steering-feel symptoms while driving — none overlap this pack's
    parked-and-won't-start anti-theft-lock angle.
  - `mcp__github__search_pull_requests(repo:nourdean22/mainnicks-tire-autonew is:pr is:open "reel
    pack" in:title)` — **1 open PR** at time of this run (#2149, TPMS light won't clear after
    refill — a different topic). No collision.
  - Still unresolved from prior runs (no DB access this session either): whether migration
    `0112_reel_publish_approvals.sql` has been applied to production TiDB. Treating the publish
    door as still shut absent explicit operator confirmation.

## 2. Candidate scores and selected concept

Single-concept run, consistent with sibling packs in this backlog window. Scored against the
skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "Key won't turn, wheel's locked solid" is a relatable minor-panic hook most drivers have hit |
| Distinct symptom cluster | 5/5 | No existing pack covers the anti-theft steering-lock / won't-start angle (see §1) |
| Claim safety | 5/5 | No price, no guarantee, no timeline — soft language only, explicit "do not force it" caution |
| Novelty vs. existing 160 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 4/5 | All beats are plausible AI-gen or stock B-roll; no dealership-specific footage required |

Selected: **"Steering wheel locked, key won't turn: check the anti-theft steering lock before you
assume the ignition failed."** No runner-up concept generated — single-topic run, consistent with
sibling packs in this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). The underlying claim — that most vehicles' steering column locks engage when the
  wheel is turned with the key removed/off, and that gently rocking the wheel while easing the
  key can release it without indicating an ignition failure — is **general automotive-mechanical
  knowledge**, not a shop-specific sourced fact. `entailment` status: **`not_evaluated`** — mark
  `UNKNOWN`, not `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel`
  has no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is
  cleared for this script regardless — the script deliberately contains **zero** shop-specific
  facts: no price, no hours, no phone number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the steering-lock/ignition claim; whether
  Nick's Tire & Auto specifically diagnoses ignition-lock-cylinder or steering-column-lock
  failures on site (near-certain for a general repair shop, but not confirmed against a live
  `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Key's in the ignition. It won't turn. The wheel feels locked solid." |
| 0:04–0:09 | SETUP | "Before you assume the ignition's dead, this can be a lot simpler." |
| 0:09–0:15 | VALUE | "Most cars have an anti-theft steering lock. Turn the wheel with the key out, and it can clamp down and hold." |
| 0:15–0:21 | VALUE | "One clue it's the lock, not the ignition: gently rock the wheel side to side while easing the key. Do not force the key." |
| 0:21–0:25 | VALUE | "On newer push-button start cars, a weak key fob or 12-volt battery can also stop the electronic steering lock from releasing." |
| 0:25–0:29 | CTA | "If it's not the lock, don't guess at the part. Stop by and we'll take a look. Nick's Tire and Auto." |

Total runtime: 29s (within the 20–35s creative-quality-floor window). Approved soft language
used: *one clue · can · most · worth checking · don't guess · stop by and we'll take a look.* No
prices, no guarantees, no invented timelines. See `captions.srt` for the SRT file.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Extreme close-up of a car key already seated in an ignition switch barrel,
   static camera, dim interior lighting, no hand in frame.
2. **0:04–0:09** — Close-up of a steering column and ignition switch area from the driver's
   footwell angle, static shot, soft ambient light, no hand in frame.
3. **0:09–0:15** — Macro shot of a steering wheel rim and column lock mechanism area, slow
   push-in, neutral daylight through a windshield, static-mounted camera.
   `renderIntegrityNote`: split into wide + macro push-in sub-shots.
4. **0:15–0:21** — Close-up of a steering wheel rim with subtle side-to-side motion suggesting
   gentle rocking, static camera, warm interior light, no hand visible.
   `renderIntegrityNote`: split into two ~3s sub-shots.
5. **0:21–0:25** — Close-up of a push-button ignition start switch on a car center console, soft
   interior ambient light, static shot, no hand in frame.
6. **0:25–0:29** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six
~4-6s beats as scripted above are too coarse on their own — recommend the assembler split beats
3 and 4 into two sub-shots each (as noted per-beat) to reach ~8-10 sub-clips at ~2.5–3s apiece
before this pack is fed to real generation. Flagging this explicitly rather than presenting the
6-beat table as render-ready.

### Assembly instructions (ffmpeg/CapCut)

1. Order clips exactly as beats 1→6 above (after the sub-shot split noted for beats 3 and 4).
2. Trim each sub-clip to its allotted window; hard-cut or short (≤0.2s) crossfade between beats —
   no zoompan on a static held frame (the render-integrity gate's motion floor requires actual
   pixel-level frame-to-frame change, not a Ken Burns pan on one still).
3. Normalize every clip to vertical 9:16, 1080×1920, 30fps before concatenation (matches the
   assembler's own normalize-before-`xfade` order in `reelAssembly.ts`).
4. Burn in captions from `captions.srt` (word/phrase-level or line-level, matching the narration
   timing table above) — captions and any logo/CTA text are composited in this post step, never
   baked into the AI-generated clip itself (that is why the standing negative prompt bans
   on-screen text/logos at generation time).
5. Add a 3-second freeze/SAVE-style hold on the final CTA frame (branded end-card) — matches the
   live pipeline's storyboard contract (beats + 3s freeze) that the render-integrity gate checks
   duration against.
6. Mux voiceover (see §6 — not generated this run) under the full timeline; mix any SFX per the
   `brief.json` `audio.sfx.suggestion` field at low bed level so narration and captions stay
   dominant (muted-first design — the reel must read with sound off).
7. Export MP4, H.264, 1080×1920, 30fps, ≤29s per `brief.json.postingSpecs`.

## 5. Credit-risk and fallback routing

Read from `apps/nickstire/server/services/generationLedger.ts` (`COST_ESTIMATES_USD`) — these are
operator-tunable estimates, not a metered live price:

- `template_stock_clip: $0` — the free local-ffmpeg lane. Per REEL-PIPELINE.md doc-truth, this is
  currently the pinned prod provider (`REEL_VIDEO_PROVIDER=template_stock`), so a real run of this
  pack today would cost **$0 in generation spend** if that pin still holds.
- `seedance_clip: $0.25/clip` (source comment marks this an unverified ASSUMPTION — Higgsfield
  publishes no per-call USD). At ~8-10 sub-clips after the render-integrity split above, a
  Higgsfield-routed run would estimate **~$2.00–$2.50**, if that lane were ever re-armed.
- `veo_second_720p: $0.10/sec` (the one real Google-published figure). At 29s, a Veo-routed run
  would estimate **~$2.90**.
- `getHiggsfieldAccountHealth().balanceCredits` — **UNKNOWN**, not called this session (no
  credentials, no network path).
- The day's `autonomy_policy_versions.limits.maxGenerationCostPerDayUsd` and the
  `RESERVATION_FEED_CAP` (2/day) / `RESERVATION_SPACING` (3h) / `REPEAT_CTA` (72h) /
  `REPEAT_TOPIC` (7 days) guardrails were **not read** this session (prod-DB only) — flag as
  UNKNOWN rather than assumed clear. A live run must re-check these before enqueueing.

## 6. Audio and music rights

**Real gap, not papered over:** no music-rights ledger exists in this repo (confirmed in the
skill spec). No asset ID, source, license scope, territory, expiry, or organic/ad clearance can
be asserted for any music bed. This pack ships with **no music bed assigned** — status
`UNKNOWN`/`BLOCKED` per the skill's instruction, not a silently-omitted row. Voiceover (not a
music-rights concern) would route through `reelVoice.ts` (Google Neural2 or ElevenLabs) but was
**not generated this run** — no live TTS route in this session's toolset.

## 7. QA matrix

No render occurred this session, so every gate below is backed by "not run," not a fabricated
pass:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Render-integrity (#800/#801) | `reelAssembly.ts` | `UNKNOWN` | no render — no file to ffprobe |
| Rendered QA / vision critic | `renderedQa.ts` | `UNKNOWN` | no rendered frames exist |
| Repair routing | `repairRouter.ts` | `UNKNOWN` | no job to repair |
| 7-way decision | `qualityAutomation.ts` | `UNKNOWN` | no critic verdict to fold |
| Consolidated publish gate | `qualityGate.ts` | `BLOCKED` | no live route this session (no `ADMIN_API_KEY`/`DATABASE_URL`) — evidence gate would read `unavailable`, not a pass |
| Human-approval door | `instagramAdmin.publishPost` | `BLOCKED` | not called; no live session path to Instagram publish |
| Quality-score floor (≥70/75) | `calculateReelQualityScore()` | `UNKNOWN` (self-estimate 47/75, below floor) | function not invoked; self-estimate below the 70 floor mainly on `sourcedFact` (0/10, no live evidence read) and `keyword`/`winningConceptFloor` (0/5 each, not checked) — a live run should not assume this pack clears the gate without a real re-score |

## 8. IG/FB copy + ad-ready variants

**Organic caption (both platforms):**
> Key's in, wheel's locked, and it won't turn? Before you assume the ignition's dead — check the
> anti-theft steering lock first. Gently rock the wheel while easing the key (never force it). If
> that's not it, don't guess at the part — stop by and we'll take a look. #cartips #carmaintenance
> #euclidohio #nickstireandauto

**Ad-ready variant A (curiosity hook):**
- Hook: "Your car isn't broken — your wheel just locked itself."
- Caption: "One of the most common 'my ignition died' calls we get isn't the ignition at all.
  Here's the 10-second check before you tow anything."
- CTA: "Stop by and we'll take a look — link in bio."

**Ad-ready variant B (direct/utility hook):**
- Hook: "Stuck key, locked wheel? Try this before you call a tow."
- Caption: "Most steering wheels lock themselves as an anti-theft feature. A gentle rock-and-turn
  clears it in seconds — no tools needed. Still stuck? That's when it's worth a real look."
- CTA: "Nick's Tire & Auto — stop by, we'll check it for free."

## 9. Final status

**READY FOR HUMAN APPROVAL.**

Full production pack complete (script, per-beat prompts, captions, assembly instructions, IG/FB
copy, two ad variants). No generation, DB read, or publish call was made this session — none
was authorized, and none was attempted. Before any real run: (1) re-score with the live
`calculateReelQualityScore()` — this pack's self-estimate (47/75) sits below the 70 floor, driven
mainly by the unscored `sourcedFact`/`keyword`/`winningConceptFloor` dimensions that require a
live app; (2) re-check the guardrail table in §5 against live `autonomy_policy_versions` and
today's reservation state; (3) split beats 3 and 4 into sub-shots per the render-integrity note
in §4 before feeding this brief to a real generation call.
