/**
 * tests/repo/dockerfile-copy-sources.test.ts · 2026-09-07
 *
 * Every build-context `COPY <src> <dst>` in the deploy Dockerfiles must name
 * a path that exists in git. #2096 deleted the only file in
 * apps/statenour/patches/, git dropped the now-empty directory, and Railway's
 * build died on `COPY apps/statenour/patches` with
 * `"/apps/statenour/patches": not found` — for BOTH statenour-web and
 * statenour-worker, on every push from 2026-09-04 12:34Z until this gate
 * landed. Production sat on b3bebde while three statenour merges (43 files)
 * never deployed, and the session ledger said "shipped". Nothing in the repo
 * could fail before the image build did; now this file can.
 *
 * The inverse is gated too: every pnpm patch declared in a package.json must
 * be COPYd into the deps stage of every Dockerfile that runs the frozen
 * install, or `pnpm install --frozen-lockfile` fails inside the image with
 * exactly the same silence.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DOCKERFILES = ["apps/statenour/Dockerfile", "apps/worker/Dockerfile"];
const PACKAGE_MANIFESTS = ["package.json", "apps/statenour/package.json", "apps/worker/package.json", "apps/nickstire/package.json"];

const at = (rel: string) => resolve(REPO_ROOT, rel);

/** Build-context COPY sources — `COPY --from=<stage>` copies image layers, not repo paths. */
export function contextCopySources(dockerfile: string): string[] {
  const out: string[] = [];
  for (const raw of dockerfile.split("\n")) {
    const line = raw.trim();
    if (!/^COPY\s/i.test(line) || /--from=/.test(line)) continue;
    const tokens = line
      .replace(/^COPY\s+/i, "")
      .split(/\s+/)
      .filter((t) => t.length > 0 && !t.startsWith("--"));
    out.push(...tokens.slice(0, -1)); // the last token is the destination
  }
  return out;
}

/** Number of git-tracked files at or under `path` (0 = git has no such path). */
function trackedUnder(path: string): number {
  const stdout = execFileSync("git", ["ls-files", "--", path], { cwd: REPO_ROOT, encoding: "utf8" });
  return stdout.split("\n").filter(Boolean).length;
}

function declaredPatchFiles(): string[] {
  const files: string[] = [];
  for (const manifest of PACKAGE_MANIFESTS) {
    let json: { pnpm?: { patchedDependencies?: Record<string, string> } };
    try {
      json = JSON.parse(readFileSync(at(manifest), "utf8"));
    } catch {
      continue; // a missing app manifest is not this gate's business
    }
    const patches = json.pnpm?.patchedDependencies ?? {};
    for (const rel of Object.values(patches)) {
      // pnpm resolves patch paths relative to the manifest that declares them.
      const base = dirname(manifest);
      files.push(base === "." ? rel : `${base}/${rel}`.replace(/\\/g, "/"));
    }
  }
  return files;
}

describe("Dockerfile COPY sources exist in git (deploy-time failure moved to test-time)", () => {
  for (const dockerfile of DOCKERFILES) {
    it(`${dockerfile}: every build-context COPY source is a tracked path`, () => {
      const sources = contextCopySources(readFileSync(at(dockerfile), "utf8"));
      expect(sources.length, "a Dockerfile with no context COPY lines is not the one this gate knows").toBeGreaterThan(0);
      const missing = sources.filter((src) => trackedUnder(src) === 0);
      expect(
        missing,
        `${dockerfile} COPYs paths git does not have — the image build fails with "not found" before any test runs`,
      ).toEqual([]);
    });
  }

  it("every declared pnpm patch file is tracked AND copied into every deps stage", () => {
    const patches = declaredPatchFiles();
    // Positive control: the repo does declare at least one patch today
    // (wouter for nickstire). If that ever drops to zero this assertion
    // must be revisited, not deleted — an empty inverse check proves nothing.
    expect(patches.length).toBeGreaterThan(0);

    const untracked = patches.filter((p) => trackedUnder(p) === 0);
    expect(untracked, "package.json declares a patch file git does not have").toEqual([]);

    for (const dockerfile of DOCKERFILES) {
      const sources = contextCopySources(readFileSync(at(dockerfile), "utf8")).filter((s) => s !== ".");
      const uncovered = patches.filter((p) => !sources.some((s) => p === s || p.startsWith(`${s.replace(/\/$/, "")}/`)));
      expect(
        uncovered,
        `${dockerfile} runs a frozen install but never COPYs these patch files into the deps stage`,
      ).toEqual([]);
    }
  });

  it("canary: the exact 2026-09-04 shape is caught (a deleted directory still named by COPY)", () => {
    const fixture = [
      "FROM node:24-alpine3.23 AS deps",
      "COPY --from=pruner /app/out/json/ ./",
      "COPY apps/statenour/patches ./apps/statenour/patches",
      "COPY apps/nickstire/patches ./apps/nickstire/patches",
      "COPY . .",
    ].join("\n");
    const sources = contextCopySources(fixture);
    expect(sources).toEqual(["apps/statenour/patches", "apps/nickstire/patches", "."]);
    // The directory that broke production is still absent from git — so the
    // gate's verdict on it must be "missing", or the gate is blind to the
    // very incident it exists for.
    expect(trackedUnder("apps/statenour/patches")).toBe(0);
    // ...while a real directory and the context root both count as present.
    expect(trackedUnder("apps/nickstire/patches")).toBeGreaterThan(0);
    expect(trackedUnder(".")).toBeGreaterThan(0);
  });
});
