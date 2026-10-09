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
| **Deployed (2026-10-09, #2940)** | READY buffer deadlock; paid repair only when one repair can clear the verdict | Nothing. Read the 2026-10-10 ET 06:00 `daily-reel-post` line in `cron_log`: an enqueue, not `production held`. |
| **Decision needed (2026-10-09)** | Job 2040001 (penny test, 13 blocking findings) and 1770004 (caption repost) | Retire both in Instagram > Queue. Rebuild the penny test from real capture, not a repair. |
| **Decision needed (2026-10-09)** | Old-style daily lane spend | About 60 credits per Reel from the 2,863 balance; `REEL_AUTOPOST_ENABLED=false` on Railway holds it. |
| **Operator capture (2026-10-09)** | Flagship capture day | The 90-minute table in `10-FLAGSHIP-PRODUCTION.md`; it unlocks Reels C, B and A. |
| **Live-verified** | Rendered-QA re-run for job 2040001 | Observed 15:31:26Z under 0f9453df: the gate re-ran the critic and held the Reel with the count; the 15:46Z and 16:01Z pulses respected the 30-minute spacing. The re-run works. The critic itself failed — it was the vision lane, as this row predicted: Gemini 2.5 Flash spent the 4,096-token budget on thinking (`finish_reason=length` at 573 chars). |
| **Live-verified (17:17:51Z, PR #2930)** | Critic thinking budget (`reasoning_effort: "medium"`, 16,384 tokens) | Nothing to do for the critic: its first run on this code completed for 2040001 (vision critic, `repair`, 17 findings). A paid fix follows the autonomy policy. Production's policy has `autonomousRepair.paidBeatRegeneration` set to `auto`, so the drain queued the beat-2 regeneration itself, within the daily generation budget and the per-asset repair cap. To make paid repairs wait for you, open Instagram → gear → Autonomy control → **Paid repairs → Ask me first** (one tap; Automatic asks for a confirm). To stop all paid generation, set Generation budget to $0 there or flip the Generation kill switch; the repair worker re-checks both before any provider call. **Until the branch after #2932 deploys, the budget edit fails** ("Policy not changed": the screen sent a partial policy the server refused); the kill switch works on either side of it. (This row used to promise a paid repair is never automatic; that was wrong.) |
| **Built + tested, not in rotation (by design)** | Proof packs A001–A003 | Capture their six-shot sets (`05-CAPTURE-CHECKLIST.md`), grade them `usable` in the pool. The generator now refuses any beat declared REAL or DETERMINISTIC (at enqueue and at generation; `shared/shotRouter.ts`), so admitting them before a publishable route exists for real footage and cards fails every day rather than generating a synthetic shot of real work; that route is the decision two rows down. Two more conditions: A001's beat 2 shows example gauge readings (3/32, 7/32) to replace with the captured tire's, and A002 rests on the `vibration` packet, which needs a citation or technician approval first. Each declares one ask, `visit` (STOP BY NICK'S): the end card carries it, the caption asks the same, and no beat or voiceover asks anything. Change it before admission if you want a different one. |
| **Decision needed** | Publish policy for $0 real-evidence renders | `02-PRODUCTION-DOCTRINE.md` §1: a `reels/real-evidence/…` prefix the stock guard allows only for registry `real_shop` assets, or route proof Reels through a paid lane once authorised. |
| **Done (2026-10-08, branch after #2932)** | Beat-caption height vs Meta's bottom 35% reserve | `CAPTION_BEAT_Y_FRAC` 0.62 → 0.55 and the word-timed captions' `MarginV` 500 → 720. Measured with Anton: at 0.62 every beat caption ended inside the reserve (one line 18-26 px, two lines up to 103 px); the word-timed captions sat wholly inside it. Now the worst case ends at 63.4% (31 px clear). |
| **Needs a technician** | Truth packets | Sign-off on the eight packets; citations for `vibration`, `pothole_damage` and `no_start` (`shared/mechanicalTruth.ts`). |
| **Pre-existing, worth knowing** | 64 of the 201 pack directories are rejected by the production builder (`buildBriefFromApprovedProductionPack`: no brief, older brief schemas, under four beats, or no caption) | None of them is in the rotation, so nothing is wasted; they are not inventory until their brief is repaired. The first draft of the angle bank pointed 16 angles at rejected packs because it counted beats on disk instead of asking the builder — the test now asks the builder, which is the lane's own instrument. A rotation entry's slug list and the builder agree (133 / 133 then; 99 / 99 since the row below). |
| **Done (2026-10-08, branch after #2934)** | 34 packs out of the daily rotation | Both 2026-09-25 imports wrote the same placeholder shots into every beat ("Extreme macro of the physical subject…"), so the generator could not show their topics. They are in `ROTATION_EXCLUDED` with what each needs: 22 ask in their own notes for real shop footage (capture them like the proof packs); 12 name no shot for any beat (11 only their batch's generic route, one a deterministic cutaway that has no lane yet): write what the camera sees in each beat, then approve. The rotation is 99 packs; the cursor read 32, so nothing near today moved. **Runway:** the cursor has no wrap, so past index 98 the daily lane falls to the topic miner (AI-written briefs). From 32 that is at most 67 posting days, 34 fewer than before; re-admitting packs or saving an active slate extends it. Five production-ready angles are among them (A004, A009, A012, A014, A015), so the Sources line shows 12 of 20 in rotation. To re-admit one, append it to `APPROVED_REEL_PACK_SLUGS` after its beats name what the camera sees. |
| **Researched, not built (2026-10-08)** | Shorter Reels (the Car Forensics 6–18 s tiers) | Not recommended. The lane renders 18–27 s (at least 4 beats over a 15 s storyboard, each beat at most one 4 s clip, plus the 3 s end card); 90 of the 99 rotation packs have 5 beats and 9 have 6, so most Reels run about 23 s (5 × 4 s + the end card). No source found measured reach or sends for educational Reels under 15 s against 15–30 s. Socialinsider (~6M brand Reels, 2026) and Emplifi (2023) both rank their shortest bucket (under 30 s) lowest on views; the one study with an under-15 s split (Highviz, 346 Reels, vendor) shows higher completion, which is mechanical, and lower engagement per view (7.3% vs 9.1%). The account's September Reels, all about the same length, skipped 32.7–82.9% before second 3, which only the opening can move: the camera and opening experiments target it, length does not. The 6–18 s claim in the two external docs traces to no study. What would change this: a measured sends-per-reach lift for under-15 s educational Reels, or this account's own skip and watch data once the opening experiments read. |
| **Done (2026-10-08, operator-approved)** | The hero character of every pack Reel | Pack Reels used to carry `objectCharacter: "rust_creeping_villain"`, so each provider prompt said "Character energy: Rust, Creeping Villain" (and "Hero subject: Rust…" without a locked visual world) on a penny test or a TPMS light. Now `plain_part`: no persona anywhere a model reads it. The prompt has no Character line, the continuity block and the visual-world frame say "Hero subject: <beat 1's visual>", and the vision critic is told the hero is the part beat 1 shows. A persona per pack was rejected: the characters are metaphors ("a balloonist whose altitude is your PSI") and a video model reads the noun. Studio briefs keep their personas. |
| **Partly done** | Pipeline honouring `StoryboardBeat.source` | Done as a refusal: a beat declared real or deterministic is never generated. Routing it (real footage, a card renderer) waits on the real-evidence decision above; the diagram/measurement card renderer and the render-ahead buffer (Layer 2) are not started. |
| **Partly done (2026-10-08, operator-approved)** | The five experiments on a pack-driven lane | #3, documentary vs cinematic camera, is wired for pack Reels (`visual_direction_v1`): the arm picks the lens family when the pack is built, so it needs no new content. #1 is wired as approved pack variants (`opening_mechanism_v1`) and inert until a pair is approved: `APPROVED_PACK_VARIANTS` is empty and starting it is refused until one pack has an approved variant for both arms. #4 uses the same mechanism and needs its own variants and preset. A pack-build arm is recorded only when the brief says it was built with that arm. #2 needs real footage; #5 changes the publish path. Start any of them once posting is stable (`06-EXPERIMENTS.md` has the calls and how to approve a pair). |
| **Operator capture, ongoing** | 30-example reference corpus | Instagram search `tread depth`, `penny test`, `rotor`, `alignment`, `pothole Cleveland`; save 30 to a collection; Pattern Lab ingests them (`04-RESEARCH.md`). |
