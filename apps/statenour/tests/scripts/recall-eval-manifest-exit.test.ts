/**
 * 06-X2 · `pnpm eval:recall` printed "corpus CHANGED vs manifest" and still exited 0, so a run on a
 * different corpus read as a comparable baseline. A changed corpus must now exit 4 unless the operator
 * re-freezes it with --write-manifest. main() runs for real with every DB/LLM lane faked (loadDecls),
 * so the exit code under test is the one the CLI returns, including its final process.exit.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDecls } from "./fixtures/script-decls";

const CASES = [{ query: "q1", relevantKeys: ["k1"], provenance: "seed" }];
const CWD = "/fake-app";
const MANIFEST = join(CWD, "data", "recall-corpus.manifest.json");
const MAIN_DECLS = [
  "K", "hybridKnn", "memoryRecallKnn", "arbiterKnn", "memoryRecallInvalid", "arbiterInvalid", "evalMode",
  "knnBanner", "laneInvalidBanner", "corpusFingerprint", "checkManifest", "main",
];
const LIMITS = { standard: { contextual: 5, memoryRecall: 5, pack: 10 }, deep: { contextual: 10, memoryRecall: 8, pack: 14 } };
const MODULES: Record<string, unknown> = {
  "../lib/brain/recall-corpus-tiers": { splitByTier: () => ({ development: [], regression: [], sealed: [] }), sealedCorpusPath: () => "", describeSealed: () => "" },
  "../lib/brain/evidence-pack": { RECALL_MODE_LIMITS: LIMITS },
};
const report = { k: 5, meanPrecisionAtK: 0, fullRecallRate: 0, contradictionInjectionRate: 0, abstentionCleanRate: 0, casesRun: 1 };

async function runMain(args: string[], manifest: object | null): Promise<{ code: unknown; files: Map<string, string>; arbiterLimits: unknown[] }> {
  const files = new Map<string, string>();
  if (manifest) files.set(MANIFEST, JSON.stringify(manifest));
  const proc = {
    argv: ["node", "recall-eval.ts", ...args],
    env: { DATABASE_URL: "postgresql://inert:inert@127.0.0.1:1/inert" },
    cwd: () => CWD,
    exitCode: undefined as number | undefined,
    exit(code?: number): never {
      throw { exited: code ?? proc.exitCode ?? 0 };
    },
  };
  const lane = async () => async () => [];
  const arbiterLimits: unknown[] = [];
  // Every top-level name main() reads is either loaded for real (counters, banners) or stubbed (the
  // DB/LLM lanes). A name main() reads that is neither throws a ReferenceError, which runMain rethrows.
  const { main } = loadDecls("scripts/recall-eval.ts", MAIN_DECLS, {
    process: proc,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    createHash,
    join,
    existsSync: (p: string) => files.has(p),
    readFileSync: (p: string) => files.get(p),
    writeFileSync: (p: string, c: string) => void files.set(p, c),
    mkdirSync: () => {},
    loadCorpus: () => ({ cases: CASES, syntheticOnly: true }),
    runRecallEval: async () => report,
    vectorRetriever: lane,
    lexicalRetriever: lane,
    hybridRetriever: lane,
    memoryRecallRetriever: lane,
    arbiterRetriever: async (limits: unknown) => {
      arbiterLimits.push(limits);
      return async () => [];
    },
    line: () => "",
    require: (p: string) => {
      if (!(p in MODULES)) throw new Error(`unstubbed require: ${p}`);
      return MODULES[p];
    },
  });
  const out = await main().then(
    () => ({ exited: "returned without exiting" }),
    (e: { exited?: unknown }) => {
      // Only the fake process.exit is an outcome; anything else (a ReferenceError for a name the
      // sandbox lacks) is a harness failure and must surface as itself, not as "exit undefined".
      if (e && typeof e === "object" && "exited" in e) return e;
      throw e;
    },
  );
  return { code: out.exited, files, arbiterLimits };
}

const fingerprint = () => {
  const h = createHash("sha256");
  for (const c of CASES) h.update(JSON.stringify(c));
  return { count: CASES.length, sha256: h.digest("hex") };
};

describe("recall-eval · a changed corpus cannot pass as the frozen baseline", () => {
  it("CONTROL: corpus matches the manifest -> exit 0", async () => {
    expect((await runMain([], { frozenAt: "2026-09-18", ...fingerprint() })).code).toBe(0);
  });

  it("corpus CHANGED vs manifest, no --write-manifest -> exit 4", async () => {
    expect((await runMain([], { frozenAt: "2026-09-18", count: 9, sha256: "stale" })).code).toBe(4);
  });

  it("--write-manifest re-freezes on purpose -> manifest rewritten, exit 0", async () => {
    const { code, files } = await runMain(["--write-manifest"], { frozenAt: "2026-09-18", count: 9, sha256: "stale" });
    expect(code).toBe(0);
    expect(JSON.parse(files.get(MANIFEST)!).sha256).toBe(fingerprint().sha256);
  });

  it("no manifest yet -> exit 0 (nothing to compare against)", async () => {
    expect((await runMain([], null)).code).toBe(0);
  });
});

describe("recall-eval · the arbiter lane mirrors one production mode, recorded in the artifact (PR #3088 CX-2)", () => {
  const artifact = (files: Map<string, string>) =>
    JSON.parse(files.get(join(CWD, "eval-datasets", "recall-lane-comparison.json"))!) as { arbiterConfig: Record<string, unknown> };

  it("default: standard mode's sizes reach the lane and the artifact", async () => {
    const { code, files, arbiterLimits } = await runMain([], null);
    expect(code).toBe(0);
    expect(arbiterLimits).toEqual([LIMITS.standard]);
    expect(artifact(files).arbiterConfig).toMatchObject({ mode: "standard", contextual: 5, memoryRecall: 5, pack: 10, window: 20 });
  });

  it("--mode deep: deep mode's sizes reach the lane and the artifact", async () => {
    const { files, arbiterLimits } = await runMain(["--mode", "deep"], null);
    expect(arbiterLimits).toEqual([LIMITS.deep]);
    expect(artifact(files).arbiterConfig).toMatchObject({ mode: "deep", contextual: 10, memoryRecall: 8, pack: 14, window: 24 });
  });

  it("an unknown --mode refuses to run instead of silently measuring standard", async () => {
    await expect(runMain(["--mode", "fast"], null)).rejects.toThrow(/standard or deep/);
  });
});
