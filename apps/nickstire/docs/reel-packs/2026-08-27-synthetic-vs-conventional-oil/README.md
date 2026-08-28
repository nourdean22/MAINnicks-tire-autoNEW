# Reel pack — "Synthetic costs more at every oil change — is it actually worth it?"

Produced by a **scheduled task** firing (2026-08-27), no live operator present. Per
`.claude/skills/nickstire-reel-operator/SKILL.md`'s hard rule, a stored scheduled prompt never
authorizes a real `/api/admin/reel-canary` generate/publish call or a live production-DB read.
This session made none of those calls. Deliverable is a full production-ready **pack**, not a
claimed render — **no MP4 exists.**

## 1. Mode, timestamp, connected capabilities

- Mode: `SCHEDULED` (maps to `INTELLIGENCE` per the skill's mode table — research/score/pack only).
- Timestamp: 2026-08-27 (session clock).
- Capability check this session:
  `env | grep -iE 'REEL_|HIGGSFIELD|ADMIN_API_KEY|DATABASE_URL|OPENAI|ANTHROPIC|META_|INSTAGRAM|FACEBOOK|TTS|CAPCUT'`
  returned no credential (only unrelated proxy/`JAVA_TOOL_OPTIONS` lines matched, none of them a
  Higgsfield/admin/DB/TTS/Meta secret). Also checked local binaries: `ffmpeg` — **missing**, `gh` —
  **missing**. Result: **BLOCKED: NO MOTION ROUTE** this session → full pack produced per the
  skill's explicit fallback, not a downgraded stills-only asset. `getHiggsfieldAccountHealth()` was
  **not called** (no running server, no credentials, no network path to it).
- Per `apps/nickstire/docs/operations/REEL-PIPELINE.md` (rank-4 doc, not verified live this
  session): prod currently pins `REEL_VIDEO_PROVIDER=template_stock` (the free local-ffmpeg lane),
  not Higgsfield/Seedance — so if this pack is fed to the real pipeline today, per-clip generation
  cost is expected to be **$0**, not the `$0.25` Seedance estimate. Treat this as inherited
  doc-truth, not a live read.
- Repetition-ledger context: `getRecentReelSignals()` was **not called** (no `DATABASE_URL` this
  session — a real prod-DB read is out of scope for an unattended scheduled run per
  `prod-db-guard`). Substituted the best available offline check instead:
  - **Backlog check first, per the skill's duplicate-check step:** `ls
    apps/nickstire/docs/reel-packs/` → **~129 merged pack directories** (`2026-08-14` through
    `2026-08-27`). `mcp__github__search_pull_requests(repo:nourdean22/MAINnicks-tire-autoNEW is:pr
    is:open reel in:title)` → **3 open PRs**: #1927 (steering wheel vibration at highway speed),
    #1932 (engine pinging/knocking under acceleration), #1941 (grinding brakes on first stop of the
    day — rotor rust). All three created within the last ~3 hours.
  - **This is a dramatic drop from the 22 open PRs the most recent `BACKLOG-STATUS-2026-08-27-1130`
    note reported as stuck for 45+ hours.** `mcp__github__search_pull_requests(is:merged reel
    in:title)` → **191 total merged**, with a visible cluster of ~10+ PRs all closed within the same
    minute (`2026-08-27T12:56–12:57Z`) — direct evidence a batch-merge/close sweep ran between the
    last status note and now. The standing recommendation ("batch-review the pending PRs") was
    acted on. This run is **not** a repeat of the stuck-backlog finding — 3 open, all fresh, is
    normal cadence, not a queue needing another status-only PR.
  - Checked this pack's topic (full synthetic vs. conventional motor oil — when the switch actually
    matters) against the ~129 merged topics and the 3 open ones — **no overlap found.** Existing oil
    topics are `oil-change-intervals` (interval cadence, not oil type), `oil-dipstick-color-check`
    (visual color diagnosis, not synthetic-vs-conventional), and
    `oil-pressure-light-flicker-idle` (a pressure-sensor/pump symptom, not oil selection). None of
    the three frames the synthetic-vs-conventional choice itself, so this pack is distinguishable.

## 2. Candidate scores and selected concept

Single-concept run (topic backlog is not the binding constraint this run — see §1). Scored against
the skill's rubric out of 5 per dimension, self-estimated (no live critic panel — no DB/tournament
access this session):

| Dimension | Score | Note |
|---|---|---|
| Scroll-stop hook | 4/5 | "Costs twice as much — is it worth it?" is a real, common cost-question hook, though less pattern-interrupt than a two-opposite-symptoms format |
| Distinct decision framing | 5/5 | Frames a purchase decision (which oil to ask for) rather than a fault-diagnosis symptom — different shape from every existing oil pack |
| Claim safety | 5/5 | No price, no guarantee, no invented interval numbers — soft language only, defers the real answer to the owner's manual |
| Novelty vs. existing ~129 topics | 5/5 | No overlap found (see §1) |
| Producibility (faceless, no live footage needed) | 5/5 | All beats are static product/macro shots or plausible stock B-roll; no dealership-specific footage required |

Selected: **"Synthetic costs more at every oil change — is it actually worth it?"** No runner-up
concept was generated — single-topic run, consistent with sibling packs in this backlog window.

## 3. Claim evidence

- No `EvidenceRecord` was read this session (`evidenceResolver.ts` requires the live DB — not
  available). Every mechanical claim below is **general automotive-maintenance knowledge** (full
  synthetic oil resists thermal breakdown better than conventional oil under sustained heat and is
  commonly specified by manufacturers for turbocharged engines and severe-duty/short-trip driving
  cycles; the manufacturer-specified interval and oil grade live in the vehicle's owner's manual),
  not a shop-specific sourced fact. `entailment` status: **`not_evaluated`** — mark `UNKNOWN`, not
  `supported`.
- No `businessFacts` row was read (no DB access). Per the skill's documented gap, `FactChannel` has
  no `"reel"`/`"social"` scope yet, so no business fact (hours, pricing, warranty terms) is cleared
  for this script regardless — the script deliberately contains **zero** shop-specific facts: no
  price, no hours, no phone number, no specific interval number, no warranty claim.
- No local/weather/event claim is made — none needed for this topic.
- **UNKNOWN, explicitly:** live entailment status of the synthetic-vs-conventional thermal-stability
  claim; whether Nick's Tire & Auto specifically stocks both oil types and performs owner's-manual
  cross-checks at intake (near-certain for a general repair/tire shop, but not confirmed against a
  live `business_facts` row this session).

## 4. Production pack

### Script (word-for-word, timed)

| Time | Beat | Narration |
|---|---|---|
| 0:00–0:04 | HOOK | "Full synthetic costs more at every oil change — is it actually worth it?" |
| 0:04–0:09 | CLARIFY | "It's not about price. It's about what your engine and your driving actually need." |
| 0:09–0:15 | CONTRAST | "Conventional oil breaks down faster under heat. Synthetic holds up longer between changes." |
| 0:15–0:21 | EXPLANATION | "Turbo engines, and short stop-and-go trips, push oil harder — that's where synthetic can matter most." |
| 0:21–0:26 | SAFE ACTION | "The real answer's in your owner's manual — not a guess at the counter." |
| 0:26–0:30 | BRANDED CTA | "Not sure which one your car needs? Stop by and we'll check. Nick's Tire & Auto." |

Total runtime: 30s (within the 20–35s creative-quality-floor window). Approved soft language used:
*can · worth checking-equivalent ("not a guess") · stop by and we'll check.* No prices, no
guarantees, no invented interval numbers or timelines.

### Per-beat visual prompts (Higgsfield/Seedance-style, faceless)

**Standing negative prompt for every beat:** `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

1. **0:00–0:04** — Split-screen composition: left half a conventional-oil bottle pouring amber oil
   into a funnel, right half a synthetic-oil bottle pouring lighter, clearer oil into a matching
   funnel, both on a clean workbench, static-mounted camera, warm shop lighting. *Split into two
   ~2s sub-shots (conventional pour, synthetic pour) before real generation.*
2. **0:04–0:09** — Close-up on two clear sample cups side by side under a work light, one visibly
   darker than the other; cut to a dipstick being slowly pulled from an engine and held up for
   comparison against the cups. *Split into two sub-shots (cup comparison, dipstick pull).*
3. **0:09–0:15** — Macro shot of oil dripping slowly off a dipstick beside a warm engine bay
   (subtle heat shimmer visible); cut to a close-up of a vehicle's dashboard odometer display with
   mileage numbers visible, ambient dash lighting. *Split into two sub-shots (dipstick drip,
   odometer close-up).*
4. **0:15–0:21** — Wide shot of a turbocharger unit resting on a workbench, slow push-in; cut to a
   static shot through a windshield of brake lights ahead in stop-and-go traffic, dusk lighting.
   *Split into two sub-shots (turbo unit, traffic reflection).*
5. **0:21–0:26** — Close-up, softly out of focus, of an owner's manual lying open on a workbench
   next to both oil bottles from beat 1; slow pull-back revealing a clean, empty service-bay lift
   in the background. *Split into two sub-shots (manual close-up, bay pull-back).*
6. **0:26–0:30** — Branded end-card plate: Nick's Tire & Auto shop bay wide shot, warm daylight,
   static hold. **Real logo and CTA text are composited in post** (ffmpeg overlay), never
   AI-generated — matches the live pipeline's actual contract ("captions and logos are composited
   in post," `REEL-PIPELINE.md` line 81).

**Render-integrity note (not yet satisfied by this pack alone):** the real render-integrity gate
(#800/#801) requires a visual change roughly every 1.5–2.5s and ≥4 distinct source clips. Six ~5s
beats as scripted above are too coarse on their own — recommend the assembler split beats 1–3 and 5
into two sub-shots each (as annotated above) to reach ~10 sub-clips at ~3s apiece before this pack
is fed to real generation. Flagging this explicitly rather than presenting the 6-beat table as
render-ready.

### Assembly instructions (ffmpeg/CapCut)

1. Order clips exactly as beats 1→6 above (after the sub-shot split noted above).
2. Trim each sub-clip to its allotted window; hard-cut or short (≤0.2s) crossfade between beats —
   no `zoompan`/Ken-Burns stills filters (documented cause of the frozen-frame regression in
   `REEL-PIPELINE.md` §"Render-integrity gate").
3. Burn in captions from `captions.srt` (below), bottom-third safe zone, high-contrast style
   matching the account's existing caption preset.
4. Composite the Nick's Tire & Auto logo and CTA text on beat 6 only, in post (not generated).
5. Mix voiceover (TTS, not produced this session — no TTS credential available) as the primary
   audio layer; add a 3s freeze-frame "SAVE" card after 0:30 per the storyboard contract used by
   the render-integrity gate (container duration = beats + 3s freeze ≈ 33s).
6. Export 9:16, 1080×1920, H.264, target ≥30fps throughout (render-integrity gate requires ≥80% of
   expected 30fps frame count).

### Posting specs

- Platform: Instagram Reels (primary), cross-post to Facebook Reels via the same asset.
- Dimensions: 1080×1920 (9:16), MP4, ≤30s target already met.
- Hashtags: `#OilChange #SyntheticOil #CarMaintenance #AutoRepair #CarTips #ClevelandAuto #NicksTireAndAuto #EngineCare`
- Caption (feed): "🛢️ Full synthetic vs conventional oil — is the upgrade actually worth it? It's
  not about price, it's about what your engine and driving style actually need. Not sure which
  one's right for your car? Stop by and we'll check. 🔧"

Two ad-ready hook/caption/CTA variants (per the skill's required-response §8):

- **Variant A (cost-first):** Hook: "Why does synthetic oil cost twice as much — and is it worth
  it?" Caption: "It's not just marketing. Synthetic oil holds up better under heat and stress than
  conventional — especially in turbocharged engines and stop-and-go driving." CTA: "Not sure which
  one your car needs? Stop by — Nick's Tire & Auto."
- **Variant B (owner's-manual-first):** Hook: "Your owner's manual already answered this question."
  Caption: "Synthetic vs conventional oil isn't a guess — it's spec'd by your manufacturer based on
  your engine and how you drive." CTA: "Bring in your manual or just ask — we'll check for you.
  Nick's Tire & Auto."

## 5. Credit-risk and fallback routing

- Per `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live query): `seedance_clip =
  $0.25`, `template_stock_clip = $0`, `veo_second_720p = $0.10`.
- Per `REEL-PIPELINE.md` (rank-4 doc, unverified live this session), prod pins
  `REEL_VIDEO_PROVIDER=template_stock` → **estimated generation cost if run today: $0.00** for
  ~10 sub-clips on the free ffmpeg lane. This is a doc-inherited estimate, not a live balance read.
- `getHiggsfieldAccountHealth().balanceCredits`: **UNKNOWN** — not called this session (no
  credentials, no server).
- Day's `autonomy_policy_versions.limits.maxGenerationCostPerDayUsd` (documented default $10):
  **not read live this session** — treat as UNKNOWN, not assumed available.
- Fallback routing: `REEL_FALLBACK_TO_TEMPLATE_STOCK` behavior not exercised — no generation was
  attempted.

## 6. Audio/music rights status

**Real gap, not papered over:** no music-rights ledger exists in this repo (documented gap in the
`nickstire-reel-operator` skill). No music bed is assigned to this pack. Voiceover-only audio via
TTS (not produced this session — no TTS credential available in this session's environment) plus
captions is the safe default until a rights-tracked bed exists.

## 7. QA matrix

| Gate | Status | Basis |
|---|---|---|
| Brief-time quality score (`calculateReelQualityScore`, 70/75 floor) | **UNKNOWN** (self-estimated ~50/75, see §8) | No live scorer run this session — self-scored against the published rubric, not a substitute for the real function |
| Server re-score at enqueue | **BLOCKED** | No `/api/admin/reel-canary {action:"start"}` call made — no credentials/route |
| Render-integrity gate (#800/#801) | **N/A — not rendered** | No MP4 exists this session |
| Rendered QA / vision critic (`renderedQa.ts`) | **N/A — not rendered** | Same |
| Repair routing / 7-way decision | **N/A** | No job exists to route |
| Consolidated publish gate (`evaluateReelPublishGate`) | **BLOCKED (by absence of a job)** | Cannot evaluate a gate against a nonexistent render — this is the gate's own `unavailable` state, not a silent pass |
| Repetition ledger (`getRecentReelSignals`) | **UNKNOWN (live)** / mitigated offline | Substituted directory + open-PR search per §1; no live DB read |

## 8. Self-estimated quality score (informational only, not a substitute for the real gate)

| Dimension (max) | Est. | Note |
|---|---|---|
| First-frame scroll-stop (10) | 7 | Cost-question hook, real and relatable, but less pattern-interrupt than a two-opposite-symptoms format |
| Muted-first / captions carry meaning (10) | 8 | Captions restate every narration beat |
| Beat structure (5) | 5 | Hook → clarify → contrast → explanation → safe action → CTA, all present |
| Length (5) | 5 | 30s, within 20–35s window |
| Loop (5) | 2 | Not designed for a seamless loop-back; end card is a hard stop |
| Sourced fact (10) | 0 | No live `EvidenceRecord`/`businessFacts` read this session — UNKNOWN, scored 0 not guessed |
| Faceless (10) | 10 | No faces/hands/human figures in any beat prompt |
| Claim safety (10) | 9 | Approved soft language only, no price/guarantee/timeline |
| Keyword (5) | 4 | "synthetic," "oil," "engine," "manual" present in captions |
| Winning-concept floor ≥57/60 (5) | 0 | No tournament/critic run this session — UNKNOWN, scored 0 not guessed |
| **Total** | **50/75** | **Below the real 70/75 floor** — status is `READY FOR HUMAN APPROVAL`, not `PRODUCTION-READY` |

## 9. Final status

**`READY FOR HUMAN APPROVAL`** — not `PRODUCTION-READY` and not `BLOCKED`. The pack is complete
and internally consistent, but three dimensions (sourced-fact backing, live quality re-score,
winning-concept tournament score) require a live-authorized session with DB/API access to close.
No render was attempted, no generation spend occurred, no DB was read, and no publish call was
made. An operator (or a live-authorized session) can feed this topic into the real pipeline via
`POST /api/admin/reel-canary {action:"start", topic:"Synthetic costs more at every oil change — is
it actually worth it?"}` to re-score, render, and move toward publish.

**Operator note:** 3 open, unreviewed `reel pack` draft PRs exist at write time (#1927, #1932,
#1941), all created within the last ~3 hours, plus this run's new PR. This is a normal, healthy
count — a sharp drop from the 22-open/45-hour-stuck state the prior `BACKLOG-STATUS-2026-08-27-1130`
note flagged, with direct evidence (a ~10-PR batch-close cluster at `2026-08-27T12:56–12:57Z`) that
the standing "batch-review the queue" recommendation was acted on. This run does not repeat that
escalation.
