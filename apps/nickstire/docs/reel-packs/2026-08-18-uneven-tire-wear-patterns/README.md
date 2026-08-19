# Reel production pack — "Your tire wear has a shape" (WEARSHAPE)

Scheduled-task run · 2026-08-18 · mode `PRODUCTION` (pack only, per
`.claude/skills/nickstire-reel-operator/SKILL.md`) · campaign keyword **WEARSHAPE**

**No generation, DB read, or publish call was made against production this run.**
This is a scheduled/automated firing with no live operator present — the operator
skill's hard rule is explicit that a stored scheduled prompt does not authorize
`reel-canary` generation or publish calls, and that repetition-ledger/quality-score
reads against the live database are themselves a production read, not a free
action. This session made none of those calls. See §1 and §9.

> **Operator note — backlog, not a defect in this pack.** At the time this pack
> was written, `gh pr list --state open --search "reel pack in:title"` returned
> **30 open, unmerged** reel-production-pack PRs (#1610 onward, most from the
> last ~36 hours, arriving roughly hourly). None of the topics duplicate this
> one, so this pack is not a repetition — but the volume itself is the finding
> worth surfacing: this scheduled task is producing packs faster than anyone is
> merging or acting on them, and the pipeline for turning a pack into an actual
> rendered/posted Reel (`/api/admin/reel-canary`) has, as far as this session
> can tell from the file system, not consumed any of them yet. Worth an operator
> decision on cadence (slow the schedule) or throughput (merge/action the
> backlog) rather than continuing to add packs into a growing queue.

---

## 1 · Mode, capabilities, repetition context

**Mode:** `PRODUCTION` — one concept, developed into a full pack. Stops short of
any `/api/admin/reel-canary` call (`start`/`advance`/`qa`/`publish`) and short of
any live read against the production TiDB database.

**Capabilities — not probed this run, stated as such rather than assumed:**

| Capability | Status this run | Why |
|---|---|---|
| `getHiggsfieldAccountHealth()` (creds/balance) | Not called | Requires a live server process + a live Higgsfield session credential; this is a Claude Code repo session, not the running app. Confirmed no `HIGGSFIELD_*`/`REEL_*`/`ADMIN_API_KEY`/`DATABASE_URL` env vars are present in this session (`env \| grep` returned nothing). |
| `REEL_VIDEO_PROVIDER` | Read from doc, not live env | `docs/operations/REEL-PIPELINE.md` last documented prod as pinned to **`template_stock`** (free local-ffmpeg lane, not Higgsfield/Seedance). Treat as last-known, not live-confirmed. |
| `REEL_GENERATION_ENABLED` | Not read live | Gate on the cron pulse job; not queried this run. |
| Voiceover TTS (`reelVoice.ts` → Google Neural2 / ElevenLabs) | Not called | No TTS tool connected to this session; would also spend the app's real quota from an unattended run. |
| `/api/admin/reel-canary` (start/advance/qa/publish) | Not called | Blocked by the hard rule above for a scheduled firing. |
| Meta/Instagram Graph API posting | Not called | Protected customer-facing action per root `AGENTS.md`; requires an explicit live operator instruction every time, which this run does not have. |
| CapCut or equivalent editor | Not connected | No CapCut/editing-tool MCP connector is available in this session. |

Net answer to the workflow's own step 1 ("check available tools"): **no rendering
tool chain (TTS, Higgsfield, ffmpeg-against-prod, CapCut) or publish tool is
available to this session.** Per the workflow's own step 3/5, this produces a
production-ready pack, not a claimed finished MP4.

**Repetition-ledger context:** `getRecentReelSignals()` (the real ledger) reads
production TiDB and was not queried. As a file-based proxy, both
`ls apps/nickstire/docs/reel-packs/` (5 merged packs: penny test, tire
expiration, tread fingerprint, battery/summer-heat, squealing-vs-grinding-brakes)
and `gh pr search "reel pack in:title" --state open` (30 open draft PRs, listed
in the operator note above) were checked. **"Uneven tire wear patterns" does not
appear in either list.** The closest existing topics are the penny test (tread
*depth*, not wear *pattern shape*) and the alignment-pull item on the slate
(car pulling to one side while driving, not tread wear shape) — this pack is a
distinct diagnostic angle from both. This is a file/PR-search check, not a
substitute for the real ledger.

---

## 2 · Candidate scores and selection

No fixed slate item covers this angle, so this run generated fresh candidates
in the same diagnostic-hook family already proven out by the tread-fingerprint
and squealing-vs-grinding-brakes packs (a visual/physical "read the clue"
structure), screened against the current open-PR list to avoid collision:

| Candidate | Hook strength | Evergreen? | Already covered? | Selected? |
|---|---|---|---|---|
| Uneven tire wear patterns (center/edge/feather/cupping) | Strong — visual pattern-recognition hook, distinct shapes are inherently show-able | Yes | No (checked against 5 merged + 30 open packs) | ✅ **Selected** |
| Tire pressure and fuel economy | Weak — informational, low urgency, needs a price/savings claim this run can't source | Yes | No, but low hook | Parked |
| Windshield wiper streak causes | Moderate | Seasonal-adjacent (better in fall) | No | Parked (timing) |
| Power steering fluid leak signs | Moderate | Yes | No | Parked (secondary choice) |

Selected for the strongest hook among available options: tire wear shape is a
concrete, physically show-able pattern (four distinct visual signatures) that
lets each beat be a genuinely different macro shot rather than four takes on
the same object, and it closes a real content gap — every existing pack about
tires covers depth (penny test) or an isolated symptom, not wear *shape* as a
diagnostic read.

---

## 3 · Claim evidence

| Claim in the script | Source checked | Status |
|---|---|---|
| "Wear straight down the center often means overinflated. Wear on both edges often means underinflated." | General automotive mechanical knowledge (inflation pressure vs. contact-patch shape is standard tire-engineering fact) | **UNKNOWN against this repo's evidence store** — `evidenceResolver.ts`/`evidenceRecords.ts` was not queried live this run (would be a prod DB read). No `EvidenceRecord` citation is attached. Phrasing uses "often" (approved soft-language pattern) rather than an absolute. |
| "Feathered saw-tooth texture ... usually means alignment, not air" | Same — standard mechanical fact, not shop-specific | **UNKNOWN against this repo's evidence store**, same reasoning. Phrasing uses "usually" and frames it as "one clue," matching the approved soft-language list in `facelessReelStudio.ts` (*can point to · may indicate · worth checking · one clue · do not guess · stop by and we'll take a look*). |
| "Cupping ... that's one clue a shock or strut is wearing out" | Same — standard mechanical fact | **UNKNOWN against this repo's evidence store**, same reasoning. Deliberately hedged as "one clue," not a diagnosis. |
| No price, warranty, or shop-specific policy claim is made anywhere in this script | `businessFacts.ts` `SEED_FACTS` reviewed (read-only, code file, not a live DB read) | **N/A — deliberately avoided.** This topic doesn't need a business fact, which sidesteps the channel gap noted below. |

**Gap, stated plainly:** `businessFacts.ts`'s `FactChannel` type is
`"sms" | "voice" | "web"` only — there is no `"reel"` channel. This script
doesn't lean on that store, so the gap doesn't block this particular pack, but
it would block any future reel script that wants to quote a price or warranty
line verbatim.

---

## 4 · Full production pack

### Script — word-for-word, timed (27s total, 5 beats)

| Beat | Window | Narration (word-for-word) |
|---|---|---|
| 1 · HOOK | 0:00–0:03 | "Your tire wear has a shape — and that shape can point to what's wrong." |
| 2 · SETUP | 0:03–0:08 | "Wear straight down the center often means overinflated. Wear on both edges often means underinflated." |
| 3 · VALUE | 0:08–0:14 | "One edge wearing more, or a feathered saw-tooth texture — that usually means alignment, not air." |
| 4 · VALUE | 0:14–0:20 | "Cupping — little scalloped dips around the tire — that's one clue a shock or strut is wearing out." |
| 5 · CTA | 0:20–0:27 | "Send this to someone whose tires look uneven. Stop by and we'll take a look — Nick's Tire and Auto." |

Full machine-readable version (beats, per-beat visual prompts, negative
prompt, audio notes): [`brief.json`](./brief.json).

### Asset list

**Primary route — AI-generated clips (Higgsfield/Seedance-style), one per beat.**
Per-beat prompts are in `brief.json`. Standing negative prompt for every beat:

> `faces, hands, human figures, on-screen text, logos, watermarks, subtitles`

**Fallback / actual-prod route — `template_stock` (free, local ffmpeg, no API
spend).** Per `docs/operations/REEL-PIPELINE.md`, this is what prod currently
renders on. Search terms for free stock (Pexels/Pixabay/Coverr — search
manually; no specific clip URLs are asserted here since none were verified live
this run):
- Beat 1: "tire tread macro rotating" / "tire tread close up"
- Beat 2: "tire wear comparison macro" / "tire tread pattern closeup"
- Beat 3: "tire feathering wear" / "worn tire tread texture macro"
- Beat 4: "tire cupping wear" / "scalloped tire wear macro"
- Beat 5: "auto repair alignment rack garage bay"

**Music:** none assigned — see §6.

**Voiceover:** not generated this run. Route through `reelVoice.ts`
(Google Neural2 or ElevenLabs) at render time; script above is exactly what
gets fed to it, already timed to the 27s budget.

### Captions

[`captions.srt`](./captions.srt) — 10 cards, phrase-grouped (not literal
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
4. **Color:** cooler, slightly desaturated grade on beats 1–4 (macro/technical
   mood), warm shift on beat 5 (CTA, inviting garage-bay daylight).
5. **Output contract (must hold for the pipeline's own render-integrity
   gate):** container duration within 0.75s of 27s, video-stream duration
   within 0.75s (checked independently of container duration, since the audio
   track can outlast the video track), ≥80% of expected 30fps frame count,
   ≥3 distinct MD5s among 5 sampled frames (motion proof — every beat here is
   a slow camera move/orbit/push-in, not a static still).
   Reference command shape (documented in `reelAssembly.ts`, not executed
   this run):
   `ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4`

### Posting specs

- **Platform:** Instagram Reels + Facebook (cross-post), `@nicks_tire_euclid`
- **Dimensions:** 1080×1920, 9:16, MP4, H.264, 30fps
- **Duration:** 27s (within the 15–60s target range and the account's own
  25–30s CTA-block convention)
- **Posting slot:** hold to the account's fixed posting cadence documented in
  `REEL-SLATE-2026-07-31.md` (7:00 AM or 2:00 PM ET) — do not post ad hoc, and
  check the current feed-post reservation cap before scheduling (see §5)
- **Caption/hashtags:** see §8 below
- **CTA type:** SEND (not SAVE) — per the account's corrected objective (a
  "save this" CTA measured `saved = 0.00` across the account's first 8 reels,
  per the slate doc)

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
`REPEAT_CTA` (72h) → `REPEAT_TOPIC` (7 days) → `BUDGET_DAILY_EXCEEDED`. Given
the volume of unmerged same-family packs noted above, an operator moving any
of these packs toward real enqueue should check `content_reservations` for
today's slot state before assuming a slot is open.

---

## 6 · Audio / music rights

**No rights ledger for music exists in this repo** (confirmed gap, consistent
with every prior pack in this directory). This pack sidesteps it deliberately
rather than asserting a track is cleared: **no music bed is assigned.** The
reel is voiceover + captions + an optional single royalty-free ambient/SFX
layer (garage room tone, soft rubber-scuff texture), which also scores well on
the pipeline's muted-first requirement since the captions alone carry full
meaning. If the operator wants a music bed, that requires a specific track
with asset ID, source, license scope, territory, and expiry tracked by hand —
this pack does not supply one.

---

## 7 · QA matrix

No rendered asset exists yet, so every render-time gate is `BLOCKED` pending an
actual render — not `PASS`, and not silently omitted:

| Gate | Real module | Status | Basis |
|---|---|---|---|
| Motion-first quality score (≥70/75) | `calculateReelQualityScore()` | `BLOCKED` | No live call made; §4/brief.json carries a self-estimate (61/75) that is explicitly NOT this function's output |
| Render-integrity (#800/#801: duration, frame count, ≥3 distinct MD5s) | `reelAssembly.ts` | `BLOCKED` | No file rendered — nothing to probe |
| Rendered QA / vision critic | `renderedQa.ts` | `BLOCKED` | No frames exist to critique |
| Repair routing | `repairRouter.ts` | `BLOCKED` | No job exists |
| Consolidated publish gate | `qualityGate.ts` `evaluateReelPublishGate()` | `BLOCKED` | Not evaluated — this is exactly the gate that must return `proceed` before any real publish, and it was not invoked |
| Human-approval door (hash-checked) | `instagramAdmin.publishPost` | `BLOCKED` | Not reached — no asset to approve |

---

## 8 · IG/FB copy

**Primary caption:**

> Your tire wear has a shape — and that shape can point to what's wrong.
>
> Wear straight down the center often means overinflated. Wear on both edges
> often means underinflated.
>
> One edge wearing more, or a feathered saw-tooth texture? That usually means
> alignment, not air. Cupping — little scalloped dips — is one clue a shock or
> strut is wearing out.
>
> Send this to someone whose tires look uneven.
>
> #tires #cartips #clevelandohio #carmaintenance #tirewear

**Ad-ready variant A (hook-forward, shorter):**

> Hook: "Your tires are trying to tell you something — and most people never
> learn to read it."
> Caption: Center wear, edge wear, feathering, cupping — four different
> shapes, four different problems. Know which one you've got before it costs
> you more than a tire.
> CTA: Not sure what your wear pattern means? Stop by and we'll take a look —
> free, no pressure.

**Ad-ready variant B (question-forward):**

> Hook: "Ever looked at your tire tread and wondered why it's worn weird on
> one side?"
> Caption: That shape isn't random — it's a clue. Alignment, inflation, worn
> suspension parts all leave a different signature on the tread.
> CTA: Bring it by — we'll tell you which one it is, straight, free.

---

## 9 · Final status

**`READY FOR HUMAN APPROVAL`**

Not `PRODUCTION-READY`: the self-estimated quality score (61/75, see
`brief.json`) sits below the pipeline's real 70/75 auto-pass floor on two
dimensions specifically — **loop** (the CTA frame doesn't loop cleanly back
into the hook frame) and **sourced fact** (no `EvidenceRecord` in
`evidenceResolver.ts` currently backs the inflation/alignment/suspension wear
claims, and that store wasn't queried live this run to check). Not
`PUBLISHED WITH READ-BACK` — no `reel-canary` call, no `igPostId`, nothing was
generated, rendered, or posted. Not `BLOCKED` outright — the pack is complete
and usable; an operator (or a live-authorized session) can hand it to the real
pipeline via `/api/admin/reel-canary {action:"start", topic:"uneven tire wear
patterns"}`, let the server re-score and re-render for real, and only then
move toward publish.

**Separately from this pack's own status: see the backlog note at the top of
this document.** 30 open draft PRs for prior packs is an operator-attention
item independent of whether this specific pack is good.
