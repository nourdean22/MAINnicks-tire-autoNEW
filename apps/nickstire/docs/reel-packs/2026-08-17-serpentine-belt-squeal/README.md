# Reel production pack — "Serpentine belt squeal on cold start" (2026-08-17)

Scheduled-task run · 2026-08-17 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **BELT-SQUEAL**
· source: not on `REEL-SLATE-2026-07-31.md` — that slate is effectively exhausted
(see §0 below), so this topic is a fresh, unlisted addition, same pattern as
several immediately-prior scheduled runs (exhaust-smoke-color, wiper-blade-check,
transmission-fluid-color-test, plug-vs-patch-tire-repair were also not on the slate).

**No generation, DB read, or publish call was made against production this run.**
This is a scheduled/automated firing with no live operator present — the operator
skill's hard rule is explicit that a stored scheduled prompt does not authorize
`reel-canary` generation or publish calls, and that repetition-ledger/quality-score
reads against the live database are themselves a production read, not a free
action. This session made none of those calls. See §1 and §7.

---

## 0 · Flag for the operator — read this before the pack itself

This scheduled task has been firing **roughly once per hour since
2026-08-16 22:38** (21+ consecutive firings). As of this run:

- **19 draft PRs are open** in this repo with "reel production pack" in the
  title (#1614 through #1636), spanning that entire window. **Zero have been
  merged.** (`mcp__github__search_pull_requests`,
  `repo:nourdean22/mainnicks-tire-autonew is:pr is:open reel pack in:title`,
  checked at the start of this run — 19 results, all `draft: true`.)
- The original 20-topic slate (`REEL-SLATE-2026-07-31.md`) is now
  **effectively exhausted**: 17 of its 20 items are covered across the 5
  merged packs in this directory plus those 19 open PRs. The 2 remaining
  slate items (#3 cold-weather tire light, #11 all-season vs. winter tires)
  are both winter-seasonal and correctly deferred — it's mid-August. At
  least 5 of the 19 open-PR topics (exhaust smoke color, wiper blade check,
  transmission fluid color test, plug-vs-patch tire repair, summer-heat tire
  pressure) are not on the slate at all — prior runs already started
  inventing topics once the slate ran low, same as this run does.
- Every pack, including this one, correctly stops at `READY FOR HUMAN
  APPROVAL` per the operator skill's hard rule — none of them can self-approve
  into production. **That means this hourly cadence produces pure backlog by
  design**: nothing downstream of pack-generation is happening because
  nothing is supposed to happen without a live operator. 19 (soon 20) drafts
  sitting unreviewed is not a bug in any single run; it's what an unattended
  hourly schedule feeding a human-approval gate looks like after 21 hours.

**This is worth the operator's attention now, not just noted in passing:**
either close/consolidate the review backlog, lower the firing frequency, or
have a session batch-review the open drafts — continuing to add one every
hour without anyone looking at the queue just grows it. This run proceeds to
produce one more pack (below) because that is what the stored task asks for,
but flags the queue size explicitly rather than adding to it silently.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops short
of any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`) and
short of any live read against the production TiDB database.

**Capabilities — not probed this run, stated as such rather than assumed:**

| Capability | Status this run | Why |
|---|---|---|
| `getHiggsfieldAccountHealth()` (creds/balance) | Not called | Requires a live server process + credentials; this is a Claude Code repo session, not the running app. |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md:32` states prod is pinned to **`template_stock`** (verified there 2026-08-11), i.e. the free local-ffmpeg lane, not Higgsfield/Seedance/Veo. Treat as last-known, not live-confirmed. |
| `REEL_GENERATION_ENABLED` | Not read live | Gate on the cron pulse job; not queried this run. |
| Voiceover TTS (`reelVoice.ts`) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | Blocked by the hard rule above for a scheduled firing. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| ChatGPT/LLM script drafting | This session itself (no separate tool) | The script below was authored directly by this session, not via a separate connected LLM tool. |
| CapCut / video editor | Not connected | No editing-software MCP/tool is available in this session; §4's editing instructions are written for a human or ffmpeg to execute. |

**Repetition-ledger context:** `getRecentReelSignals()` reads the live
`reel_jobs` table on production TiDB and was not queried (would be a prod
read). Instead, checked the file-based record: `ls
apps/nickstire/docs/reel-packs/` (5 merged packs) plus a live GitHub PR search
for the 19 open drafts (§0). Combined, the belt-squeal topic in this pack
does not match any of those 24 titles. This is a directional check, not the
real ledger — a rejected `reel_jobs` row that never produced a pack file
would not show up here.

---

## 2 · Candidate scores and selection

The slate itself is exhausted for non-seasonal items (§0), so this run
selected from genuinely useful topics adjacent to the slate's existing spread
(brakes, fluids, electrical, suspension, tires) that no merged pack or open
draft currently covers:

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Serpentine belt squeal on cold start | Strong — universally recognized sound, safety/cost angle (alternator) | Yes | No | ✅ **Selected** |
| Power steering fluid leak signs | Moderate | Yes | No (adjacent to coolant-color PR but distinct fluid) | Parked |
| AC blowing warm in summer heat | Moderate — seasonal but currently in-season | Yes (seasonal) | Adjacent to open "summer-heat tire-pressure" PR, risks reader thinking it's a duplicate | Parked to avoid confusion |

Belt squeal was selected for a strong, universally recognizable sound-based
hook (same hook mechanism that worked for the brakes topic), a genuine
safety/cost angle (belt failure takes the alternator and power steering with
it), and zero overlap with any of the 24 existing pack/PR titles.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "The serpentine belt drives the AC, power steering, and alternator" | General automotive mechanical knowledge (standard accessory-belt layout on modern engines) | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read). No `EvidenceRecord` citation is attached. |
| "Cold mornings stiffen the rubber and it slips on the pulley until it warms up" | Same — standard mechanical fact, not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing uses "usually" (approved soft-language pattern, `facelessReelStudio.ts:571`) rather than an absolute. |
| "A belt that slips today can crack and snap later, taking the alternator's charging with it" | Same — standard mechanical fact | **UNKNOWN against this repo's evidence store.** Phrasing uses "can," not "will" — avoids an absolute/fear-mongering claim per the claim-safety pattern bank. |
| No price, warranty, or shop-specific policy claim is made anywhere in this script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** Sidesteps the known gap: `FactChannel` has no `"reel"` value yet. |

---

## 4 · Full production pack

### Script — word-for-word, timed (27s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "That high-pitched squeal when you start your car? That is not your brakes." |
| 2 · SETUP | 0:03–0:08 | "It is usually the serpentine belt — one belt running your AC, power steering, and alternator." |
| 3 · VALUE | 0:08–0:15 | "Cold mornings make it worse. The rubber stiffens, slips on the pulley, and squeals until it warms up." |
| 4 · VALUE | 0:15–0:21 | "But a belt that slips today can crack and snap later — and take your alternator's charging with it." |
| 5 · CTA | 0:21–0:27 | "Hear it every cold start? Get the belt checked before it strands you. Nick's Tire and Auto — link in bio." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per
beat.** Per-beat prompts are in `brief.json`. Standing negative prompt for
every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no API
spend).** Per `docs/operations/REEL-PIPELINE.md`, this is what prod currently
renders on. Search terms for free stock (Pexels/Pixabay/Coverr — search
manually; no specific clip URLs are asserted here since none were verified
live this run):

- Beat 1: "car engine bay cold morning start" / "engine bay close up"
- Beat 2: "serpentine belt engine pulley system" / "accessory belt closeup"
- Beat 3: "belt pulley macro rotating" / "engine bay winter frost"
- Beat 4: "worn cracked rubber belt macro" / "alternator closeup"
- Beat 5: "auto repair garage bay interior"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` (Google
Neural2 or ElevenLabs) at render time; script above is exactly what gets fed
to it, already timed to the 27s budget.

### Captions

[`captions.srt`](./captions.srt) — phrase-grouped (not literal
one-word-at-a-time) for short-form readability, timed to the narration above.
Style: white bold sans, black outline/shadow, bottom-third safe zone —
burn in via ffmpeg `subtitles` filter, never as a generated in-frame element
(Seedance/Higgsfield can't spell reliably, and M10 preflight blocks generated
text for exactly that reason).

### Editing instructions (CapCut or ffmpeg — either path; no editing tool is
connected to this session, so these are written for a human or a script to
execute, not executed here)

1. **Layer order (bottom to top):** background video clip per beat → ambient
   garage/engine-bay room tone (optional, see §6) → voiceover track →
   burned-in caption track → end-card CTA text (beat 5 only, shop name +
   "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, cut hard on each beat
   boundary (no crossfade — matches the render-integrity gate's expectation
   of distinct per-beat frames, not a dissolve-blurred transition).
3. **Captions:** burn in per `captions.srt` timing, bottom-third safe zone,
   sized to remain legible at 9:16 mobile scale.
4. **Color:** cool, slightly desaturated grade on beats 1–2 (cold-morning
   mood), warmer/more saturated on beats 3–4 (mechanical detail), warm shift
   on beat 5 (CTA, inviting).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 27s, ≥80% of expected 30fps
   frame count, visibly distinct frames across the runtime (no static/looped
   single image).
   Reference command shape (documented in `facelessReelStudio.ts`, not
   executed this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 27s (within the 15–60s target range and the account's own
  25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed 7:00 AM or 2:00 PM ET cadence
  per `REEL-SLATE-2026-07-31.md` — do not post ad hoc, and note the existing
  19-PR backlog (§0) before scheduling yet another slot
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND — per the slate's corrected objective (saves measured
  `0.00` across the account's first 8 reels)

---

## 5 · Credit-risk and fallback routing

From `generationLedger.ts` `COST_ESTIMATES_USD` (code-read, not a live
balance check):

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

**Daily budget ceiling:** `UNKNOWN` — `maxGenerationCostPerDayUsd` lives in
the latest `autonomy_policy_versions` row, which was not read this run (live
DB). Account balance (`getHiggsfieldAccountHealth().balanceCredits`) is
likewise `UNKNOWN` — not probed.

**Guardrail order to expect at real enqueue time** (from
`docs/runbooks/reel-pipeline.md`, not evaluated this run): preflight →
`RESERVATION_FEED_CAP` (2 posts/day) → `RESERVATION_SPACING` (3h) →
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, same as
every prior pack in this directory). This pack sidesteps it deliberately
rather than asserting a track is cleared: **no music bed is assigned.** The
reel is voiceover + captions + optional single royalty-free ambient/SFX layer
(engine-bay room tone, one belt-squeal SFX under beat 1), which also scores
well on the pipeline's muted-first requirement since the captions alone carry
full meaning. If the operator wants a music bed, that requires a specific
track with asset ID, source, license scope, territory, and expiry tracked by
hand — this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED` pending
an actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; `brief.json` carries a self-estimate that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption:**

> That high-pitched squeal when you start your car? That's not your brakes.
>
> It's usually the serpentine belt — one belt running your AC, power
> steering, and alternator.
>
> Cold mornings make it worse. The rubber stiffens, slips on the pulley, and
> squeals until it warms up. But a belt that slips today can crack and snap
> later — and take your alternator's charging with it.
>
> Hear it every cold start? Get it checked before it strands you.
>
> #cartips #autorepair #clevelandohio #carmaintenance

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "That squeal on cold start-up isn't your brakes — it's a belt about
> to fail."
> Caption: One belt runs your AC, power steering, and alternator. When it
> squeals every cold morning, it's already slipping.
> CTA: Hear it? Call (216) 862-0005 or stop by 17625 Euclid Ave — we'll check
> it, free.

**Ad-ready variant B (question-forward):**

> Hook: "Does your car squeal every cold morning and stop once it warms up?"
> Caption: That's a slipping serpentine belt — and it runs more than you'd
> think: AC, power steering, alternator charging.
> CTA: Don't wait for it to snap. Bring it by — we'll take a look, free.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (see `brief.json`)
sits below the pipeline's real 70/75 auto-pass floor on the same two
dimensions every pack in this series has flagged — **loop** (the CTA frame
doesn't loop cleanly back into the hook frame) and **sourced fact** (no
`EvidenceRecord` in `evidenceResolver.ts` currently backs the belt-mechanics
claims, and that store wasn't queried live this run to check). Not
`PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`, nothing
was generated, rendered, or posted. Not `BLOCKED` outright — the pack is
complete and usable; an operator (or a live-authorized session) can hand it
to the real pipeline via `/api/admin/reel-canary {action:"start",
topic:"serpentine belt squeal on cold start"}`, let the server re-score and
re-render for real, and only then move toward publish.

**But see §0 first** — 19 prior packs already sit in exactly this same
`READY FOR HUMAN APPROVAL` state, unreviewed. The operator's most valuable
next action on this thread may be reviewing that backlog rather than this
pack specifically.
