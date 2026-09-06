# Reel production pack — "Trunk button does nothing" (fuse, manual release, or solenoid, 2026-09-04)

Scheduled-task run · 2026-09-04 · mode `SCHEDULED` (== `INTELLIGENCE`: research,
score, return a pack; render/publish nothing — per
`.claude/skills/nickstire-reel-operator/SKILL.md` §"Run modes → real routes")

**No generation, DB read, or publish call was made against production this
run.** The operator skill's hard rule is explicit: a stored scheduled prompt
does not authorize `reel-canary` generation or publish calls, and a
repetition-ledger or quality-score read against the live database is itself a
production read, not a free action. This session made none of those calls.
`ffmpeg`, the Higgsfield CLI, and any TTS/Meta-posting tool are all absent
from this container — no live motion or publish route exists here regardless
of authorization, so the task's own instructions (§5: "default to the
production pack") apply. See §1.

**No MP4 exists. None is claimed to exist.**

---

## 1 · Capability check

| Capability the task asked about | Status this run | Basis |
|---|---|---|
| ChatGPT / text generation | **This session itself** | Script, captions, copy authored here; no external LLM call needed |
| TTS / voiceover | Not available | No TTS tool connected in this session; `reelVoice.ts` needs a running server + provider creds, neither present |
| Higgsfield (motion generation) | Not available | `which hf` → not found; no `HIGGSFIELD_*` env in this container |
| Meta/Instagram posting | Not available, and blocked regardless | No Graph API creds; publishing is a protected customer-facing action per root `AGENTS.md` requiring live, in-the-moment authorization a scheduled firing does not have |
| Shell/render (ffmpeg) | Not available | `which ffmpeg` → not found |
| CapCut or similar | Not available | No GUI editor in this headless container |

**Dedup check — both required sources, per the skill's protocol:**

1. `ls apps/nickstire/docs/reel-packs/` — this scheduled task has already
   produced **4 merged packs dated 2026-09-04** before this run
   (`backup-camera-black-screen`, `fall-car-care-checklist`,
   `heated-seats-not-working`, `remote-start-not-working`). No existing
   directory (today's or any prior date) covers trunk/hatch release.
2. `search_pull_requests` (`reel pack in:title`, open) — **5 open, unmerged
   drafts as of this run, all opened today** (#2114 blind spot monitor,
   #2115 CV axle boot, #2116 fuel filter, #2117 EPS warning light, #2118
   sunroof won't close). None duplicate this pack's topic.

**Finding worth surfacing, not just the pack itself.** This is the **10th
reel-pack topic this scheduled task has produced today** (4 merged + 5 open
+ this one), at roughly one per hour. None of the 5 open PRs from today have
been reviewed or merged yet — the newest (#2118) is barely an hour old, the
oldest (#2114) has sat four hours. A pack is cheap to produce (docs-only, no
spend) but not free to review, and an hourly cadence against an unreviewed
queue is a backlog that compounds faster than it can be cleared by a human
checking in periodically. This run still produces its pack, per the task's
own instructions, but the operator should know the queue is growing, not
static — see the final-status note in §9 and the standalone notification
sent alongside this pack.

---

## 2 · Candidate scoring and selection

| Candidate | Hook | Format | Selected? |
|---|---|---|---|
| Trunk/hatch release does nothing (fuse vs. manual release vs. solenoid/cable) | Strong — mildly urgent (locked-out cargo), common, non-visceral | Single-symptom diagnostic, 3-step triage | ✅ **Selected** |
| A 6th checklist-format roundup | Moderate | Would need an unclaimed landing page; none identified this run | Parked |
| Another single dashboard-light diagnostic | Varies | Several already shipped this week (gas cap, ABS, EPS just opened as #2117) | Parked — avoids clustering symptom-light content in one week |

**Honest overlap disclosure:** none found. `trunk`, `hatch`, and `latch` do
not appear in any existing pack slug or `TRIAGE.json` entry as of this run.

**Production-type choice.** Per the finding in the most recent prior pack in
this directory (`2026-08-04-fall-car-care-checklist`, wait — dated
`2026-09-04`): `TRIAGE.json`'s only 3 currently-promotable concepts are all
`productionType: "real-footage", cost: 0`; the bulk of the backlog is stuck
on paid AI-clip generation + Meta AI-disclosure requirements. This pack is
authored the same way — every beat is real/stock shop footage, no AI-clip
generation prompts — for the same reason: it is the one lever this session
can pull that correlates with the concepts that actually clear.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "A blown fuse is the most common reason the trunk release does nothing" | General automotive knowledge (low-current electric release circuits are fuse-protected and fail this way often) | **UNKNOWN against `evidenceResolver.ts`** — not queried live this run (would be a prod DB read) |
| "Most trunks have a manual release inside — pull tab, cable loop, or an interior seat pass-through" | General automotive knowledge / common OEM design pattern | **UNKNOWN against this repo's evidence store**, same reasoning |
| "If the fuse is good and the manual release won't open it, the solenoid or cable itself may be worn" | General automotive knowledge | **UNKNOWN against this repo's evidence store**, same reasoning |
| No price, warranty, or shop-specific policy claim anywhere in the script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only code file, not a live DB read) — no pricing/warranty rows quoted | **N/A — deliberately avoided**, per the approved claim-safety pattern bank (`client/src/lib/facelessReelStudio.ts`) |

**Gap, repeated because it's still true:** `businessFacts.ts`'s `FactChannel`
type is `"sms" | "voice" | "web"` only — no `"reel"` channel exists yet, so
none of the above can be auto-verified against the live facts store from
this pipeline. Manual human check before publish.

---

## 4 · Full production pack

### Script — word-for-word, timed (27s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "Push the trunk button... and nothing happens." |
| 2 · VALUE | 0:03–0:09 | "Check the fuse first — a blown trunk-release fuse is the most common cause." |
| 3 · VALUE | 0:09–0:17 | "Fuse fine? Look for a manual release — a pull tab or cable loop inside the trunk itself." |
| 4 · VALUE | 0:17–0:23 | "Still stuck? The release solenoid or its cable may just be worn out." |
| 5 · CTA | 0:23–0:27 | "We can trace it down — Nick's Tire and Auto, link in bio." |

Machine-readable version: [`brief.json`](./brief.json).

### Asset list — real-footage only, no AI-clip generation route assumed

- Beat 1: real shop-shot, hand (no face) pressing a trunk-release button on
  a key fob or dash switch, trunk staying shut in frame
- Beat 2: macro shot of an open fuse box, a gloved hand pulling a fuse with
  a fuse-puller tool, holding it up to the light to check the element
- Beat 3: real shop-shot inside an open trunk, hand locating and pulling a
  manual release tab/cable loop, trunk popping open
- Beat 4: macro shot of a trunk-latch mechanism / solenoid at the striker,
  cable visibly frayed or the latch mechanism sticking (staged prop, not a
  customer's actual damaged part unless separately cleared)
- Beat 5: wide shop-bay shot, bay door open to daylight, no readable
  branding required in frame (voiceover carries the shop name)

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts` at
render time; script above is already timed to the 27s budget.

### Captions

[`captions.srt`](./captions.srt) — phrase-grouped, timed to the narration.
Burn in via ffmpeg `subtitles` filter (white bold sans, black outline,
bottom-third safe zone) — never as generator in-frame text.

### Editing instructions (manual — this session cannot execute any of this)

1. **Layer order (bottom to top):** background clip per beat → optional
   ambient garage room-tone → voiceover → burned-in captions → end-card CTA
   text (beat 5 only: shop name + "link in bio").
2. **Assembly:** concatenate the 5 beat clips in order, hard cuts (no
   crossfade — matches the render-integrity gate's distinct-frame check).
3. **Captions:** burn in per `captions.srt`, bottom-third safe zone.
4. **Color:** neutral shop-lighting grade, no urgent/red tint — this is a
   practical triage tip, not a breakdown-emergency framing.
5. **Output contract** (the pipeline's own render-integrity gate,
   `reelAssembly.ts` #800/#801, not evaluated this run — no `ffmpeg` in this
   session): container duration within 0.75s of 27s, ≥80% of expected 30fps
   frame count, ≥3 distinct MD5s among 5 sampled frames.
   `ffmpeg -f concat -i beats.txt -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook cross-post, `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 27s (within the 15–60s target range)
- **Posting slot:** hold to the account's fixed cadence; do not post ad hoc.
  Given 5 open unreviewed packs already queued today (§1), this pack should
  be treated as queued behind them, not a same-day candidate.
- **Caption/hashtags:** see §8
- **CTA type:** service/diagnostic-visit CTA, practical framing, no urgency
  device

---

## 5 · Credit-risk and fallback routing

Because this pack is designed real-footage-only (§1, §4), it does not carry
the credit-spend/AI-disclosure blocker that stalls most of the existing
backlog:

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
`BUDGET_DAILY_EXCEEDED`. At 10 topics produced today, `RESERVATION_FEED_CAP`
(2/day) would already have blocked most of today's output had any of these
packs actually reached a real enqueue call — another signal that the queue
is growing faster than the system's own daily-post ceiling would allow it to
drain, even before human review capacity is considered.

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

> Push the trunk button... nothing happens.
>
> Check the fuse first — it's the most common cause. If that's fine, look
> for a manual release inside the trunk itself. Still stuck? The solenoid
> or cable might just be worn out.
>
> We can trace it down.
>
> #cartips #trunkrelease #clevelandohio #tireshop

**Ad-ready variant A (relatable-forward):**

> Hook: "The trunk button that does absolutely nothing."
> Caption: Groceries stuck, no idea why. Nine times out of ten it's a fuse
> or a worn cable — not a whole new latch. Quick to check, quick to fix.
> CTA: Stop by 17625 Euclid Ave and we'll trace it down.

**Ad-ready variant B (question-forward):**

> Hook: "Trunk won't open and you don't know why?"
> Caption: Before you assume the worst, there's a manual release most
> drivers never find. We'll show you where it is — and fix it if it's not
> that simple.
> CTA: Call (216) 862-0005 or stop by.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY` — no live re-score from `calculateReelQualityScore()`,
no evidence citations from `evidenceResolver.ts` (both would require a
production DB read this session did not make). Not `PUBLISHED WITH
READ-BACK` — no `reel-canary` call, no `igPostId`, nothing generated,
rendered, or posted. Not `BLOCKED` — the pack is complete and usable.

**Operational note for the human reviewer:** this is the 10th reel-pack
topic this scheduled task has produced today (§1). Every individual pack has
been reasonable in isolation and none duplicate another, but the review
queue (5 open PRs before this one) is not shrinking. This session cannot
change its own firing cadence or merge its own PRs — flagging it here, and
via a direct notification alongside this pack, is the only lever available
from inside a single scheduled run. Worth an operator decision: either widen
review capacity/cadence, or reduce how often this task fires, so pack
production and pack review move at compatible rates.
