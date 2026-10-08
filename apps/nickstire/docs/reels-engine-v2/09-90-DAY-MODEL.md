# Reels Engine v2 — The 90-day model, the status surface, and the operator handoff

Three layers. Each is named with what exists today (reality state in `AGENTS.md` vocabulary), so a
"90-day plan" never reads as a built machine.

## Layer 1 — strategic inventory (BUILT + WIRED, read-only)

`angle-bank.json`: 100 angles, 15 categories, feasibility-graded, rank = production order, the
first 20 production-ready, A001–A008 the pilot. It is an index over the committed packs (201 directories, 199 with a brief, 137 the production builder accepts, measured 2026-10-08)
(`docs/reel-packs`), not a second list: 88 angles name their pack, 12 are gaps. `shared/angleBank.ts`
refuses a file that breaks the order rules; `shared/angleBank.test.ts` checks every pack on disk and
which production-ready packs are in the daily rotation. The Creative Assistant's Sources row shows
the live state as the `angleBank` line (an unreadable bank reads `error:`, never "all in rotation").

Growing it: a new angle is a new pack (brief with ≥ 4 beats) plus one entry; a stub becomes
`pack_exists` the day its pack lands. Nothing is generated from the bank — the lane generates from
packs.

## Layer 2 — rolling rendered buffer of 14–21 days (PARTIAL — the mechanism exists at one per day)

What exists: the daily lane (`daily-reel-post`, every 60 min, `REEL_AUTOPOST_ENABLED`) builds **one**
Reel per day from the rotation (`REEL_OUTPUT_RULES.reelsPerRun = 1`), assembles it, and parks it as
`assembled` until an approval row exists (policy `formatPermissions.reel = auto` approves assembled
Reels on every tick; otherwise Instagram → Queue). Assembled-and-approved Reels **are** the buffer.
The drain publishes at most one per day (`reel_autopost_last_date`), oldest approved first.

What that means: the buffer grows only when approvals lag publishing, and it drains at the same rate
it fills. A true 14–21-day render-ahead needs the lane to produce faster than it publishes — a lane
parameter (`reelsPerRun`) or Studio renders — and **that is a multi-workflow change presented here,
not made**: more renders per day is more spend per day, and the rendered-QA critic, the repair cap
and the approval queue all scale with it. Decision for the operator, after the pilot's cost per
accepted Reel is measured.

## Layer 3 — scheduled publication (BUILT + LIVE, unchanged)

One door (`publishToSocial`), one Reel per day, approval-gated, mechanical-truth check at the door,
rendered QA re-run bounded (PR #2923). Cadence stays exactly as authorised today. A row in
`reel_jobs` is never a publish; only the drain's receipt (`status = posted`, `igPostId`) is.

## Mission status — in the existing admin, nothing new to build

| Question the operator asks | Where it already answers | State words |
|---|---|---|
| How much inventory is ready, in rotation, published? | Creative Assistant → Sources → `angleBank` | counts; `error:` when unreadable |
| Is anything finished and waiting on me? | Morning brief, Reel-lane line (`reelLaneHealth`): finished Reels awaiting approval; Instagram → Queue | number or UNKNOWN |
| Has the lane stalled? | Same line: 36 h without a post → days since | HEALTHY / DEGRADED / UNKNOWN |
| Is the shop's own evidence reaching posts? | Creative Assistant → Sources → `realEvidence` ("N/M published pieces in 30d carried real shop evidence") | measured / unmeasured |
| What should the floor shoot next? | Creative Assistant → capture card (six-shot set) | — |
| Did the delivered copy survive Instagram? | Morning brief delivered-copy line (`deliveredQa`) | measured / UNMEASURED after 3 |
| Which critic findings cost views? | Creative Assistant → quality card → Pipeline health | significant / none yet |
| Are the experiments valid? | Creative Assistant → experiment card (posts to the first decision look) | — |

Rule kept everywhere: a reader that fails becomes `inputs.<source> = "error: …"` and its cards are
omitted; a zero is a zero; UNKNOWN is never green.

## Operator handoff (2026-10-08, after PR #2923 deployed as 0f9453df)

| State | Item | What you do, exactly |
|---|---|---|
| **Live-verified** | Rendered-QA re-run for job 2040001 | Observed 15:31:26Z under 0f9453df: the gate re-ran the critic and held the Reel with the count; the 15:46Z and 16:01Z pulses respected the 30-minute spacing. The re-run works. The critic itself failed — it was the vision lane, as this row predicted: Gemini 2.5 Flash spent the 4,096-token budget on thinking (`finish_reason=length` at 573 chars). |
| **Live-verified (17:17:51Z, PR #2930)** | Critic thinking budget (`reasoning_effort: "medium"`, 16,384 tokens) | Nothing to do for the critic: its first run on this code completed for 2040001 (vision critic, `repair`, 17 findings). A paid fix follows the autonomy policy. Production's policy has `autonomousRepair.paidBeatRegeneration` set to `auto`, so the drain queued the beat-2 regeneration itself, within the daily generation budget and the per-asset repair cap. To make paid repairs wait for you, open Instagram → gear → Autonomy control → **Paid repairs → Ask me first** (one tap; Automatic asks for a confirm). To stop all paid generation, set Generation budget to $0 there or flip the Generation kill switch; the repair worker re-checks both before any provider call. **Until the branch after #2932 deploys, the budget edit fails** ("Policy not changed": the screen sent a partial policy the server refused); the kill switch works on either side of it. (This row used to promise a paid repair is never automatic; that was wrong.) |
| **Built + tested, not in rotation (by design)** | Proof packs A001–A003 | Capture their six-shot sets (`05-CAPTURE-CHECKLIST.md`), grade them `usable` in the pool. The generator now refuses any beat declared REAL or DETERMINISTIC (at enqueue and at generation; `shared/shotRouter.ts`), so admitting them before a publishable route exists for real footage and cards fails every day rather than generating a synthetic shot of real work; that route is the decision two rows down. Two more conditions: A001's beat 2 shows example gauge readings (3/32, 7/32) to replace with the captured tire's, and A002 rests on the `vibration` packet, which needs a citation or technician approval first. Each declares one ask, `visit` (STOP BY NICK'S): the end card carries it, the caption asks the same, and no beat or voiceover asks anything. Change it before admission if you want a different one. |
| **Decision needed** | Publish policy for $0 real-evidence renders | `02-PRODUCTION-DOCTRINE.md` §1: a `reels/real-evidence/…` prefix the stock guard allows only for registry `real_shop` assets, or route proof Reels through a paid lane once authorised. |
| **Done (2026-10-08, branch after #2932)** | Beat-caption height vs Meta's bottom 35% reserve | `CAPTION_BEAT_Y_FRAC` 0.62 → 0.55 and the word-timed captions' `MarginV` 500 → 720. Measured with Anton: at 0.62 every beat caption ended inside the reserve (one line 18-26 px, two lines up to 103 px); the word-timed captions sat wholly inside it. Now the worst case ends at 63.4% (31 px clear). |
| **Needs a technician** | Truth packets | Sign-off on the five packets; citations for `vibration` and `pothole_damage` (`shared/mechanicalTruth.ts`). |
| **Pre-existing, worth knowing** | 64 of the 201 pack directories are rejected by the production builder (`buildBriefFromApprovedProductionPack`: no brief, older brief schemas, under four beats, or no caption) | None of them is in the rotation, so nothing is wasted; they are not inventory until their brief is repaired. The first draft of the angle bank pointed 16 angles at rejected packs because it counted beats on disk instead of asking the builder — the test now asks the builder, which is the lane's own instrument. A rotation entry's slug list and the builder agree (133 / 133 then; 99 / 99 since the row below). |
| **Done (2026-10-08, branch after #2934)** | 34 packs out of the daily rotation | Both 2026-09-25 imports wrote the same placeholder shots into every beat ("Extreme macro of the physical subject…"), so the generator could not show their topics. They are in `ROTATION_EXCLUDED` with what each needs: 22 ask in their own notes for real shop footage (capture them like the proof packs), 12 name no route (write what the camera sees in each beat, then approve). The rotation is 99 packs; the cursor read 32, so nothing near today moved. Five production-ready angles are among them (A004, A009, A012, A014, A015), so the Sources line shows 12 of 20 in rotation. To re-admit one, append it to `APPROVED_REEL_PACK_SLUGS` after its beats name what the camera sees. |
| **Decision needed** | Shorter Reels (the Car Forensics 6–18 s tiers) | The lane renders 18–27 s: at least 4 beats over a 15 s storyboard (`REEL_OUTPUT_RULES.minBeats` / `minSeconds`), each beat at most one 4 s clip, plus the 3 s end card (`saveFreezeSeconds`). A shorter tier needs a lower floor and short packs written for it; the long one-take measurement shots need the real-footage route above. `duration_v1` has no short arm. |
| **Decision needed** | The hero character of every pack Reel | `buildBriefFromApprovedProductionPack` sets `objectCharacter: "rust_creeping_villain"` for every pack, so each pack Reel's prompt carries "Character energy: Rust, Creeping Villain" and, without a locked visual world, "Hero subject: Rust, Creeping Villain" in its continuity block — on a penny test or a TPMS light as much as on rust. The code says it is not rotated because it names the hero; fixed to rust, it names the wrong hero for most packs. Options: a neutral character, or one chosen per pack from its subject. It changes the look of every Reel, so it is your call. |
| **Partly done** | Pipeline honouring `StoryboardBeat.source` | Done as a refusal: a beat declared real or deterministic is never generated. Routing it (real footage, a card renderer) waits on the real-evidence decision above; the diagram/measurement card renderer and the render-ahead buffer (Layer 2) are not started. |
| **Decision needed** | The five experiments on a pack-driven lane | The daily lane publishes approved packs verbatim, so an arm that rewrites a brief never reaches it (hook and duration arms now collect only Studio briefs). Three of the five need approved pack variants: `06-EXPERIMENTS.md` has the design and the cost. |
| **Operator capture, ongoing** | 30-example reference corpus | Instagram search `tread depth`, `penny test`, `rotor`, `alignment`, `pothole Cleveland`; save 30 to a collection; Pattern Lab ingests them (`04-RESEARCH.md`). |
