# Reel production pack — "Your battery's real age isn't on the dashboard" (battery date code, 2026-09-05)

Scheduled-task run · 2026-09-05 · mode `SCHEDULED` (== `INTELLIGENCE`: research,
score, return a pack; render/publish nothing — per
`.claude/skills/nickstire-reel-operator/SKILL.md` §"Run modes → real routes")
· landing destination `/battery` (already assigned to two prior packs, reused,
not invented)

**No generation, DB read, or publish call was made against production this
run.** The operator skill's hard rule is explicit: a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and a
repetition-ledger or quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
`ffmpeg`, the Higgsfield CLI, and any TTS/Meta-posting credential are all
absent from this container (checked fresh this run, not assumed from a prior
pack's finding) — there is no live motion route here regardless of
authorization, so the task's own instructions ("default to the production
pack when tools are missing") apply. See §1.

**No MP4 exists. None is claimed to exist.**

---

## 1 · Capability check, dedup, and where this run differs from piling on

| Capability the task asked about | Status this run | Basis |
|---|---|---|
| ChatGPT / text generation | **This session itself** | Script, captions, copy authored here; no external LLM call needed |
| TTS / voiceover | Not available | No TTS tool connected this session; `reelVoice.ts` needs a running server + provider creds, neither present |
| Higgsfield (motion generation) | Not available | `which hf` → not found; no `HIGGSFIELD_*` / `ADMIN_API_KEY` env in this container (checked via `env \| grep`) |
| Meta/Instagram posting | Not available, and blocked regardless | No Graph API creds in this container; publishing is a protected customer-facing action per root `AGENTS.md` requiring live, in-the-moment authorization — a scheduled firing does not have that, by design |
| Shell/render (ffmpeg) | Not available | `which ffmpeg` → not found |
| CapCut or similar | Not available | No GUI editor in this headless container |

**Dedup check — both required sources, per the skill's protocol:**

1. `ls apps/nickstire/docs/reel-packs/` — **145 dated directories** on this
   branch before this pack was added (144 on `main` as of the 2026-09-04 run,
   plus that run's own pack). None of them cover a battery *date-code* /
   manufacture-age check — the four existing battery-adjacent packs are
   `battery-summer-heat`, `battery-terminal-corrosion`,
   `battery-cold-weather-cranking-amps`, and `battery-parasitic-drain` — all
   symptom- or condition-based, none about reading the case sticker to learn
   the battery's actual age independent of symptoms.
2. `search_pull_requests` (`repo:nourdean22/mainnicks-tire-autonew is:pr
   is:open "reel pack" in:title`) — **12 open, unmerged drafts** as of this
   run (#2131 cowl drain, #2130/#2129/#2132 backlog-status-only notes, #2114
   blind spot monitor, #2121 back-to-school carpool, #2116 fuel filter, #2115
   CV axle boot, #2118 sunroof, #2117 EPS warning light, #2126 tire
   feathering, #2120 trunk release). None duplicate this pack's topic or its
   `/battery` destination.

This pack's topic and slug (`battery-date-code`) do not collide with any
existing merged directory or open PR title.

**Why this isn't pack #146 in the same low-yield pattern.**
`TRIAGE.json` (generated 2026-08-29, `totals: {all: 136, publishable: 3,
needs-work: 93, dead: 40}`) shows the three currently-promotable concepts all
share `productionType: "real-footage"` and `cost: 0` — they need no paid
AI-generation call and therefore never trip the Meta AI-content-disclosure
gate that blocks 93 of the other concepts (`DISCLOSURE_NOT_SATISFIED(meta)`
in every `needs-work` row: the publish call doesn't set
`is_ai_generated=true`, so a generated clip can't organically publish even
once rendered). This pack is deliberately authored the same way: every beat
below is a real macro/phone shot of an actual battery case, no AI-clip
prompts, no credit spend. That is the one lever a content-only run can pull
that correlates with the packs that actually clear — not a new observation
(the 2026-09-04 pack made the same call), just followed again because it's
still the right call and the underlying code gap (`is_ai_generated=true` not
being set) is outside a content-pack's scope to fix. **Not re-litigating the
open-PR backlog here** — PR #2132 already closed 15+ redundant status notes
and notified the operator directly; repeating that finding would repeat
exactly the pattern that closeout criticized.

---

## 2 · Candidate scoring and selection

| Candidate | Hook | Format | Landing page assigned? | Selected? |
|---|---|---|---|---|
| Battery date-code / manufacture-age check | Moderate-high — concrete, actionable, "check this one thing" | Single-topic how-to, real-footage only | `/battery` — already live, already used by 2 prior packs | ✅ **Selected** |
| A 146th single-symptom diagnostic (5th battery angle, or a new system) | Varies | Risks the 93-deep AI-clip pattern unless deliberately real-footage | Usually already assigned | Parked — see §1 |
| Consolidated backlog status note only | N/A | No new pack | N/A | Rejected — #2130/#2129/#2132 already cover "no change since last note" and "15+ notes closed unmerged"; a 4th status-only note repeats what #2132 already resolved |

**Honest overlap disclosure:** this pack sits in the same "battery" franchise
as three existing packs. It does not repeat their claims (heat degrading
plates, corrosion breaking a connection, cold reducing effective cranking
amps, parasitic drain draining a parked battery) — it teaches a distinct,
independently useful fact: the battery case carries its own manufacture-date
code, and that date (not the "GOOD/REPLACE" load-tester sticker some stores
apply) is the honest signal of remaining life. A human reviewer may still
judge four battery-angle reels as enough for one franchise and choose to
hold this one back a cycle.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A letter-and-number code stamped on the case marks month and year of manufacture" | Industry-standard battery-industry date-code convention (BCI-style: a letter for month, a digit for year), general automotive knowledge | **UNKNOWN against `evidenceResolver.ts`** — not queried live this run (would be a prod DB read). Not a shop-specific or invented claim; a widely-documented labeling convention, but this repo's own evidence store has not certified it. |
| "Most batteries last three to five years regardless of what a charge gauge shows" | General automotive/battery-industry knowledge (typical flooded lead-acid service life) | **UNKNOWN against this repo's evidence store**, same reasoning as every prior pack — flagged, not asserted as shop-verified. |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only code file, not a live DB read) — no battery price/warranty row is quoted here | **N/A — deliberately avoided**, per the approved claim-safety pattern bank (`client/src/lib/facelessReelStudio.ts`). The CTA offers a free test, not a price. |

**Gap, repeated because it's still true:** `businessFacts.ts`'s `FactChannel`
type is `"sms" | "voice" | "web"` only — no `"reel"` channel exists yet, so
none of the above can be auto-verified against the live facts store from this
pipeline. Manual human check before publish.

---

## 4 · Full production pack

### Script — word-for-word, timed (25s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "Your battery's real age isn't on the dashboard — it's stamped on the case." |
| 2 · VALUE | 0:03–0:10 | "Find the sticker with a letter and a number. The letter's the month, the number's the year it was made." |
| 3 · VALUE | 0:10–0:16 | "Three to five years is the normal lifespan — no matter what the charge gauge says." |
| 4 · VALUE | 0:16–0:21 | "A weak battery won't warn you. It just quits, usually on the coldest morning." |
| 5 · CTA | 0:21–0:25 | "We'll test it free while you wait. Nick's Tire and Auto — link in bio." |

Machine-readable version: [`brief.json`](./brief.json).

### Asset list — real-footage only, no AI-clip generation route assumed

Deliberately not written as Higgsfield/Seedance prompts (§1). Every beat is
sourceable as real shop-shot phone footage on the `template_stock` free lane:

- Beat 1: wide shop-bay or driveway shot, car hood up, battery visible but
  not yet in close focus (sets the scene, no face in frame)
- Beat 2: macro shot, gloved hand pointing at the battery case's printed
  date-code sticker, close enough that the letter/number code is legible
  (real footage — a legible label is fine, unlike a generator)
- Beat 3: pull-back shot of the same battery in its tray, neutral framing
- Beat 4: real shop-shot of a battery tester clamped to the terminals,
  digital readout in frame (same style as the promotable
  `battery-summer-heat`/`battery-terminal-corrosion` packs)
- Beat 5: wide shop-bay shot, bay door open to daylight, no readable
  branding required in frame (voiceover carries the shop name)

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` at render
time; script above is already timed to the 25s budget.

### Captions

[`captions.srt`](./captions.srt) — phrase-grouped, timed to the narration.
Burn in via ffmpeg `subtitles` filter (white bold sans, black outline,
bottom-third safe zone) — never as generator in-frame text.

### Editing instructions (manual — this session cannot execute any of this)

1. **Layer order (bottom to top):** background clip per beat → optional
   ambient shop room-tone → voiceover → burned-in captions → end-card CTA
   text (beat 5 only: shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, hard cuts (no
   crossfade — matches the render-integrity gate's distinct-frame check).
3. **Captions:** burn in per `captions.srt`, bottom-third safe zone.
4. **Color:** neutral, workshop-lit grade throughout — informational, not
   urgent/alarming; this is a preventive check, not a breakdown symptom.
5. **Output contract** (the pipeline's own render-integrity gate,
   `reelAssembly.ts` #800/#801, not evaluated this run — no `ffmpeg` in this
   session): container duration within 0.75s of 25s, ≥80% of expected 30fps
   frame count, ≥3 distinct MD5s among 5 sampled frames.
   `ffmpeg -f concat -i beats.txt -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook cross-post, `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 25s (within the 15–60s target range)
- **Posting slot:** hold to the account's fixed cadence; do not post ad hoc.
  Given 12 open unreviewed reel-pack PRs already queued (§1), this pack
  should be treated as queued behind them, not a same-day candidate.
- **Caption/hashtags:** see §8
- **CTA type:** free-inspection CTA, informational urgency (age-based),
  no fearmongering

---

## 5 · Credit-risk and fallback routing

Because this pack is designed real-footage-only (§1, §4), it does not carry
the 93-bucket's credit-spend/AI-disclosure blocker:

| Route | Per-unit cost | 5-beat estimate |
|---|---|---|
| `template_stock` (prod-pinned per `docs/operations/REEL-PIPELINE.md`, and this pack's designed route) | $0/clip | **$0** |
| Voiceover (`elevenlabs_vo`, `generationLedger.ts`) | $0.05 | $0.05 |
| Brief compile (`gemini_brief`) | $0.01 | $0.01 |

**Estimated total on the prod-pinned route: ~$0.06.** Operator-tunable
estimate, not a metered price. Daily budget ceiling and Higgsfield account
balance: **`UNKNOWN`** — both require a live read this session did not make.

**Guardrail order at real enqueue time** (`docs/runbooks/reel-pipeline.md`,
not evaluated this run): preflight → `RESERVATION_FEED_CAP` (2/day) →
`RESERVATION_SPACING` (3h) → `REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) →
`BUDGET_DAILY_EXCEEDED`.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** — same gap noted in every
prior pack. This pack sidesteps it deliberately: no music bed assigned,
voiceover + captions + optional royalty-free ambient room-tone only.

---

## 7 · QA matrix

No rendered asset exists and this session has no render tooling (§1) — every
render-time gate is `BLOCKED`, not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | Not called live; self-estimate in `brief.json` is explicitly not this function's output |
| Render-integrity (#800/#801) | `reelAssembly.ts` | `BLOCKED` | No file rendered |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not invoked |
| Human-approval door | `instagramAdmin.publishPost` | `BLOCKED` | Not reached |

---

## 8 · IG/FB copy

**Primary caption:**

> Your battery's real age isn't on the dashboard - it's stamped on the case.
>
> Look for a sticker with a letter and a number: the letter is the month,
> the number is the year it was made. Three to five years is the normal
> lifespan, no matter what a charge gauge says. A weak battery usually
> won't warn you - it just quits on the coldest morning.
>
> A quick load test tells you where it actually stands.
>
> #cartips #batterylife #clevelandohio #tireshop

**Ad-ready variant A (curiosity-forward):**

> Hook: "There's a code stamped on your battery that tells you its real age."
> Caption: Not the charge gauge — the manufacture-date sticker. If it's
> pushing four or five years old, don't wait for it to fail on the coldest
> morning of the year.
> CTA: Stop by 17625 Euclid Ave and we'll check it, free.

**Ad-ready variant B (question-forward):**

> Hook: "Do you know how old your car battery actually is?"
> Caption: Most drivers don't — and a battery rarely warns you before it
> quits. The sticker on the case has the answer in about five seconds.
> CTA: Call (216) 862-0005 or stop by. We'll test it while you wait.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY` — no live re-score from `calculateReelQualityScore()`,
no evidence citations from `evidenceResolver.ts` (both would require a
production DB read this session did not make). Not `PUBLISHED WITH
READ-BACK` — no `reel-canary` call, no `igPostId`, nothing generated,
rendered, or posted. Not `BLOCKED` — the pack is complete and usable.

**Operational note for the human reviewer:** this run added one real-footage
pack targeting an already-live destination (`/battery`), matching the one
lever that correlates with this repo's 3 currently-promotable concepts. It
did not add another status-only backlog note (#2132 already closed that
loop) and did not attempt any live generation, DB read, or publish call. The
12-open-PR backlog and the Meta AI-disclosure code gap blocking 93 concepts
remain operator/engineering decisions this content-only run cannot make on
its own.
