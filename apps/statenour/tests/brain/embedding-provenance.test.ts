/**
 * A stored vector must record which embedding space it belongs to.
 *
 * ★★★ THE DEFECT, MEASURED 2026-09-18 over 97,401 production rows. The
 * embedding SPACE was knowable on 4.3% of them — and not because a backfill was
 * skipped. `getEmbedding()` returned a bare `number[]`, so no writer could
 * record what produced a vector even when it wanted to. The `model` column got
 * filled by whoever happened to have a guess in scope, which is how it ended up
 * holding three incompatible things at once:
 *
 *     cohere-embed-v4.0 / embed-v4.0 / venice-bge-m3  4201  real identity
 *     "default"                                       1431  names nothing
 *     16-hex-char content fingerprints                 189  a cache key
 *     NULL                                           91580
 *
 * ⚠ WHY THIS IS A CORRECTNESS BUG, NOT UNTIDY METADATA. Two vectors from
 * different models are not comparable, and cosine similarity between them
 * returns a plausible number rather than an error. An unrecorded space cannot
 * be detected downstream — it just quietly ranks wrong.
 *
 * Same shape as `cron_job_log.status` carrying both "invoked" and "finished,
 * some children failed": one column, several meanings, every reader silently
 * wrong. Topping up the NULLs would have made it worse — a column 95%
 * trustworthy is one a reader finally believes.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "../..");

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/prisma");
  vi.doUnmock("@/lib/ai/provider");
});

/** In-memory vector_embeddings, so we assert on the ROW, not on a call shape. */
function makeStore() {
  const rows: Record<string, unknown>[] = [];
  const prisma = {
    vectorEmbedding: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `v${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        rows.push({ id: "upd", ...data });
        return {};
      },
    },
    brainMemory: { update: async () => ({}), updateMany: async () => ({ count: 0 }) },
    $queryRaw: async () => [],
    $queryRawUnsafe: async () => [],
    $executeRawUnsafe: async () => 0,
    $executeRaw: async () => 0,
  };
  return { prisma, rows };
}

async function loadWriter(prisma: unknown, embedding: { vec: number[]; model: string | null }) {
  vi.resetModules();
  vi.doMock("@/lib/prisma", () => ({ prisma }));
  vi.doMock("@/lib/ai/provider", () => ({
    getEmbedding: async () => embedding.vec,
    getEmbeddingWithModel: async () => embedding,
  }));
  return import("../../lib/brain/embedding-utils");
}

describe("storeGenericEmbedding records the embedding space", () => {
  it("writes the provider-reported model and the real dimension", async () => {
    const { prisma, rows } = makeStore();
    const vec = Array.from({ length: 1024 }, (_, i) => i / 1024);
    const { storeGenericEmbedding } = await loadWriter(prisma, {
      vec,
      model: "cohere:embed-v4.0",
    });

    await storeGenericEmbedding("brain_memory", "mem-1", "hello world");

    expect(rows).toHaveLength(1);
    expect(rows[0].model, "the space must be recorded, not left null").toBe("cohere:embed-v4.0");
    expect(rows[0].embedding_dim, "dim must come from the vector, not a constant").toBe(1024);
  });

  it("NEVER substitutes a placeholder when the provider reports nothing", async () => {
    // The provider only returns model:null when every provider failed, which
    // also means vec is empty and nothing is persisted. The guarantee under
    // test is that no code path invents a stand-in like "default".
    const { prisma, rows } = makeStore();
    const { storeGenericEmbedding } = await loadWriter(prisma, { vec: [], model: null });
    await storeGenericEmbedding("brain_memory", "mem-2", "hello");
    expect(rows, "no vector, no row — and certainly no fabricated identity").toHaveLength(0);
  });

  it("records the dimension actually returned, not the contract width", async () => {
    // A provider that returns an off-contract width must be recorded as what it
    // IS. Writing 1024 because that is the contract would make the column agree
    // with the spec and disagree with the data — 7,037 production rows claim
    // dim=1024 while their 1536 column is populated, which is that bug.
    const { prisma, rows } = makeStore();
    const { storeGenericEmbedding } = await loadWriter(prisma, {
      vec: Array.from({ length: 1536 }, () => 0.1),
      model: "openai:text-embedding-3-small",
    });
    await storeGenericEmbedding("chat_message", "msg-1", "hi");
    expect(rows[0].embedding_dim).toBe(1536);
  });
});

describe("the identity column is not overloaded again", () => {
  it("no writer puts the literal \"default\" in model", () => {
    // 1,431 rows carry it. A placeholder in an identity column is worse than
    // NULL: it looks like an answer, so a reader stops asking.
    const files = [
      "scripts/embed-skills.ts",
      "lib/brain/embedding-utils.ts",
      "lib/ai/tool-embeddings.ts",
    ];
    for (const f of files) {
      const src = readFileSync(join(APP, f), "utf8");
      const stripped = src
        .split("\n")
        .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
        .join("\n")
        .replace(/\/\*[\s\S]*?\*\//g, " ");
      expect(
        /model\s*:\s*["']default["']/.test(stripped),
        `${f} writes model: "default" — a value that names nothing`,
      ).toBe(false);
    }
  });

  it("tool-embeddings compares the fingerprint column, not model", () => {
    const src = readFileSync(join(APP, "lib/ai/tool-embeddings.ts"), "utf8");
    // The staleness check must read contentFingerprint. While it read `model`,
    // every tool_catalog row poisoned the identity column with a hash.
    expect(src).toMatch(/row\.contentFingerprint\s*!==\s*expected/);
    expect(
      /contentFingerprint:\s*fingerprint/.test(src),
      "the fingerprint must be written to its own column",
    ).toBe(true);
    expect(
      /model:\s*fingerprint/.test(src),
      "a fingerprint must never be written into model again",
    ).toBe(false);
  });

  it("getEmbedding still returns a bare vector for read-side callers", async () => {
    // ~14 callers only compare in-process and must not be forced to change.
    const provider = readFileSync(join(APP, "lib/ai/provider.ts"), "utf8");
    expect(provider).toMatch(/export async function getEmbedding\(text: string\): Promise<number\[\]>/);
    expect(provider).toMatch(/export async function getEmbeddingWithModel\(/);
  });
});
