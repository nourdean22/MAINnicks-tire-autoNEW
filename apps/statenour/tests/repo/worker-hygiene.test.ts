/**
 * Q-36 · statenour-worker hygiene canaries.
 *
 * Repo-level because the worker intentionally has no Vitest suite of its own.
 * These assertions turn three source-inspection claims into executable proof:
 *   1. legacy mega HTTP routes stay deleted,
 *   2. high-risk DB/GitHub secrets remain unread by worker source,
 *   3. the existing reel-engine wall-clock render bound stays present.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const at = (rel: string) => resolve(REPO_ROOT, rel);

function workerSource(): string {
  return readdirSync(at("apps/worker/src"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(at(`apps/worker/src/${name}`), "utf8"))
    .join("\n");
}

describe("Q-36 worker hygiene", () => {
  it("has no legacy /cron/mega or /cron/mega-evening endpoint", () => {
    const src = readFileSync(at("apps/worker/src/index.ts"), "utf8");
    expect(src).not.toMatch(/app\.post\(["']\/cron\/mega(?:-evening)?["']/);
    expect(src).not.toContain('forwardCronToWeb("mega?slot=');
  });

  it.each(["DATABASE_URL", "DIRECT_URL", "GITHUB_TOKEN"])(
    "does not read process.env.%s anywhere in worker source",
    (name) => {
      expect(workerSource()).not.toContain(`process.env.${name}`);
      expect(workerSource()).not.toContain(`process.env["${name}"]`);
      expect(workerSource()).not.toContain(`process.env['${name}']`);
    },
  );

  it("keeps the render engine behind a finite wall-clock timeout", () => {
    const render = readFileSync(at("packages/reel-engine/src/render.ts"), "utf8");
    const worker = readFileSync(at("apps/worker/src/scheduler.ts"), "utf8");
    expect(worker).toContain("await renderReelVideo({");
    expect(render).toContain("DEFAULT_RENDER_TIMEOUT_MS = 10 * 60 * 1000");
    expect(render).toContain("withWallClockTimeout(doRenderReelVideo(options), timeoutMs");
    expect(render).toContain("REEL_RENDER_TIMEOUT_MS");
  });
});
