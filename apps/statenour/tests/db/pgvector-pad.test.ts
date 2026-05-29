/**
 * Wave 0 · embedding write-time freshness fix.
 *
 * `writePgvectorColumn` now dual-writes the fixed-1536 column that the
 * opinionated chat-context recall (lib/brain/memory-recall.ts) actually
 * reads. The load-bearing correctness property is that padding a
 * sub-1536 embedding up to 1536 with zeros is COSINE-PRESERVING — i.e.
 * a 1024-dim vector padded to 1536 ranks identically against other
 * padded vectors as it would natively. If that invariant ever breaks,
 * recall ranking silently corrupts, so it's pinned here.
 */
import { describe, it, expect } from "vitest";
import { padToVectorDim, VECTOR_DIM_1536, vectorLiteral } from "@/lib/db/pgvector";
import { cosineSimilarity } from "@/lib/brain/embedding-utils";

describe("padToVectorDim", () => {
  it("returns the same array when already at the target dim", () => {
    const vec = Array.from({ length: 1536 }, (_, i) => i / 1536);
    const out = padToVectorDim(vec, VECTOR_DIM_1536);
    expect(out).toHaveLength(1536);
    expect(out).toEqual(vec);
  });

  it("zero-pads a shorter vector up to the target dim", () => {
    const vec = [0.1, 0.2, 0.3];
    const out = padToVectorDim(vec, 5);
    expect(out).toEqual([0.1, 0.2, 0.3, 0, 0]);
  });

  it("pads a realistic 1024-dim embedding to exactly 1536", () => {
    const vec = Array.from({ length: 1024 }, (_, i) => Math.sin(i));
    const out = padToVectorDim(vec, VECTOR_DIM_1536);
    expect(out).toHaveLength(1536);
    expect(out.slice(0, 1024)).toEqual(vec);
    expect(out.slice(1024).every((x) => x === 0)).toBe(true);
  });

  it("truncates a longer vector down to the target dim (defensive clamp)", () => {
    const vec = Array.from({ length: 2048 }, (_, i) => i);
    const out = padToVectorDim(vec, VECTOR_DIM_1536);
    expect(out).toHaveLength(1536);
    expect(out[1535]).toBe(1535);
  });

  it("handles the empty vector without throwing", () => {
    expect(padToVectorDim([], 4)).toEqual([0, 0, 0, 0]);
  });

  // The whole reason a 1024-dim model can share a vector(1536) HNSW
  // column with native-1536 vectors: zero-padding both operands leaves
  // cosine similarity exactly unchanged.
  it("preserves cosine similarity exactly under zero-padding", () => {
    const a = [0.3, -0.7, 0.1, 0.9, -0.2];
    const b = [0.5, 0.2, -0.4, 0.6, 0.8];
    const native = cosineSimilarity(a, b);
    const padded = cosineSimilarity(
      padToVectorDim(a, 1536),
      padToVectorDim(b, 1536),
    );
    expect(padded).toBeCloseTo(native, 12);
  });

  it("preserves relative ranking across many padded pairs", () => {
    const query = Array.from({ length: 1024 }, (_, i) => Math.cos(i * 0.37));
    const candidates = [
      Array.from({ length: 1024 }, (_, i) => Math.cos(i * 0.37 + 0.05)), // near
      Array.from({ length: 1024 }, (_, i) => Math.cos(i * 0.37 + 1.5)), // mid
      Array.from({ length: 1024 }, (_, i) => Math.sin(i * 2.1)), // far
    ];
    const nativeRank = candidates
      .map((c, i) => ({ i, s: cosineSimilarity(query, c) }))
      .sort((x, y) => y.s - x.s)
      .map((r) => r.i);
    const paddedRank = candidates
      .map((c, i) => ({
        i,
        s: cosineSimilarity(
          padToVectorDim(query, 1536),
          padToVectorDim(c, 1536),
        ),
      }))
      .sort((x, y) => y.s - x.s)
      .map((r) => r.i);
    expect(paddedRank).toEqual(nativeRank);
  });
});

describe("vectorLiteral + padToVectorDim compose for the 1536 write", () => {
  it("produces a clean [a,b,...] literal of the padded vector", () => {
    const lit = vectorLiteral(padToVectorDim([1, 2, 3], 5));
    expect(lit).toBe("[1,2,3,0,0]");
  });

  it("scrubs non-finite values to 0 so pgvector never rejects the cast", () => {
    const lit = vectorLiteral(padToVectorDim([1, NaN, Infinity], 4));
    expect(lit).toBe("[1,0,0,0]");
  });
});
