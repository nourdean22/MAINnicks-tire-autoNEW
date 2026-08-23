# Reel production pack — "Rotten egg smell from the exhaust: catalytic converter running rich" (2026-08-22)

Scheduled-task run · 2026-08-22 · mode `SCHEDULED`/`PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **ROTTENEGG**

**No generation, DB read, or publish call was made against production this
run.** This is a scheduled/automated firing with no live operator present.
The operator skill's hard rule is explicit that a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and that a
repetition-ledger/quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.

**Backlog status — better than the last several packs reported.** As of
this run: **70 merged reel-pack topics** on disk (spanning 2026-08-14
through today) and **exactly 1 open, unmerged draft PR** (#1782, "worn
motor mount clunk on acceleration," opened 2026-08-22 20:36Z). The prior
pack (#1778, this same date) reported 8 open drafts from 2026-08-21;
7 of those 8 have since merged. Review is keeping pace with generation
right now — this pack does not re-raise the backlog concern that six
consecutive prior packs flagged, because the current data no longer
supports it. Worth a periodic re-check, not an alarm this run.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops
short of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`)
and short of any live read against the production TiDB database.

**Capabilities probed this run — all read directly, not assumed:**

| Capability | Status this run | Basis |
|---|---|---|
| Running app server / `getHiggsfieldAccountHealth()` | **Not available** | No server process in this session; fresh repo checkout, not the running app. |
| `HIGGSFIELD_*` / `ADMIN_API_KEY` / TTS credentials | **Not present** | `env \| grep -iE "higgsfield\|meta\|instagram\|admin_api_key\|openai\|elevenlabs\|chatgpt"` returned nothing in this session's shell. |
| `DATABASE_URL` (prod TiDB) | **Not present** | Not set in this session's shell; only `apps/nickstire/.env.example` exists, no real `.env`. |
| `ffmpeg` (local render lane) | **Not present** | `which ffmpeg` returned nothing — the free `template_stock` assembly lane is not runnable from this session either. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `apps/nickstire/docs/operations/REEL-PIPELINE.md` states prod is pinned to **`template_stock`** as of its last-verified date. Not re-confirmed live this run. |
| `REEL_GENERATION_ENABLED` / `REEL_AUTOPOST_ENABLED` | Not read live | No server process to query. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | No live server + blocked by the operator skill's hard rule for a scheduled firing regardless. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| ChatGPT / external LLM | N/A | This session's own model wrote the script and prompts below — no external LLM call was made or needed. |
| CapCut / GUI editor | Not available | No GUI tool in this environment; §4 assembly instructions are written for a human (or ffmpeg) to execute manually. |

**Conclusion: this run has zero live motion route.** Per the skill's
"Producing a pack when the motion route is unavailable" section, the correct
output is a full production-ready pack — not a claimed render, and not a
silently weaker deliverable. **No MP4 exists.**

**Repetition check — file + PR search (not the live `reel_jobs` table,
which this session cannot reach):**

    ls apps/nickstire/docs/reel-packs/ | grep -i "rotten\|sulfur\|exhaust-smell\|catalytic"
        → only 2026-08-21-catalytic-converter-theft-prevention (theft prevention,
          a different failure mode entirely — not a duplicate)
    search_pull_requests "repo:.../mainnicks-tire-autonew is:pr is:open reel pack in:title"
        → 1 open draft (#1782, worn motor mount clunk — unrelated topic)

No prior pack (merged or open) covers exhaust sulfur smell / converter
running rich. Confirmed non-duplicate.

---

## 2 · Candidate concepts and scores

Three candidates considered, scored 0-5 on five dimensions (Hook Strength,
Diagnostic Clue Value, Faceless Visual Feasibility, Claim-Safety Margin,
Freshness vs. the 71-topic corpus on disk):

| Candidate | Hook | Clue Value | Visual Feasibility | Claim Safety | Freshness | Total /25 |
|---|---|---|---|---|---|---|
| **A. Rotten egg exhaust smell — converter running rich** (selected) | 4 | 5 | 4 | 5 | 5 | **23** |
| B. Battery light on dash *while driving* (alternator vs. belt) | 4 | 4 | 3 | 5 | 4 | 20 |
| C. Steering wheel vibrates only at highway speed (balance vs. bent rim) | 3 | 4 | 3 | 5 | 3 | 18 |

- **A wins** on freshness (no smell-based converter topic exists in the
  corpus; distinct from the theft-prevention converter pack) and clue value
  (timing-of-smell as a diagnostic branch point is concrete and teachable).
- **B parked** — a real gap in the corpus (existing battery topics cover
  won't-start and terminal corrosion, not the warning light appearing
  mid-drive) but visual feasibility is lower: an alternator failure has no
  distinctive faceless B-roll beyond a generic dash light, which the
  negative-prompt rule (no on-screen text/logos) makes harder to stage
  without implying a real dashboard graphic.
- **C parked** — closest overlap risk with existing `balance-vs-alignment`
  and `warped-rotor-brake-shake` packs; still distinct (speed-dependent vs.
  brake-dependent vibration) but scored lowest on freshness for that reason.

---

## 3 · Claim evidence

- **Dynamic facts (price, hours, policy):** none used in this script — no
  `businessFacts.ts` read needed; the CTA uses only the already-approved
  "free check" phrasing (exact match to `SOFT_DIAGNOSTIC_ALLOWED` /
  `FORBIDDEN_CLAIM_PATTERNS` exception in `facelessReelStudio.ts`), not a
  price or hours claim.
- **Claim-level evidence (mechanic truth):** no `EvidenceRecord` in
  `evidenceResolver.ts` was queried — this session has no DB access,
  matching the gap prior packs have reported. The catalytic-converter/
  oxygen-sensor/rich-mixture relationship stated in the script is standard
  automotive-diagnostic knowledge, not a sourced-and-cited fact; scored 0/10
  on `sourcedFact` in the self-estimate for exactly that reason (see
  `brief.json`).
- **Reel channel gap:** as prior packs note, `FactChannel` in
  `businessFacts.ts` is `"sms" | "voice" | "web"` only — no `"reel"` channel
  exists yet, so even if a fact were pulled from that store it would not be
  channel-cleared for public video use. `UNKNOWN`/not applicable here since
  no store fact was used.
- **Claim-safety self-check:** narration and CTA checked by hand against
  `FORBIDDEN_CLAIM_PATTERNS`, `OVERDIAGNOSIS_PATTERNS`, and
  `FEARMONGER_PATTERNS` in `client/src/lib/facelessReelStudio.ts`. No price
  claim (`PRICE_CLAIM_PATTERN`), no guarantee, no "you need," no "your
  converter is broken," no fear-leverage language. "Can point to" and "free
  check" both match the explicitly approved phrasing list.
- **Local/weather/event claims:** none made.

---

## 4 · Production pack

See `brief.json` (machine-readable, 5-beat storyboard with per-beat
narration, visual prompts, and stock-search terms) and `captions.srt`
(14-cue caption track, 0.000-28.000s).

### Script (word-for-word, timed)

| Beat | Window | Role | Narration |
|---|---|---|---|
| 1 | 0:00-0:04 | HOOK | "That rotten egg smell from your exhaust isn't your imagination." |
| 2 | 0:04-0:09 | SETUP | "It usually points to the catalytic converter running rich, burning more fuel than it should." |
| 3 | 0:09-0:17 | VALUE | "A failing oxygen sensor or a leaking injector can push extra fuel through, and the converter can't burn off the sulfur fast enough. That smell is the clue." |
| 4 | 0:17-0:23 | VALUE | "When it shows up can point to which part's involved: right after startup, only at idle, or all the time." |
| 5 | 0:23-0:28 | CTA | "Don't guess which part. Nick's Tire and Auto offers a free check on the sensors and converter to find the real cause." |

### Asset list

No stock footage was licensed or downloaded this run (no live asset-search
tool connected). Per-beat `stockSearchTerms` in `brief.json` are search
queries for a human (or a connected stock library) to source clips against —
not resolved URLs. Standing negative prompt for any generative fallback:
`faces, hands, human figures, on-screen text, logos, watermarks, subtitles`.

Music: **no track assigned** — see §6.

### Editing instructions (manual — CapCut, Premiere, or ffmpeg)

1. Trim/arrange 5 clips to the exact `windowSec` ranges in `brief.json`
   (0-4, 4-9, 9-17, 17-23, 23-28s) — total runtime 28s.
2. Burn in `captions.srt` as bottom-third captions, bold sans-serif,
   high-contrast (white text, black outline or semi-opaque bar) — the reel
   must be fully legible muted (`mutedFirst` gate).
3. Straight cuts between beats, no crossfades — matches the render-integrity
   contract's motion-proof expectation (distinct frames per beat, not a
   dissolve that blurs the cut).
4. Beat 5's final frame should visually echo beat 1's tailpipe framing
   (same close-up angle) to close the loop for replay — both beats use
   matching `visualPrompt` framing in `brief.json` for this reason.
5. Add voiceover once generated (see §6/§7 for what's still required before
   that step is real, not simulated).
6. Export: **MP4, H.264, 1080x1920 (9:16), 30fps**, target file size under
   platform limits for a 28s Reel.

### Posting specs

- **Platform:** Instagram Reels + Facebook, `@nicks_tire_euclid`
- **Dimensions:** 1080x1920, 9:16
- **Duration:** 28s (within the 15-60s target)
- **Format:** MP4, H.264, 30fps
- **Hashtags (suggested, not verified against a live IG hashtag tool this run):**
  `#NicksTireAndAuto #CarCare101 #CarSmell #CatalyticConverter #EuclidOhio #CarMaintenanceTips`

---

## 5 · Credit-risk and fallback routing

No generation call was made, so **$0 spent this run.** Estimates from
`server/services/generationLedger.ts` `COST_ESTIMATES_USD` for reference if
this pack is later handed to the live pipeline:

- `seedance_clip`: $0.25/clip (labeled ASSUMPTION in source) × 5 beats ≈ **$1.25**
- `template_stock_clip`: **$0** (free local-ffmpeg lane — prod's currently
  pinned route per `REEL-PIPELINE.md`, not re-verified live this run)
- `veo_second_720p`: $0.10/s (not applicable — no Veo route used in this
  concept's plan)

Today's `autonomy_policy_versions` daily cap (`maxGenerationCostPerDayUsd`)
was **not read live** (no DB access this session) — report as `UNKNOWN`,
not assumed to have headroom.

---

## 6 · Audio and music rights

**No rights ledger for music exists in this repo** (same gap prior packs
have flagged — confirmed still true, not re-derived from memory this run).
No music bed is assigned to this pack; `musicBed.status: "none assigned"`
in `brief.json`. Voiceover route (`reelVoice.ts`, Google Neural2 or
ElevenLabs) is named but **not called** — no TTS credential/tool was
available in this session, and calling a real TTS service from an
unattended scheduled run would itself be a live-generation action the
skill's hard rule blocks.

---

## 7 · QA matrix

| Gate | Result | Basis |
|---|---|---|
| Rendered QA / vision critic (`renderedQa.ts`) | `BLOCKED` | No render exists to critique — no motion route this run. |
| Repair routing (`repairRouter.ts`) | `BLOCKED` | No job to repair. |
| 7-way automation decision (`qualityAutomation.ts`) | `BLOCKED` | No job row exists. |
| Consolidated publish gate (`qualityGate.ts`) | `BLOCKED` | Never called — no render, no publish attempt. |
| `calculateReelQualityScore()` (75-pt floor, min 70) | `UNKNOWN` (self-estimate only) | Function not invoked live; hand-scored 55/75 in `brief.json` — **below the 70 pass floor**, driven entirely by the 0/10 `sourcedFact` dimension (no live `EvidenceRecord`) and 0/5 `winningConceptFloor` (tournament scoring not run). Both gaps are about verification infrastructure this session cannot reach, not about the script's content quality. |
| Render-integrity gate (frame-count/motion-proof, `reelAssembly.ts`) | `BLOCKED` | No rendered file exists to probe. |

---

## 8 · Social copy

**Instagram/Facebook caption:**

> That rotten egg smell from your exhaust? It usually means the catalytic
> converter is running rich. When it shows up — right at startup, only at
> idle, or all the time — can point to which part's behind it. Don't guess.
> Nick's Tire and Auto offers a free check on the sensors and converter to
> find the real cause. 📍 Euclid, OH
> #NicksTireAndAuto #CarCare101 #CarSmell #CatalyticConverter #EuclidOhio

**Ad-ready variant 1 (curiosity hook):**
- Hook: "Why does your exhaust smell like rotten eggs?"
- Caption: "It's not the gas station's fault. A rich-running catalytic
  converter can point to a failing sensor — and the fix depends on which one."
- CTA: "Free check on the sensors and converter — stop by and we'll take a look."

**Ad-ready variant 2 (timing-clue hook):**
- Hook: "Only smells bad at idle? That's your clue."
- Caption: "When the smell shows up tells you where to look — startup,
  idle, or constant all point to different parts."
- CTA: "Don't guess which part. Free check at Nick's Tire and Auto."

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Full production pack complete (script, per-beat visual prompts, captions,
assembly instructions, posting specs, social copy). No generation, DB read,
or publish call was made — this run had zero live motion route and no live
operator authorization, both correctly resulting in a pack rather than a
render or a publish. The self-estimated quality score (55/75) falls below
the 70-point pass floor **only** on dimensions this session cannot verify
live (sourced-fact citation, tournament scoring) — a human reviewer with DB
access should re-run `calculateReelQualityScore()` against the live store
before treating this as pipeline-ready, not just PR-ready.
