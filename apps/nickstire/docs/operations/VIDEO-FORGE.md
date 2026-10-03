# NOUR Video Forge: self-hosted generation lane

Status ledger written 2026-10-03 against `main` @ `e03787d94d`. It uses the
repo's reality-state vocabulary. Merging the code does not make the lane live.

## What changed

`self_hosted` is now a fourth reel video provider, alongside `veo`, `higgsfield`
and `template_stock`. It talks to `apps/video-forge`, a separately deployed GPU
service. The model is a profile beneath the provider (`VIDEO_FORGE_PROFILE`).
Its capability, timing, cost and license data live in
`shared/mediaModelRegistry.ts`, and CI keeps that file in parity with
`apps/video-forge/forge/profiles.json`.

| Piece | File | Reality state |
|---|---|---|
| Provider seam (selection, credential presence, ledger model, durable-storage precondition, resume handle detection, settle at measured compute) | `server/services/reelPipeline.ts` | BUILT + WIRED (explicit pin only; default unchanged) |
| Client (HMAC, idempotent submit, per-profile poll window/ceiling/heartbeat, output verify + re-host, receipts) | `server/services/videoForgeClient.ts` | BUILT + WIRED |
| Selective repair branch (stable key per logical repair; a local timeout keeps the reservation and doesn't consume an attempt) | `server/services/selectiveRepair.ts` | BUILT + WIRED |
| Cost policy separated from cost amount (`reelClipCostPolicy().requiresSpendApproval`) | `server/services/generationLedger.ts`, `server/services/qualityGate.ts` | BUILT + WIRED (veo/higgsfield/template_stock decisions unchanged) |
| `PROVIDER_CONFIG_BLOCKED` error class (a license or config refusal is not an auth failure) | `shared/providerErrors.ts` | BUILT + WIRED |
| Provider-specific prompt compiler (canonical spec is never mutated) | `shared/forgePromptAdapter.ts` | BUILT + WIRED |
| GPU service: job store, auth, worker, mock backend | `apps/video-forge/forge/*` | BUILT + TESTED on CPU |
| LTX-2.5 / Wan 2.2 backends | `apps/video-forge/forge/backends/{ltx2,wan22}.py` | BUILT-UNWIRED (never executed on a GPU) |
| RunPod image / Modal app | `apps/video-forge/{Dockerfile,modal_app.py}` | BUILT, NOT DEPLOYED |
| Benchmark corpus (48 real beats) + runner + blind pairwise sheet | `apps/video-forge/bench/*` | BUILT; exercised only against the mock |
| GPU canary, bake-off, quality result | — | DEFERRED (no spend authorized) |
| Self-hosted image generation (Visual World / carousel / IG image) | — | MISSING (see the dependency graph) |

## Wire proof (CPU mock, 2026-10-03)

`scripts/video-forge-e2e.ts`, running the production client code against a real
Forge process over HTTP and HMAC, did the following:

1. Submitted a 704×1280 5 s job with a hero-frame reference image.
2. Forced a local timeout right after submit.
3. Resumed. The **same** job id came back. One job exists in the Forge DB; no duplicate render.
4. Pulled the output, verified its sha256, mp4 container and dimensions, and re-hosted it through `storagePut`.
5. Recorded a receipt: `gpuSeconds 1.6`, `gpuType CPU-e2e`, `computeUsd 0.0011` at the reference $/h. This is mock compute, not a model.

What this proves: the contract. What it doesn't prove: anything about model
quality, real GPU latency, or real cost.

## What still requires Higgsfield (verified by grep, 2026-10-03)

```text
Reel clip generation ─ reelPipeline ─┬─ veo
                                     ├─ higgsfield   (prod pin today)
                                     ├─ template_stock
                                     └─ self_hosted ─ Video Forge   ← NEW, opt-in
Beat repair ─ selectiveRepair ───────┴─ same four lanes

STILL HIGGSFIELD-ONLY:
  routers/content.ts generateReelVideo (admin "Generate Reel Video")
      └─ higgsfieldStudio.generateReelClipVideo  ← bypasses the provider router entirely
  visualWorld.ts reference frames ─┐
  routers/content.ts carousel ─────┼─ higgsfieldStudio.generateCarouselSlideImage (gpt_image_2)
  igAutopost.ts single image ──────┘
  Health / credentials: cron/scheduler.ts higgsfield-session-keepalive,
      socialDeliveryIssues.ts, routers/instagramAdmin.ts (session liveness,
      API-key cache, account health), igAutopost.ts ensureHiggsfieldBinary
  Ledger: COST_ESTIMATES_USD.seedance_clip / gpt_image_2 (unverified estimates)
```

The image path was not rewired on purpose. A "provider-neutral" image entry
point with only one implementation would be an empty abstraction. The image
seam should land together with a real self-hosted image backend. Candidates
whose licenses are verified clean: Qwen-Image (Apache-2.0), HiDream-I1/O1 (MIT),
FLUX.1 schnell / FLUX.2 klein 4B (Apache-2.0), Z-Image. Qwen-Image-2.1 is
research-only and FLUX dev is non-commercial; both are rejected.

## License manifest (reviewed 2026-10-03)

| Profile | Checkpoint | Upstream license | State | Conditions |
|---|---|---|---|---|
| `ltx-2.5-dfr` / `ltx-2.5-distilled` | `Lightricks/LTX-2.5` | LTX-2.x Community License | APPROVED_WITH_CONDITIONS | Entities at or above $10M annual revenue (affiliates included) need a paid license. No offering of a competing generation service. Provenance/disclosure features must stay on, and AI generation must be disclosed. Derivatives stay under the same license. **Operator must confirm revenue is under $10M.** |
| `wan2.2-ti2v-5b` | `Wan-AI/Wan2.2-TI2V-5B` | Apache-2.0 (code + weights) | APPROVED_COMMERCIAL | Keep the NOTICE |
| `wan2.2-i2v-a14b` | `Wan-AI/Wan2.2-I2V-A14B` | Apache-2.0 (code + weights) | APPROVED_COMMERCIAL | Keep the NOTICE. Image-to-video only (needs an approved hero frame). This is the QUALITY candidate with no revenue gate and no competition clause; the bake-off decides whether it or LTX DFR holds QUALITY. |
| `minimax-h3` | `MiniMaxAI/MiniMax-H3` | MiniMax community license | TERRITORY_BLOCKED | The US is an excluded territory for the model and its outputs |
| `mock-testpattern` | — | — | UNKNOWN | CI only; can never be production |
| Wan 2.5/2.6/3.0 | — | — | REJECTED (no downloadable weights) | — |

Evidence for these states comes from the Model Council reports for this
mission, which cite the license files directly. Checkpoint sha256s are
`UNPINNED` until the canary pins them.

## Operator actions remaining

1. Authorize GPU spend and a cap for the canary. Use one 80 GB GPU on RunPod or Modal.
2. Confirm Nick's is under the $10M LTX revenue threshold. If not, use Wan 2.2 only.
3. Deploy the worker, pin model revisions and sha256s, and run `scripts/video-forge-e2e.ts`.
4. Run the bake-off: 48 cases × {Higgsfield baseline, LTX distilled, LTX DFR, Wan 5B, Wan A14B} × {text, hero}. Wan A14B runs the hero arm only. Then rendered QA and blind pairwise review. Decide on cost per **accepted** clip.
5. Only then: set `rollout: operator_selectable` in both registries, set `REEL_VIDEO_PROVIDER=self_hosted` on a limited cadence, and keep Higgsfield as the fallback.
