/**
 * Q-35 · deploy skew (Sentry JAVASCRIPT-REACT-Z). A tab opened on the previous
 * build calls Server Actions / chunks the new image does not have. The root
 * boundary reloads ONCE for that shape and reports everything else, including
 * a second skew error inside the window (a reload loop is a real bug).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  SKEW_RELOAD_KEY,
  SKEW_RELOAD_WINDOW_MS,
  isDeploySkewError,
  reloadOnceForDeploySkew,
} from "@/lib/observability/deploy-skew";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
}

// The exact messages Next 16.3.4 produces (server E975, client E715) and the
// chunk-load shapes browsers throw when an old chunk URL 404s.
const SKEW = [
  new Error("Failed to find Server Action. This request might be from an older or newer deployment.\nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action"),
  new Error('Server Action "7f3a" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action'),
  Object.assign(new Error("Loading chunk 123 failed."), { name: "ChunkLoadError" }),
  new TypeError("Failed to fetch dynamically imported module: https://bdnick.info/_next/static/chunks/x.js"),
];

describe("isDeploySkewError", () => {
  it.each(SKEW.map((e) => [e.message.slice(0, 40), e]))("recognises skew: %s", (_label, err) => {
    expect(isDeploySkewError(err)).toBe(true);
  });

  it("does not claim ordinary failures (negative control)", () => {
    expect(isDeploySkewError(new Error("root render exploded"))).toBe(false);
    expect(isDeploySkewError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isDeploySkewError("Failed to find Server Action")).toBe(false);
    expect(isDeploySkewError(undefined)).toBe(false);
  });
});

describe("reloadOnceForDeploySkew", () => {
  const now = 1_800_000_000_000;

  it("reloads once for skew and stamps the marker", () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    expect(reloadOnceForDeploySkew(SKEW[0], storage, reload, now)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.map.get(SKEW_RELOAD_KEY)).toBe(String(now));
  });

  it("does not reload again inside the window, so the boundary reports the repeat", () => {
    const storage = memoryStorage({ [SKEW_RELOAD_KEY]: String(now - 5_000) });
    const reload = vi.fn();
    expect(reloadOnceForDeploySkew(SKEW[0], storage, reload, now)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads again once the window has passed", () => {
    const storage = memoryStorage({ [SKEW_RELOAD_KEY]: String(now - SKEW_RELOAD_WINDOW_MS - 1) });
    const reload = vi.fn();
    expect(reloadOnceForDeploySkew(SKEW[2], storage, reload, now)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads for a non-skew error", () => {
    const reload = vi.fn();
    expect(reloadOnceForDeploySkew(new Error("root render exploded"), memoryStorage(), reload, now)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reports instead of risking a loop when storage is unavailable or throws", () => {
    const reload = vi.fn();
    expect(reloadOnceForDeploySkew(SKEW[0], undefined, reload, now)).toBe(false);
    const throwing = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => {} };
    expect(reloadOnceForDeploySkew(SKEW[0], throwing, reload, now)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("wiring", () => {
  it("the root boundary tries the skew reload before reporting", () => {
    const src = readFileSync(join(APP_ROOT, "app", "global-error.tsx"), "utf8");
    const reloadAt = src.indexOf("reloadOnceForDeploySkew(error");
    const reportAt = src.indexOf("reportGlobalError(error)");
    expect(reloadAt).toBeGreaterThan(-1);
    expect(reportAt).toBeGreaterThan(reloadAt);
  });

  it("the Docker build stage receives the commit SHA and the stable action key", () => {
    const docker = readFileSync(join(APP_ROOT, "Dockerfile"), "utf8");
    const build = docker.slice(docker.indexOf("AS build"), docker.indexOf("AS runtime"));
    expect(build).toMatch(/^ARG RAILWAY_GIT_COMMIT_SHA$/m);
    expect(build).toMatch(/^ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY$/m);
  });
});
