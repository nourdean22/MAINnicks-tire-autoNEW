# NOUR Video Forge

Private, provider-neutral GPU generation service. nickstire's Reel Factory reaches
it as the `self_hosted` reel video provider; the open-weight model is a **profile**
underneath (`ltx-2.5-dfr`, `ltx-2.5-distilled`, `wan2.2-i2v-a14b`, `wan2.2-ti2v-5b`). Reel jobs,
storyboard beats, Visual World, assembly, rendered QA, selective repair, the
generation ledger and Meta publishing stay canonical in nickstire. This service
renders one clip per request.

**Reality state (2026-10-03):** BUILT + UNIT/INTEGRATION TESTED on CPU with the
ffmpeg mock backend. **No GPU canary has run** (no compute spend authorized).
The LTX-2.5 / Wan 2.2 backends are BUILT-UNWIRED to hardware: their CLI templates
follow upstream docs but have never executed. Do not call this live.

## Contract

| Route | Purpose |
|---|---|
| `POST /v1/jobs` | Submit. Idempotent on `idempotency_key`: the same key + same request returns the existing job (any status). The same key + a different request returns 409. |
| `GET /v1/jobs/{id}` | Status, `heartbeat_at`, progress, receipt (`gpu_seconds`, `gpu_type`, model/workflow version, seed, output sha256/bytes/dims/fps/duration) |
| `GET /v1/jobs/{id}/output` | The verified MP4 |
| `POST /v1/jobs/{id}/cancel` | Cancel queued/running work. A late success after cancel is discarded. |
| `GET /v1/capabilities` | Profiles with license and rollout state |
| `GET /health` | Worker liveness, GPU, VRAM, queue depth, running jobs, loaded backends, success rate, p50/p95. Prints `UNKNOWN` when there's no data, never a made-up zero. |

Auth: HMAC-SHA256 over `"{ts}.{METHOD}.{path}.{sha256(body)}"` in
`x-forge-signature`, with `x-forge-timestamp` allowed ±300 s of skew. If
`FORGE_SECRET` is unset, every request is refused.

## Safety properties (each one has a test in `tests/test_forge.py`)

- **No duplicate renders.** The job key is unique, the request fingerprint is checked, and nickstire writes the key to the DB before it submits.
- **No zombies.** Every profile has a hard ceiling and a stale-heartbeat limit. A sweeper fails any job that passes either one.
- **Restart recovery.** On boot, jobs still marked `running` go back to the queue, up to `FORGE_MAX_RESTARTS` times. After that they fail as `worker_restart_lost`. Accepted work is never orphaned without a trace.
- **License gate.** Profiles that aren't `APPROVED_*` get a 403 `license_blocked`. `FORGE_ALLOW_UNAPPROVED_FOR_TESTS=1` exists for the CPU mock only.
- **No SSRF.** Reference images arrive as bounded base64 (png/jpg/webp, max 8 MB, magic-byte checked). The service never fetches a URL a client sends.
- **No arbitrary workflow JSON.** Clients pick a profile, never a graph.
- **No storage credentials on the GPU box.** nickstire pulls the output, checks sha256, the mp4 container and the dimensions, then re-hosts through `storagePut`.
- **Output validation.** ffprobe confirms codec h264, the exact dimensions, fps ±0.5, and duration ±0.75 s before a job can succeed.
- **Classified failures.** Error codes: `oom`, `model_load_failure`, `inference_failure`, `output_validation_failure`, `hard_ceiling`, `stale_heartbeat`, `worker_restart_lost`, `cancelled`, `capacity_unavailable`, `invalid_input`, `invalid_reference_image`, `unsupported_*`, `capability_mismatch`, `license_blocked`, `config_unavailable`. nickstire maps each one to the existing provider-error taxonomy.

## Run locally (CPU, mock backend)

```bash
cd apps/video-forge
python3 -m pip install -r requirements-test.txt
python3 -m unittest discover -v -s tests
FORGE_SECRET=dev FORGE_DATA_DIR=/tmp/forge FORGE_ALLOW_UNAPPROVED_FOR_TESTS=1 FORGE_BACKEND_OVERRIDE=mock \
  python3 -m uvicorn forge.app:app --port 8787
# wire proof from nickstire's real client code:
cd ../nickstire && VIDEO_FORGE_URL=http://127.0.0.1:8787 VIDEO_FORGE_SECRET=dev npx tsx scripts/video-forge-e2e.ts
```

## No-spend canary preflight

Before allocating a GPU, validate the exact backend build plan locally:

```bash
cd apps/video-forge
FORGE_INSTALL_LTX=0 FORGE_INSTALL_WAN=1 \
WAN22_REF=1ea34ff48f87168174e12956e200b1d908b1c5ff \
WAN22_WEIGHT_REV=921dbaf3f1674a56f47e83fb80a34bac8a8f203e \
FORGE_MODAL_GPU=A100-40GB \
python scripts/canary_preflight.py --profile wan2.2-ti2v-5b
```

This preflight intentionally supports **only** `wan2.2-ti2v-5b`; A14B and LTX
remain blocked until they get their own exact code + weight pins and regression tests.
After the checkpoint is populated locally/RunPod, run the same preflight with
`--model-dir /models/Wan2.2-TI2V-5B`. It re-hashes every inference-visible
checkpoint artifact (weights, configs, tokenizer files, etc.) while excluding
only known local cache/generated provenance metadata, and requires `SHA256SUMS`
plus `MANIFEST.json` with the exact repo/revision. The runtime repeats that
verification before serving the profile, and derives the receipt's checkpoint
revision from the verified manifest. The preflight never
allocates a GPU, downloads weights, or changes production state.

## GPU canary (operator action, needs spend approval)

1. Lowest-risk first proof: Wan 2.2 TI2V-5B only, with `FORGE_INSTALL_LTX=0` and `FORGE_ENABLED_PROFILES=wan2.2-ti2v-5b`. On Modal use `FORGE_MODAL_GPU=A100-40GB` for an exact 40 GB card; the Function reserves 4 CPU cores + 96 GiB host RAM for the upstream offload/T5-on-CPU path. `A100` is also valid but Modal may upgrade it to 80 GB.
2. Fetch only Wan. On Modal run `fetch_wan_5b`. On RunPod use: `FETCH_LTX=0 FETCH_WAN=1 WAN22_REV=921dbaf3f1674a56f47e83fb80a34bac8a8f203e scripts/fetch_models.sh`. Preserve the generated full-checkpoint manifest + sha256s, then copy accepted checkpoint hashes into `forge/profiles.json` and `apps/nickstire/shared/mediaModelRegistry.ts`.
3. For a direct RunPod Docker build, pass the Docker **build args** explicitly; the `FORGE_*` runtime environment variables do not set Docker `ARG` values:
   ```bash
   docker build -t nour-video-forge:wan5b \
     --build-arg INSTALL_LTX=0 \
     --build-arg INSTALL_WAN=1 \
     --build-arg ENABLED_PROFILES=wan2.2-ti2v-5b \
     --build-arg WAN22_REF=1ea34ff48f87168174e12956e200b1d908b1c5ff \
     --build-arg WAN22_WEIGHT_REV=921dbaf3f1674a56f47e83fb80a34bac8a8f203e \
     .
   ```
   Start the worker with `FORGE_ENABLED_PROFILES=wan2.2-ti2v-5b`, without `FORGE_ALLOW_UNAPPROVED_FOR_TESTS` or `FORGE_BACKEND_OVERRIDE`. It refuses unverified mounted Wan bytes before accepting work, and the Docker build verifies the pinned FlashAttention wheel hash before installing it.
4. Run `scripts/video-forge-e2e.ts` against it. That gives the first real receipt.
5. Run the bake-off: `bench/run_bench.py` on the 48-case corpus × profiles × arms (`text`, `hero`). Then send the clips through nickstire's rendered QA, run `bench/make_pairwise.py`, and do the blind human review.
6. Only after that: move the profile's `rollout` to `operator_selectable` (in both files), then pin `REEL_VIDEO_PROVIDER=self_hosted` on a limited cadence.

LTX/DFR is deliberately **not** part of this first canary. When its exact pins are
reviewed, prepare it explicitly with `FETCH_LTX=1 FETCH_LTX_DFR=1` plus pinned
`LTX25_REV` and `LTX25_DFR_LORA_REV`; the fetch script refuses DFR without the
separate LoRA revision. Extend the preflight with exact LTX pins/tests before enabling it.

## Benchmark corpus

`bench/corpus.v1.jsonl` has 48 cases drawn from 458 real storyboard beats in
`apps/nickstire/docs/reel-packs/*/brief.json`. The sample is stratified so every
category has at least 3 cases: tires, brakes, rotors, suspension, oil,
batteries, alignment/wheels, mechanical macro, object character, shop
environment, abstract/educational, rapid action, slow cinematic, and
fluids/engine. Seeds are fixed, every case carries a sha256, and beats containing
phone numbers or emails are filtered out. Beats a brief declares real footage or
deterministic graphics (the `source` field, or a leading `REAL` / `DETERMINISTIC`
tag in `visual`, as in nickstire's `shared/shotRouter.ts`) are skipped too: they
are captured or rendered, never generated, so they are not generator workload.
Rebuild it with `python3 bench/build_corpus.py`; the output is deterministic.
