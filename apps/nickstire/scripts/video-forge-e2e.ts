/**
 * Video Forge wire-contract proof — nickstire client ↔ a REAL running Forge.
 *
 * Exercises the production client code (videoForgeClient.renderSelfHostedBeat)
 * over real HTTP + HMAC against apps/video-forge, including reference-image
 * conditioning, a forced local timeout + resume (must NOT create a second job),
 * output pull + sha256/mp4/dimension verification, and storagePut re-hosting.
 *
 * Against the CPU mock backend this proves the CONTRACT, not model quality:
 *
 *   # terminal 1 (apps/video-forge)
 *   FORGE_SECRET=e2e-secret FORGE_DATA_DIR=/tmp/forge-e2e FORGE_ALLOW_UNAPPROVED_FOR_TESTS=1 \
 *     FORGE_BACKEND_OVERRIDE=mock python3 -m uvicorn forge.app:app --port 8787
 *   # terminal 2 (apps/nickstire)
 *   VIDEO_FORGE_URL=http://127.0.0.1:8787 VIDEO_FORGE_SECRET=e2e-secret \
 *     HERO_URL=http://127.0.0.1:8788/hero.png npx tsx scripts/video-forge-e2e.ts
 *
 * Against a GPU canary, drop FORGE_BACKEND_OVERRIDE and FORGE_ALLOW_UNAPPROVED_FOR_TESTS
 * on the worker; the same script then produces a real LTX/Wan receipt.
 */
import { getForgeHealth, renderSelfHostedBeat, type SelfHostedBeatState } from "../server/services/videoForgeClient";

async function main() {
  process.env.VIDEO_FORGE_ALLOW_PREPRODUCTION = "true";
  process.env.VIDEO_FORGE_PROFILE ||= "ltx-2.5-distilled";
  process.env.REEL_ALLOW_EPHEMERAL_STORAGE = "true";
  const health = await getForgeHealth();
  console.log("health", JSON.stringify({ status: health.status, gpu: health.detail?.gpu_type, queue: health.detail?.queue_depth }));

  const beat: SelfHostedBeatState = { beatNumber: 1 };
  const persisted: string[] = [];
  const input = {
    beat,
    idempotencyBase: `nickstire-e2e-${Date.now()}-b1`,
    prompt: [
      "SUBJECT: a worn all-season tire on a shop lift",
      "SCENE: Nick's Tire & Auto service bay, Cleveland, morning light",
      "ACTION AND CAMERA MOTION: slow dolly in to the tread blocks",
      "CINEMATOGRAPHY: macro 100mm, shallow depth of field",
      "STYLE: warm practical light, photoreal",
    ].join("\n"),
    startImageUrl: process.env.HERO_URL,
    persist: async () => { persisted.push(JSON.stringify({ key: beat.selfHostedIdempotencyKey, job: beat.selfHostedJobId })); },
    heartbeat: async () => undefined,
  };

  // 1. Force a local timeout right after submit: window 1 ms, interval 60 s.
  process.env.VIDEO_FORGE_POLL_WINDOW_MS = "1";
  process.env.VIDEO_FORGE_POLL_INTERVAL_MS = "60000";
  const t0 = Date.now();
  const first = await renderSelfHostedBeat(input).catch((e) => e);
  console.log("first call", JSON.stringify({ isLocalTimeout: first?.isLocalTimeout === true, jobId: beat.selfHostedJobId, key: beat.selfHostedIdempotencyKey }));
  const jobIdAfterTimeout = beat.selfHostedJobId;

  // 2. Resume (a "next pulse"): same beat state, generous window.
  process.env.VIDEO_FORGE_POLL_WINDOW_MS = "120000";
  process.env.VIDEO_FORGE_POLL_INTERVAL_MS = "500";
  const r = await renderSelfHostedBeat(input);
  const wallMs = Date.now() - t0;
  const op = beat.providerOps?.[0];
  console.log("resumed", JSON.stringify({ sameJob: op?.opId === jobIdAfterTimeout, url: r.url, wallMs }));
  console.log("receipt", JSON.stringify(r.receipt));
  console.log("persist writes", persisted.length, "| active handles cleared:", !beat.selfHostedJobId && !beat.selfHostedIdempotencyKey);
  if (op?.opId !== jobIdAfterTimeout) throw new Error("RESUME CREATED A DIFFERENT JOB — duplicate render");
}

main().catch((e) => {
  console.error("E2E FAILED", e);
  process.exit(1);
});
