/**
 * tests/repo/obsidian-ingest-server-only.test.ts · 2026-09-15
 *
 * `pnpm obsidian:ingest` exited 1 on every run from 2026-09-09 to 2026-09-15
 * (five consecutive graphify syncs) because its child script reaches
 * lib/ai/budget.ts, whose `import "server-only"` throws under plain tsx.
 * Nothing went red: the vault digests are written by an earlier step of
 * scripts/graphify-obsidian-sync.ps1, so the artifacts stayed current and the
 * run still logged `=== sync done (labels: LLM) ===`. The only trace was one
 * WARN line, and it survived five runs unread.
 *
 * The fix is lib/obsidian/child-env.ts `withServerOnlyShim`, which adds the
 * "react-server" condition server-only's own exports map resolves to an empty
 * module. This file proves the fix WORKS and proves the probe can SEE it fail:
 *
 *   1. control  — unshimmed child must throw the server-only error
 *                 (without this, a probe that silently stopped exercising the
 *                  chain would pass forever; a green here means nothing)
 *   2. behaviour — shimmed child must load the real ingest chain
 *   3. wiring    — both spawnSync branches in the runner must pass `env`
 *
 * The chain imported below is the ingest's real first link:
 *   ingest-obsidian-candidates -> knowledge/candidate-store -> brain/memory-manager
 *     -> brain/embedding-utils -> ai/provider -> ai/budget
 * candidate-store has no top-level execution, so loading it runs no ingest and
 * issues no query — the ingest script itself calls main() unguarded at :211 and
 * writes to the production Neon DB, so it must never be spawned from a test.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_ONLY_CONDITION, withServerOnlyShim } from "@/lib/obsidian/child-env";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RUNNER = resolve(APP_ROOT, "scripts/obsidian-engine-runner.ts");

/**
 * THE PROBE RUNS FROM A FILE, NOT FROM `tsx -e`, and that is load-bearing.
 *
 * 2026-09-16 · measured in the Linux agent container (tsx 4.23.13 / node
 * 22.22.2): a dynamic `import()` of a local `.ts` path inside a `tsx -e`
 * script resolves to a namespace carrying ONLY `default` — every named export
 * disappears. The same import from a `.ts` FILE resolves them all. Proven on
 * `lib/db/soft-delete.ts`, which has no `server-only` anywhere in its chain:
 *
 *   npx tsx -e '...import("./lib/db/soft-delete")...'  ->  keys: default
 *   npx tsx  <file containing the same import>         ->  keys: activeOnly, …
 *
 * That broke this file in the worst possible way. The shimmed arm asserted
 * `typeof m.persistKnowledgeCandidate === "function"`, which was false under
 * `-e` for a reason having nothing to do with the shim, so the arm failed
 * while the fix it guards was working perfectly. A control that fails for an
 * unrelated reason is as useless as one that passes for an unrelated reason:
 * either way it has stopped reporting on its subject. Running from a file
 * removes the loader's `-e` interop from the chain entirely.
 */
function probeSource(): string {
  const target = resolve(APP_ROOT, "lib/knowledge/candidate-store").split("\\").join("/");
  return [
    `import(${JSON.stringify(target)})`,
    `  .then((m) => {`,
    `    if (typeof m.persistKnowledgeCandidate !== "function") throw new Error("chain moved: persistKnowledgeCandidate missing");`,
    `    console.log("CHAIN_LOADED");`,
    `  })`,
    `  .catch((e) => { console.log("CHAIN_THREW:" + e.message); process.exitCode = 1; });`,
    ``,
  ].join("\n");
}

/** Same, against a module with NO `server-only` anywhere in its chain. */
function namedExportProbeSource(): string {
  const target = resolve(APP_ROOT, "lib/db/soft-delete").split("\\").join("/");
  return `import(${JSON.stringify(target)}).then((m) => console.log("KEYS:" + Object.keys(m).join(","))).catch((e) => { console.log("THREW:" + e.message); process.exitCode = 1; });\n`;
}

function runProbeSource(source: string, env: NodeJS.ProcessEnv): string {
  const dir = mkdtempSync(join(tmpdir(), "obsidian-probe-"));
  const file = join(dir, "probe.ts");
  try {
    writeFileSync(file, source, "utf8");
    const isWin = process.platform === "win32";
    const result = isWin
      ? spawnSync(`npx.cmd tsx "${file}"`, { cwd: APP_ROOT, env, shell: true, encoding: "utf8" })
      : spawnSync("npx", ["tsx", file], { cwd: APP_ROOT, env, shell: false, encoding: "utf8" });
    if (result.error) throw result.error;
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runProbe(env: NodeJS.ProcessEnv): string {
  return runProbeSource(probeSource(), env);
}

/** process.env minus NODE_OPTIONS, so an operator's shell cannot mask the control. */
function envWithoutShim(): NodeJS.ProcessEnv {
  const { NODE_OPTIONS: _dropped, ...rest } = process.env;
  return rest;
}

describe("obsidian ingest · server-only under tsx", () => {
  /**
   * INSTRUMENT CONTROL, added 2026-09-16 after the loader silently broke the
   * arm below. It reads named exports from a module with no `server-only` in
   * its chain, so it is unaffected by the shim and by everything this file is
   * about. If it fails, the probe MECHANISM is broken and every other verdict
   * here is void — which is precisely what happened under `tsx -e`, where the
   * behaviour arm went red and pointed at the shim instead of at the loader.
   */
  it("the probe mechanism can read named exports at all", () => {
    const output = runProbeSource(namedExportProbeSource(), envWithoutShim());
    expect(output, `the probe could not load a plain module:\n${output}`).toContain("KEYS:");
    expect(
      output,
      "the probe read a namespace with no named exports — the loader collapsed it, so no verdict below means anything",
    ).toContain("activeOnly");
  }, 120_000);

  it("control: the unshimmed chain still throws (proves this probe can detect the regression)", () => {
    const output = runProbe(envWithoutShim());
    expect(output).toContain("CHAIN_THREW:");
    expect(output).toContain("cannot be imported from a Client Component");
  }, 120_000);

  it("the shimmed chain loads, so obsidian:ingest can reach persistKnowledgeCandidate", () => {
    const output = runProbe(withServerOnlyShim(envWithoutShim()));
    expect(output).toContain("CHAIN_LOADED");
    expect(output).not.toContain("CHAIN_THREW:");
  }, 120_000);

  it("withServerOnlyShim appends to NODE_OPTIONS and is idempotent", () => {
    // NodeJS.ProcessEnv requires NODE_ENV here, so build fixtures through a cast
    // rather than widening the helper's signature for a test's convenience.
    const env = (o: Record<string, string>) => o as NodeJS.ProcessEnv;

    expect(withServerOnlyShim(env({})).NODE_OPTIONS).toBe(SERVER_ONLY_CONDITION);
    expect(
      withServerOnlyShim(env({ NODE_OPTIONS: "--max-old-space-size=4096" })).NODE_OPTIONS,
    ).toBe(`--max-old-space-size=4096 ${SERVER_ONLY_CONDITION}`);

    const once = withServerOnlyShim(env({}));
    expect(withServerOnlyShim(once).NODE_OPTIONS).toBe(SERVER_ONLY_CONDITION);
  });

  /**
   * Wiring tripwire, and honestly a weaker check than the two above: it reads
   * source rather than behaviour, because every runner command that reaches the
   * chain (sync/ingest/export) writes to the production DB and cannot be run
   * here. It still fails if someone drops `env` from either spawnSync branch,
   * which is the exact edit that would silently restore the 5-run outage.
   */
  it("wiring: both spawnSync branches in the runner pass the shimmed env", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(RUNNER, "utf8");
    expect(source).toContain("withServerOnlyShim");
    const spawnCalls = source.split("spawnSync(").slice(1);
    expect(spawnCalls.length).toBe(2);
    for (const call of spawnCalls) {
      const options = call.slice(0, call.indexOf("})"));
      expect(options).toMatch(/\benv:/);
    }
  });
});
