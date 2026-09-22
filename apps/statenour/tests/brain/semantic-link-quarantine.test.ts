/**
 * The semantic-link writer must not build edges from quarantined rows
 * (2026-09-22).
 *
 * Measured read-only on prod: semantic_edges holds 19,899 edges and 9,949 of
 * them link an edge to an edge. The writer's candidate SELECT took any live
 * memory with confidence >= 0.5 - including the edge ROWS it writes itself -
 * and its neighbour KNN ranked every brain_memory vector, including the ~3
 * vectors each edge carried. Two category filters, both bound to the SAME
 * recall-quarantine list the lanes use, so the writer, embedding and recall
 * cannot drift apart. Source contract per SQL block, comment-stripped.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("../../lib/brain/semantic-link.ts", import.meta.url), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const candidateStart = CODE.indexOf("SELECT bm.id::text, bm.category::text");
const candidateEnd = CODE.indexOf("LIMIT $3", candidateStart);
const CANDIDATES = CODE.slice(candidateStart, candidateEnd);
const knnStart = CODE.indexOf("FROM vector_embeddings ve", candidateEnd);
const knnEnd = CODE.indexOf("LIMIT ${TOP_K}", knnStart);
const KNN = CODE.slice(knnStart, knnEnd);

describe("semantic-link writer · quarantine filters", () => {
  it("POSITIVE CONTROL: both SQL blocks were found", () => {
    expect(candidateStart).toBeGreaterThan(0);
    expect(candidateEnd).toBeGreaterThan(candidateStart);
    expect(knnStart).toBeGreaterThan(candidateEnd);
    expect(knnEnd).toBeGreaterThan(knnStart);
    expect(CANDIDATES).toContain("LEFT JOIN brain_memories edges");
    expect(KNN).toContain("ORDER BY ve.embedding_vec <=>");
  });

  it("imports the recall-quarantine list rather than keeping its own", () => {
    expect(CODE).toMatch(/import \{[^}]*RECALL_EXCLUDE_CATEGORIES[^}]*\} from "@\/lib\/brain\/categories"/);
  });

  it("candidates exclude quarantined categories - an edge row is never a memory to link", () => {
    expect(CANDIDATES).toMatch(/bm\.category <> ALL\(\$4::text\[\]\)/);
  });

  it("the neighbour KNN joins brain_memories and excludes quarantined categories, keeping the unavailable-source filter", () => {
    expect(KNN).toMatch(/JOIN brain_memories bm/);
    expect(KNN).toMatch(/bm\.deleted_at IS NULL/);
    expect(KNN).toMatch(/bm\.category <> ALL\(\$2::text\[\]\)/);
    expect(KNN).toContain('ve."sourceUnavailableAt" IS NULL');
  });
});
