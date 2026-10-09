/**
 * The deploy Dockerfiles prune with the lockfile's turbo (2026-10-09).
 *
 * The pruner stage installs turbo globally at a pinned version and runs `turbo prune` before any
 * `pnpm install`, so the lockfile's turbo is never what parses turbo.json in the image. The pin
 * stayed at 2.9.14 while the lockfile moved to 2.11.6 (#2915); nothing failed until #2936 added
 * `"agentGuidance": false`, a key 2.9.14 cannot parse. From then on every statenour-web and
 * statenour-worker build failed at `turbo prune`, and production stayed on #2935 for hours.
 * Local runs and CI never ran this turbo, so only the deploy saw it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DOCKERFILES = ["apps/statenour/Dockerfile", "apps/worker/Dockerfile"];

/** Every `turbo@X` a Dockerfile installs. */
function dockerTurboPins(dockerfile: string): string[] {
  return [...dockerfile.matchAll(/npm install -g turbo@([0-9][^\s]*)/g)].map((m) => m[1]!);
}

/** Every turbo version the lockfile resolves (its `packages:` and `snapshots:` keys). */
function lockfileTurboVersions(lockfile: string): string[] {
  return [...new Set([...lockfile.matchAll(/^ {2}turbo@([0-9][^:\s]*):$/gm)].map((m) => m[1]!))];
}

/** The problems with one Dockerfile against the lockfile; [] = it prunes with the lockfile's turbo. */
function pinProblems(dockerfile: string, lockVersions: string[]): string[] {
  if (lockVersions.length !== 1) return [`the lockfile resolves ${lockVersions.length} turbo versions (${lockVersions.join(", ")}), not one`];
  const pins = dockerTurboPins(dockerfile);
  if (pins.length === 0) return ["installs no pinned turbo"];
  return pins.filter((v) => v !== lockVersions[0]).map((v) => `pins turbo@${v}; the lockfile resolves ${lockVersions[0]}`);
}

describe("deploy Dockerfiles prune with the lockfile's turbo", () => {
  const lock = lockfileTurboVersions(readFileSync(resolve(REPO_ROOT, "pnpm-lock.yaml"), "utf8"));

  it("the instrument reads the lockfile: exactly one turbo version", () => {
    expect(lock).toHaveLength(1);
    expect(lock[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  for (const rel of DOCKERFILES) {
    it(`${rel} installs the lockfile's turbo`, () => {
      expect(pinProblems(readFileSync(resolve(REPO_ROOT, rel), "utf8"), lock)).toEqual([]);
    });
  }

  it("CONTROL: a stale pin, a missing pin, and a lockfile with two turbos are each reported", () => {
    const stale = "FROM node:24 AS pruner\nRUN npm install -g turbo@2.9.14\nRUN turbo prune @statenour/web --docker\n";
    expect(pinProblems(stale, ["2.11.6"])).toEqual(["pins turbo@2.9.14; the lockfile resolves 2.11.6"]);
    expect(pinProblems("FROM node:24\nRUN npm install -g turbo\n", ["2.11.6"])).toEqual(["installs no pinned turbo"]);
    expect(pinProblems(stale.replace("2.9.14", "2.11.6"), ["2.11.6"])).toEqual([]);
    expect(lockfileTurboVersions("packages:\n\n  turbo@2.11.6:\n    x\n\n  turbo@2.9.14:\n    y\n")).toEqual(["2.11.6", "2.9.14"]);
  });
});
