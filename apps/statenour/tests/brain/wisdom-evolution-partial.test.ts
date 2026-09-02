/**
 * A failed evolution finder must be reported as failed — never as a
 * healthy corpus — and the low-trust promise must match the low-trust
 * query.
 *
 * DEFECT #1 (2026-09-02 self-audit). `runWisdomEvolution` was a bare
 * `Promise.all`, so one finder throwing rejected all three. The panel
 * read only `data` and `isLoading`, so the rejection rendered as
 * "No candidates · the wisdom corpus is healthy" — a DB error shown to
 * the operator as a clean bill of health. Two properties are asserted
 * here and both are needed: the surviving finders still return, AND the
 * report names the one that did not. Returning two of three lists
 * silently would move the same lie one layer down.
 *
 * DEFECT #4. The docstrings promised two predicates the query has never
 * contained — a `createdBy` filter ("operator promoted them") and a
 * `seenCount` filter ("multiple last-seen events"). The doc was the
 * outlier: the panel header and the REST route both already described
 * the real behaviour, so the promise moved to the code. The canary
 * below pins the query's predicate SET and cross-checks the module
 * header against the live threshold values, so the next divergence in
 * either direction is red rather than silent.
 *
 * Prisma is mocked, so `Promise.allSettled` invokes the three finders in
 * declaration order and each hits `brainMemory.findMany` synchronously
 * before its first await — call 1 is stale, call 2 is redundant's wisdom
 * pull, call 3 is low-trust. That ordering is what makes the
 * `...Once` sequencing below deterministic.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { findMany: vi.fn() },
    vectorEmbedding: { findMany: vi.fn() },
  },
}));

// The evolution module logs a failed finder before recording it. Keep
// that off the real ErrorLog table in unit tests.
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

vi.mock("@/lib/brain/wisdom-topic-tagger", () => ({
  tagWisdomTopics: () => ["money"],
  topicLabel: (t: string) => t,
}));

import { findLowTrustCandidates, runWisdomEvolution } from "@/lib/brain/wisdom-evolution";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";

const findManyBrain = prisma.brainMemory.findMany as unknown as ReturnType<typeof vi.fn>;
const findManyEmbed = prisma.vectorEmbedding.findMany as unknown as ReturnType<typeof vi.fn>;

const MODULE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../lib/brain/wisdom-evolution.ts",
);

function staleRow(id: string) {
  return {
    id,
    key: `wisdom_stale_${id}`,
    content: "an old principle",
    confidence: 0.4,
    lastSeen: new Date(Date.now() - 90 * 86_400_000),
  };
}

function lowTrustRow(id: string) {
  return {
    id,
    key: `wisdom_lowtrust_${id}`,
    content: "a doubted principle",
    confidence: 0.35,
    lastSeen: new Date(),
  };
}

beforeEach(() => {
  findManyBrain.mockReset();
  findManyEmbed.mockReset();
  (logError as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe("runWisdomEvolution · one finder down must not read as healthy", () => {
  it("keeps the other two finders when the redundancy pass throws", () => {
    // Call 2 is findRedundantPairs' wisdom pull — the realistic failure,
    // since it is O(n^2) over every embedding.
    findManyBrain
      .mockResolvedValueOnce([staleRow("s1")])
      .mockRejectedValueOnce(new Error("connection terminated"))
      .mockResolvedValueOnce([lowTrustRow("l1")]);

    return runWisdomEvolution().then((report) => {
      expect(report.stale).toHaveLength(1);
      expect(report.lowTrust).toHaveLength(1);
      expect(report.redundant).toEqual([]);
      expect(report.totalCandidates).toBe(2);

      expect(report.failures).toHaveLength(1);
      expect(report.failures[0].finder).toBe("redundant");
      expect(report.failures[0].message).toContain("connection terminated");
      expect(logError).toHaveBeenCalled();
    });
  });

  it("reports every finder when all three throw, instead of resolving empty-and-clean", () => {
    findManyBrain.mockRejectedValue(new Error("db down"));

    return runWisdomEvolution().then((report) => {
      expect(report.totalCandidates).toBe(0);
      // The exact shape the panel keys off: zero candidates AND a
      // non-empty failure list means "unknown", not "healthy".
      expect(report.failures.map((f) => f.finder).sort()).toEqual([
        "lowTrust",
        "redundant",
        "stale",
      ]);
    });
  });

  it("reports NO failures on a clean run (the instrument can say 'fine')", () => {
    // The negative control. Without it, a `failures` array hard-coded to
    // one entry would pass both tests above.
    findManyBrain
      .mockResolvedValueOnce([staleRow("s1")])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    return runWisdomEvolution().then((report) => {
      expect(report.failures).toEqual([]);
      expect(report.totalCandidates).toBe(1);
    });
  });
});

describe("findLowTrustCandidates · the query is what the doc promises", () => {
  it("filters on exactly category, deletedAt, confidence and lastSeen", async () => {
    findManyBrain.mockResolvedValueOnce([]);
    await findLowTrustCandidates();
    const where = findManyBrain.mock.calls[0][0].where as Record<string, unknown>;

    // Pinned as a SET, not as individual presence checks: adding
    // `createdBy` or `seenCount` back — the two predicates the docstring
    // used to promise — turns this red and forces the doc to move with
    // the code.
    expect(Object.keys(where).sort()).toEqual([
      "category",
      "confidence",
      "deletedAt",
      "lastSeen",
    ]);
    expect(where.createdBy).toBeUndefined();
    expect(where.seenCount).toBeUndefined();
  });

  it("module header states the live thresholds, not a remembered set", async () => {
    findManyBrain.mockResolvedValueOnce([]);
    await findLowTrustCandidates();
    const where = findManyBrain.mock.calls[0][0].where as {
      confidence: { lt: number; gte: number };
      lastSeen: { gte: Date };
    };
    const recencyDays = Math.round(
      (Date.now() - new Date(where.lastSeen.gte).getTime()) / 86_400_000,
    );

    const src = readFileSync(MODULE_PATH, "utf8");
    const header = src.slice(0, src.indexOf("*/") + 2);

    // The values come from the QUERY, so changing the band or the window
    // without editing the header fails here.
    expect(header).toContain(String(where.confidence.gte));
    expect(header).toContain(String(where.confidence.lt));
    expect(header).toContain(String(recencyDays));
  });
});

describe("the file layout this test assumes", () => {
  it("resolves the module it reads", () => {
    expect(readFileSync(join(MODULE_PATH), "utf8").length).toBeGreaterThan(0);
  });
});
