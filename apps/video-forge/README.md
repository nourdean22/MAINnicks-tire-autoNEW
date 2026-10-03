# NOUR Video Forge

Private, provider-neutral GPU generation service. nickstire's Reel Factory reaches
it as the `self_hosted` reel video provider; the open-weight model is a **profile**
underneath (`ltx-2.5-dfr`, `ltx-2.5-distilled`, `wan2.2-ti2v-5b`). Reel jobs,
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

## GPU canary (operator action, needs spend approval)

1. Rent one 80 GB GPU (A100/H100) on RunPod **or** deploy `modal_app.py`. Use 80 GB first so FP8 and offload don't muddy the quality result.
2. Run `scripts/fetch_models.sh` with pinned `LTX25_REV` and `WAN22_REV`. Copy the sha256s into `forge/profiles.json` and `apps/nickstire/shared/mediaModelRegistry.ts`.
3. Start the worker without `FORGE_ALLOW_UNAPPROVED_FOR_TESTS` or `FORGE_BACKEND_OVERRIDE`. Fix `FORGE_LTX_CMD` / `FORGE_WAN_CMD` if the upstream CLIs differ from the templates.
4. Run `scripts/video-forge-e2e.ts` against it. That gives the first real receipt.
5. Run the bake-off: `bench/run_bench.py` on the 48-case corpus × profiles × arms (`text`, `hero`). Then send the clips through nickstire's rendered QA, run `bench/make_pairwise.py`, and do the blind human review.
6. Only after that: move the profile's `rollout` to `operator_selectable` (in both files), then pin `REEL_VIDEO_PROVIDER=self_hosted` on a limited cadence.

## Benchmark corpus

`bench/corpus.v1.jsonl` has 48 cases drawn from 458 real storyboard beats in
`apps/nickstire/docs/reel-packs/*/brief.json`. The sample is stratified so every
category has at least 3 cases: tires, brakes, rotors, suspension, oil,
batteries, alignment/wheels, mechanical macro, object character, shop
environment, abstract/educational, rapid action, slow cinematic, and
fluids/engine. Seeds are fixed, every case carries a sha256, and beats containing
phone numbers or emails are filtered out. Rebuild it with
`python3 bench/build_corpus.py`; the output is deterministic.
