# Reel production pack — "Oil change intervals (the 3,000-mile myth)" (2026-08-17)

Scheduled-task run · 2026-08-17 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **OIL-INTERVAL**
· source: [`REEL-SLATE-2026-07-31.md`](../../REEL-SLATE-2026-07-31.md) item #9

**No generation, DB read, or publish call was made against production this run.**
This is a scheduled/automated firing with no live operator present — the operator
skill's hard rule is explicit that a stored scheduled prompt does not authorize
`reel-canary` generation or publish calls, and that repetition-ledger/quality-score
reads against the live database are themselves a production read, not a free
action. This session made none of those calls. See §1 and §9.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops short of
any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`) and short of
any live read against the production TiDB database.

**Capabilities — not probed this run, stated as such rather than assumed:**

| Capability | Status this run | Why |
|---|---|---|
| `getHiggsfieldAccountHealth()` (creds/balance) | Not called | Requires a live server process + `HIGGSFIELD_API_KEY`; this is a Claude Code repo session, not the running app. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md:32` states prod is pinned to **`template_stock`** (verified there 2026-08-11), i.e. the free local-ffmpeg lane, not Higgsfield/Seedance. Treat as last-known, not live-confirmed. |
| `REEL_GENERATION_ENABLED` | Not read live | Gate on the cron pulse job; not queried this run. |
| Voiceover TTS (`reelVoice.ts` → Google Neural2 / ElevenLabs) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | Blocked by the hard rule above for a scheduled firing. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |

**Repetition-ledger context (`getRecentReelSignals()`):** not queried — that
function reads the live `reel_jobs` table on production TiDB. Instead, checked
both required surfaces per the skill's own instruction (a directory listing
alone is blind to unmerged work):

- `ls apps/nickstire/docs/reel-packs/` — 5 merged packs: penny test (slate #1),
  squealing vs. grinding brakes (slate #2), tires have an expiration date
  (slate #6), battery warnings/summer-heat myth (slate #12), tread fingerprint
  (not on the slate).
- `gh`-equivalent PR search (`mcp__github__search_pull_requests`,
  `is:open is:pr "reel pack" in:title`) — **9 open draft PRs**, none merged:
  #1614 wheel-bearing-hum (slate #8), #1615 check-engine-light (slate #7),
  #1616 balance-vs-alignment (slate #4), #1617 spare-tire-mileage (slate #5),
  #1618 coolant-color (slate #18), #1619 cabin-vs-engine-air-filter
  (slate #14), #1620 noises-that-mean-stop-driving-now (slate #19),
  #1621 repair-authorization-questions (slate #20), #1622 why-car-pulls
  (slate #13).

Cross-referencing both lists against the slate's own 20 items: 1, 2, 4, 5, 6,
7, 8, 12, 13, 14, 18, 19, 20 are merged or already in an open PR. Slate item
**#9, oil change intervals**, is not covered by either list, so it was
selected for this run (see §2). This is a file-system + PR-search check, not a
substitute for the real ledger — an actual `reel_jobs` row (e.g. a rejected
brief that never got a pack written) would not show up here, so treat this as
directional, not a guarantee of zero repetition.

**Flag for the operator, not a decision made unilaterally this run:** 9 open
draft PRs have accumulated with none merged, created roughly hourly between
2026-08-16 22:38 and 2026-08-17 06:59 UTC. That cadence is fast enough that a
human is very unlikely to be triaging/merging between runs, which is exactly
the condition that produced the earlier "three runs, two on one topic" defect
(#1611) even after the directory-collision fix. The dedupe check in this pack
covers today's queue correctly, but the underlying rate of unreviewed PR
creation is a separate problem this pack does not fix.

---

## 2 · Candidate scores and selection

Scored against the slate's remaining topics not yet merged or already open as
a PR (today is 2026-08-17 — mid-August, so winter/cold-weather items #3, #11
stay deprioritized as seasonally premature even though open):

| # | Topic | Hook strength | Evergreen? | Selected? |
|---|---|---|---|---|
| 9 | Oil change intervals | Moderate-strong — myth-correction hook ("3,000-mile sticker") that directly contradicts a belief most drivers hold | Yes | ✅ **Selected** |
| 10 | Pothole damage you cannot see | Moderate — diagnostic-clue hook, less universally believed-wrong | Yes | Parked |
| 15 | What "you need struts" means | Moderate — trust/jargon-demystify hook | Yes | Parked |
| 16 | Tread depth for rain vs snow | Weak-moderate — informational, lower urgency in August | Yes (seasonal lean) | Parked |
| 17 | Tire rotation | Weak — informational, lower urgency | Yes | Parked |

Oil change intervals was selected because it was explicitly flagged as the
strongest runner-up in the prior (2026-08-16) brake pack's own candidate table
("myth-correction hook") and is unambiguously not covered by either the merged
directory or the 9 open PRs — the cleanest, least-ambiguous pick this run.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "The 3,000-mile oil sticker is a sales tool, not an engineering spec" | `REEL-SLATE-2026-07-31.md` item #9 (pre-existing, shop-curated slate copy — the same source the 2026-08-16 brake pack drew its script from for slate item #2) | **Grounded in a shop-curated source**, not invented this run. Still **not** backed by a formal `EvidenceRecord` in `evidenceResolver.ts`/`evidenceRecords.ts` — that store was not queried live this run (would be a prod DB read), and a repo-file grep for exhaust/oil-interval terms in `evidenceRecords.ts` returned no hits. Treat as slate-sourced, not evidence-store-verified. |
| "Your owner's manual has the real interval for your engine and oil type" | Same slate item #9 | Same status. Note this claim is self-limiting by design — it refers the viewer to their own manual rather than asserting a number, so it needs no external verification to be safe. |
| "For most modern cars it is considerably longer [than 3,000 miles]" | Same slate item #9; also general, widely-documented industry knowledge (OEM full-synthetic intervals commonly 5,000–10,000+ miles) | **UNKNOWN against this repo's evidence store**, same reasoning as the brake pack's general-mechanical-knowledge claims. Phrasing avoids a specific number, which keeps it inside the approved soft-language pattern rather than asserting a figure this repo can't source. |
| No price, warranty, or shop-specific policy claim is made anywhere in this script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** Sidesteps the same `FactChannel` gap noted below. |

**Gap, stated plainly (repeated from prior packs, still unresolved):**
`businessFacts.ts`'s `FactChannel` type is `"sms" | "voice" | "web"` only —
there is no `"reel"` channel. This script doesn't lean on that store, so the
gap doesn't block this pack, but it would block any future reel script that
wants to quote a price or warranty line verbatim.

**Campaign-keyword gap, new to this pack:** `CAMPAIGN_KEYWORDS` in
`facelessReelStudio.ts` (POTHOLE, TREAD, PRESSURE, BRAKES, SALT, BATTERY,
WIPERS, ALIGNMENT, ECHECK, TIRES, SPARE, VIBRATION, PULLING, TPMS, NOISE) has
no entry for oil/maintenance intervals. `OIL-INTERVAL` below is a descriptive
label only, matching the precedent set by the brake pack's own
`campaignKeyword: "BRAKE-NOISE"` (also not a literal list entry — the list's
`NOISE` alone was available but the prior pack used a compound label). If this
pack is ever run through `validateCampaignKeyword()` for real, it will fail
the exact-match check; that function is not evaluated by this pack-only run.

---

## 4 · Full production pack

### Script — word-for-word, timed (29s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "The 3,000-mile oil sticker is a sales tool. It is not an engineering spec." |
| 2 · SETUP | 0:03–0:09 | "Your owner's manual has the real interval — for your exact engine and oil type." |
| 3 · VALUE | 0:09–0:16 | "For most modern cars, that number is a lot longer than 3,000 miles." |
| 4 · VALUE | 0:16–0:22 | "Short trips and cold winters shorten it. Highway miles stretch it out." |
| 5 · CTA | 0:22–0:29 | "Check your manual before the next sticker. Not sure what it says? Nick's Tire and Auto — link in bio." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per beat.**
Per-beat prompts are in `brief.json`. Standing negative prompt for every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no API
spend).** Per `docs/operations/REEL-PIPELINE.md`, this is what prod currently
renders on. Search terms for free stock (Pexels/Pixabay/Coverr — search
manually; no specific clip URLs are asserted here since none were verified
live this run):

- Beat 1: "oil dipstick check engine macro"
- Beat 2: "owner's manual maintenance schedule closeup"
- Beat 3: "pouring motor oil funnel engine bay"
- Beat 4: "car frost windshield cold morning start" / "engine exhaust vapor cold morning"
- Beat 5: "auto repair garage bay interior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts`
(Google Neural2 or ElevenLabs) at render time; script above is exactly what
gets fed to it, already timed to the 29s budget.

### Captions

[`captions.srt`](./captions.srt) — 11 cards, phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration above.
Style: white bold sans, black outline/shadow, bottom-third safe zone, ALL-CAPS
optional per house style — burn in via ffmpeg `subtitles` filter, never as a
generated in-frame element (Seedance/Higgsfield can't spell reliably, and M10
preflight blocks generated text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path)

1. **Layer order (bottom to top):** background video clip per beat → ambient
   room-tone/SFX (optional, see §6) → voiceover track → burned-in caption
   track → end-card CTA text (beat 5 only, shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each beat
   boundary (no crossfade — matches the render-integrity gate's expectation of
   distinct per-beat frames, not a dissolve-blurred transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** cool, slightly desaturated grade on beats 1–2 (engine bay/manual,
   procedural mood), warm amber grade on beat 3 (fresh oil pour), cool blue
   morning grade on beat 4 (cold-start contrast), warm shift on beat 5 (CTA,
   inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 29s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no static/looped
   single image — every beat here is deliberately a slow camera move, not a
   still).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 29s (within the 15–60s target range and the account's own
  25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed 7:00 AM or 2:00 PM ET cadence
  per `REEL-SLATE-2026-07-31.md` — do not post ad hoc, and do not post this
  same day as another pack from today's queue without checking the feed cap
  (see §5)
- **Caption/hashtags:** see §8 below
- **CTA type:** referral/action ("check your manual") rather than SAVE — the
  slate's own note under the account's first-8-reels data point is that
  `saved = 0.00` across the board, so this pack leans on a concrete small
  action instead of a save-ask

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live balance
check):

| Route | Per-unit cost | 5-beat estimate |
|---|---|---|
| `template_stock` (**current prod pin** per REEL-PIPELINE.md) | $0/clip, local ffmpeg | **$0** |
| `seedance_clip` | $0.25/clip (labeled ASSUMPTION in source — unverified) | ~$1.25 |
| `veo_second_720p` | $0.10/sec | ~$3.00 (5 clips × ~6s avg) |
| Voiceover (`elevenlabs_vo`) | $0.05 | $0.05 |
| Brief compile (`gemini_brief`) | $0.01 | $0.01 |

**Estimated total for this pack on the actual prod-pinned route:** ~$0.06
(VO + brief only; clips are free on `template_stock`). This is an
operator-tunable estimate, not a metered price — treat as directional.

**Daily budget ceiling:** `UNKNOWN` — `maxGenerationCostPerDayUsd` lives in the
latest `autonomy_policy_versions` row, which was not read this run (live DB).
Account balance (`getHiggsfieldAccountHealth().balanceCredits`) is likewise
`UNKNOWN` — not probed.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. With
9 open draft PRs already queued from today and yesterday, if several get
approved and enqueued in the same day the 2-posts/day feed cap will bind well
before this pack's turn — that is the guardrail working as designed, not a
defect to route around.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, not a new
finding — same gap noted in every prior pack in this directory). This pack
sidesteps it deliberately rather than asserting a track is cleared: **no music
bed is assigned.** The reel is voiceover + captions + optional single
royalty-free ambient/SFX layer (quiet engine-bay room tone, a single soft
oil-pour trickle under beat 3), which also scores well on the pipeline's
muted-first requirement since the captions alone carry full meaning. If the
operator wants a music bed, that requires a specific track with asset ID,
source, license scope, territory, and expiry tracked by hand — this pack does
not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED` pending an
actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/brief.json carries a self-estimate (62/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption:**

> The 3,000-mile oil sticker is a sales tool. It is not an engineering spec.
>
> Your owner's manual has the real interval — for your exact engine and oil
> type. For most modern cars, it's a lot longer than 3,000 miles.
>
> Short trips and cold winters shorten it. Highway miles stretch it out.
>
> Check your manual before the next sticker.
>
> #oilchange #cartips #carmaintenance #clevelandohio

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "That '3,000 miles' sticker on your windshield? It's a sales tool,
> not your engine's actual spec."
> Caption: Your owner's manual has the real number for your engine and oil
> type — and for most modern cars, it's a lot longer than 3,000.
> CTA: Not sure what your manual says? Bring it by — we'll help you read it,
> free.

**Ad-ready variant B (question-forward):**

> Hook: "When was the last time you actually opened your owner's manual to
> the maintenance page?"
> Caption: The mileage on that oil-change sticker is a shop's suggestion, not
> your engine's requirement. Short trips and cold weather shorten the real
> interval; highway miles stretch it.
> CTA: Bring the manual (or don't — we can look it up), and we'll tell you
> straight what your car actually needs.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (62/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on three
dimensions specifically — **loop** (the CTA frame doesn't loop cleanly back
into the hook frame), **sourced fact** (grounded in the shop's own slate copy
but not backed by a formal `EvidenceRecord` in `evidenceResolver.ts`, which
wasn't queried live this run), and **keyword** (no exact `CAMPAIGN_KEYWORDS`
entry maps to oil-change content, per §3). Not `PUBLISHED WITH READ-BACK` — no
`reel-canary` call, no `igPostId`, nothing was generated, rendered, or posted.
Not `BLOCKED` outright — the pack is complete and usable; an operator (or a
live-authorized session) can hand it to the real pipeline via
`/api/admin/reel-canary {action:"start", topic:"oil change intervals"}`, let
the server re-score and re-render for real, and only then move toward
publish.

**Separately flagged for the operator (not resolved by this pack):** the
9-open-draft-PR backlog noted in §1. This run's own dedupe check held, but the
creation rate strongly suggests these scheduled runs are firing faster than
any human is reviewing them. Worth deciding whether to slow the schedule,
add an auto-close/consolidation pass, or explicitly accept an unreviewed
backlog as normal.
