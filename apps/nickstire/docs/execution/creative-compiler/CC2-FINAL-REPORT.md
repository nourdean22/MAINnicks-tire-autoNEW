# Creative Compiler 2.0 — Final Report

Honest summary of the arc (Section 27). Baseline = reel 690001 (the manual-override
publish that shipped garbled "FTD913" text, a mis-spelled "Nixs" logo, and gloved
hands). Every claim below is backed by a merged PR + a test; unverified items are
marked as such.

## What was built (M1–M13, PRs #859–#870)

| M | Capability | Fixes | PR |
|---|---|---|---|
| 1 | Authenticated exact-hash operator override | manual override → audited, hash-bound, hard-gate-safe | #859 |
| 2 | Pipeline archaeology | mapped + confirmed all four defects 3.1–3.4 | #860 |
| 3 | Creative Thesis Lock | 3.1 intent flattened to prose | #860 |
| 4 | Winner→genome preservation | the deepest loss: winner not preserved | #861 |
| 5 | Provider-scene compile boundary | 3.4 raw prose to provider (+ ungated cron path) | #862 |
| 6 | Zero-generated-lettering transform | the FTD913 / Nixs / MAX PRESS class | #863 |
| 7 | Pre-generation anchor screen | a defective conditioning anchor propagating | #864 |
| 8 | Conditioning-aware compiler | contradictory continuity strategies | #865 |
| 9 | Critic truth-preservation | 3.3 critic rewrites the whole object | #866 |
| 10 | Deterministic pre-spend preflight | predictable defects reaching paid generation | #867 |
| 11 | Post-QA orchestrator | disconnected quality cores | #868 |
| 12 | Draft workspace (data model + endpoint) | compiler output not inspectable | #869 |
| 13 | Deterministic acceptance campaign | end-to-end proof | #870 |

## Baseline → now (the defect classes)

| 690001 defect | Now blocked at | Layers |
|---|---|---|
| garbled invented text ("FTD913") | design, compile, anchor, preflight | M5, M6, M7, M10 |
| mis-spelled brand logo ("Nixs") | design, compile, anchor | M5, M6, M7 |
| gloved hands (faceless) | design gate, compile boundary, anchor | M6-hardened faceless, M5, M7 |
| campaign truth silently replaced | thesis lock + critic preservation | M3, M4, M9 |
| contradictory continuity | conditioning-aware compiler | M8 |
| defect only detected, never prevented | pre-spend preflight + post-QA gate | M10, M11 |

## Acceptance (deterministic, `server/cc2AcceptanceCampaign.test.ts`)

The directive's high-risk subject (a car battery / diagnostic scanner) run through
every stage: thesis preserves the mechanic truth; the critic cannot swap it; a beat
requesting `FTD913` + a Nick's logo is neutralized in the provider scene; the
preflight BLOCKS a diagnostic-screen beat before any spend and PASSES a clean
redesign; hero-frame conditioning uses shared-identity continuity (no
contradiction); the workspace exposes creative intent vs the provider-safe scene;
a rendered pixel defect routes to `needs_operator_override` (the M1 override
satisfies it). **7/7 green, deterministic, zero spend.**

## Section 28 — Live-render acceptance (DONE 2026-07-18)

The live paid render ran end-to-end and **posted a defect-free reel**:

- **[instagram.com/reel/Da6vIDnCW05](https://www.instagram.com/reel/Da6vIDnCW05/)**
  — IG post `18103230203134531`, reel_jobs id `720002`, topic "Hidden Pothole
  Damage in Cleveland". 1080×1920, 21.0s, H.264 + AAC (VO + music).
- **M11 rendered-QA verdict: `approve` / publishGate `proceed`** — real vision
  critic, 8 frames evaluated, **0 findings**. Confirmed by frame-by-frame human
  review: perfectly-spelled gold-on-black caption overlays (hook, mid, CTA
  "SAVE THIS | DM POTHOLE"), no garbled text, no faces/hands, no misspelled
  brand — the entire 690001 defect class is gone on real pixels.
- Driven headlessly via `POST /api/admin/reel-canary` (start → advance → qa →
  publish), which enforces the M11 gate BEFORE publish (the tRPC canary skips
  it). Publish was `forced:false` — a clean, un-overridden proceed.

Three real defects the deterministic suite could never catch surfaced only under
the live drive, each now fixed or precisely scoped:

1. **Image conditioning is broken — CONFIRMED, flag stays OFF.** With
   `REEL_IMAGE_CONDITIONING=true`, the Higgsfield CLI rejected the hero-frame
   `--start-image`: *"Media \"https://…/hf_….png\" is neither a UUID nor an
   existing file path."* The pipeline passes the frame's public URL, but the CLI
   only accepts a Higgsfield **media UUID** or a **local file path**. There is no
   Higgsfield image-upload→UUID path in the codebase yet. **Fix (follow-up):**
   upload the hero frame to Higgsfield (or stage a local file) and pass the UUID.
   Until then `REEL_IMAGE_CONDITIONING` is OFF; the reel above rendered
   text-to-video with `REEL_AUTO_VISUAL_WORLD` still supplying text continuity.
2. **`reel_jobs.payload` was TEXT (64KB) — FIXED.** CC2 prompt packs reach ~70KB
   (measured 69,599 bytes), overflowing TEXT and failing enqueue AFTER reserving
   a governor slot (leaking the reservation; on the daily path, silently dropping
   the reel). Widened to MEDIUMTEXT — `drizzle/0090_reel_jobs_payload_mediumtext.sql`
   + schema.ts.
3. **Content-governor caps are load-bearing (working as designed).** Feed cap
   2/day, 3h spacing, 72h CTA / 7-day topic repeat windows correctly blocked
   retries; the block cleared once the orphaned reservations from the failed
   attempts above were released.

## What remains UNPROVEN / follow-up

- **Image conditioning UUID upload** — see finding 1 above. The autonomous visual
  world (`REEL_AUTO_VISUAL_WORLD`) is ON and supplies text continuity; the
  `--start-image` anchor stays OFF until the hero frame is uploaded to Higgsfield.
- **Preflight-block on the autonomous daily path.** `generateReelBriefAI` is
  non-deterministic and a brief that trips the M10 preflight (in-frame-text /
  free-claim) blocks that run. The canary retries; the daily cron generates once,
  so a bad brief silently costs the day's reel. A bounded regenerate-on-block loop
  in the enqueue path would close this (helps daily + canary alike).
- **Mandatory override at publish** (M11-continued) needs the QA decision
  persisted so the publish path can read it; today the gate is computed at the QA
  endpoint (and now re-computed at the reel-canary publish action), not enforced
  at the primary publish door.
- **Draft workspace React UI** — the data contract is built; the presentation
  layer is not.
- Most CC2 capabilities are `integration_verified` / `operator_only`, not
  `live_verified` — see `capability-ledger.json`.

## The measured target

The compiler now PREVENTS the 690001 defect classes upstream (design + compile +
preflight) rather than only detecting them downstream — verified across 12 merged
PRs and the deterministic acceptance suite. The final measure (a new reel that is
demonstrably more original AND defect-free on real pixels) is one operator-tapped
paid render away.
