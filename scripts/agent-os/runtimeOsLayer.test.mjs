/**
 * Canaries for the container-scan OS-layer extractor.
 *
 * The extractor decides WHAT GETS SCANNED. If it silently returns a bare
 * `FROM node:24-alpine3.23` with the package installs dropped, Trivy scans a
 * near-empty base image, reports almost nothing, and the weekly container scan
 * goes green forever while `imagemagick`, `chromium` and 14 pinned pip
 * packages sit unexamined in production. That is the silent-instrument shape
 * with a security label on it, so the extractor is canaried harder than the
 * workflow that calls it.
 *
 * The line-continuation case is the one that actually bites: every package
 * list in both Dockerfiles is written as `RUN apk add --no-cache \` followed
 * by indented lines, so a naive per-line reader keeps the `RUN` and discards
 * every package name — and still produces a plausible-looking Dockerfile.
 *
 * Run:  node --test scripts/agent-os/runtimeOsLayer.test.mjs   (or: pnpm agent:verify)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseInstructions, runtimeOsLayer } from "../extract-runtime-oslayer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const dockerfile = (rel) => readFileSync(join(REPO, rel), "utf8");

const SERVICES = [
  { name: "statenour-web", path: "apps/statenour/Dockerfile" },
  { name: "statenour-worker", path: "apps/worker/Dockerfile" },
];

// ── Against the REAL Dockerfiles ───────────────────────────────────────────

test("both real runtime stages yield a layer that installs something", () => {
  for (const svc of SERVICES) {
    const layer = runtimeOsLayer(dockerfile(svc.path));
    assert.match(layer, /^FROM\s+\S+/m, `${svc.name}: no FROM emitted`);
    assert.match(layer, /^\s*RUN\b/m, `${svc.name}: no RUN emitted`);
    // The stage name must be stripped, or `docker build` targets a stage that
    // does not exist in the single-stage file we emit.
    assert.doesNotMatch(layer.split("\n")[0], /\sAS\s/i, `${svc.name}: FROM kept its AS alias`);
    // Nothing that needs an earlier stage may survive into a standalone build.
    assert.doesNotMatch(layer, /--from=/, `${svc.name}: emitted a COPY --from`);
  }
});

test("POSITIVE CONTROL: the packages we actually care about survive extraction", () => {
  // Named explicitly. A generic "contains RUN" assertion passes on a layer
  // that dropped every package name to a lost continuation.
  const web = runtimeOsLayer(dockerfile("apps/statenour/Dockerfile"));
  for (const pkg of ["imagemagick", "ffmpeg", "python3"]) {
    assert.ok(web.includes(pkg), `statenour OS layer lost "${pkg}"`);
  }
  // pip packages live on continuation lines — the exact thing a naive reader drops.
  for (const pkg of ["yt-dlp", "litellm", "requests"]) {
    assert.ok(web.includes(pkg), `statenour OS layer lost pip package "${pkg}"`);
  }

  const worker = runtimeOsLayer(dockerfile("apps/worker/Dockerfile"));
  for (const pkg of ["chromium", "nss", "freetype", "harfbuzz"]) {
    assert.ok(worker.includes(pkg), `worker OS layer lost "${pkg}"`);
  }
});

// ── The continuation reader ────────────────────────────────────────────────

test("a `\\`-continued RUN is ONE instruction, not one per line", () => {
  const ins = parseInstructions("FROM alpine\nRUN apk add \\\n  chromium \\\n  nss\nUSER x\n");
  assert.deepEqual(ins.map((i) => i.keyword), ["FROM", "RUN", "USER"]);
  assert.ok(ins[1].text.includes("chromium") && ins[1].text.includes("nss"));
});

test("comments and blank lines are skipped, and a trailing instruction is not lost", () => {
  const ins = parseInstructions("# c\n\nFROM alpine\nRUN echo hi");
  assert.deepEqual(ins.map((i) => i.keyword), ["FROM", "RUN"]);
});

// ── Shapes that must throw rather than emit something plausible ────────────

test("FIRES: a final stage that installs nothing is refused, not emitted", () => {
  // The dangerous case: this WOULD build and WOULD scan clean.
  assert.throws(
    () => runtimeOsLayer("FROM node:24-alpine3.23 AS build\nRUN apk add curl\n\nFROM node:24-alpine3.23 AS runtime\nCOPY --from=build /app /app\n"),
    /installs nothing/,
  );
});

test("FIRES: a Dockerfile with no FROM is refused", () => {
  assert.throws(() => runtimeOsLayer("RUN apk add curl\n"), /no FROM/);
});

test("extraction stops at the first COPY --from, keeping earlier RUNs", () => {
  const layer = runtimeOsLayer(
    "FROM alpine AS build\nRUN echo build\n\nFROM alpine AS runtime\nRUN apk add chromium\nCOPY --from=build /a /a\nRUN echo after\n",
  );
  assert.ok(layer.includes("chromium"));
  assert.ok(!layer.includes("echo after"), "kept a RUN from beyond the COPY --from boundary");
  assert.ok(!layer.includes("echo build"), "leaked an earlier stage's RUN");
});
