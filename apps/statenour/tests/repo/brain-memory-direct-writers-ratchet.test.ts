/**
 * tests/repo/brain-memory-direct-writers-ratchet.test.ts · 2026-09-08 (Brain plan, Wave 1)
 *
 * The memory commit gateway only governs writes that go through
 * brainMemory.remember(). A direct prisma.brainMemory.create/upsert bypasses
 * it — which is fine for telemetry rows and for the two identity-first operator
 * writers, and wrong for a new semantic writer that quietly forgets provenance.
 *
 * Ratchet: the files that wrote directly on 2026-09-08 are frozen in the
 * allowlist. A NEW direct writer fails here unless it carries a
 * `brain-memory-direct-write: <reason>` marker on the line above the call.
 * An allowlisted file that stops writing must be removed (the ratchet only
 * tightens). Positive control included so the detector cannot rot silently.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import allowlist from "./brain-memory-direct-writers.allowlist.json";

const ROOT = process.cwd();
const ROOTS = ["lib", "app", "features", "hooks"];
const WRITE = /\bbrainMemory\.(create|upsert|createMany)\s*\(/;
const MARKER = /brain-memory-direct-write:\s*\S/;

export function detectDirectWrite(source: string): { writes: boolean; declared: boolean } {
  return { writes: WRITE.test(source), declared: MARKER.test(source) };
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
}

describe("BrainMemory direct-writer ratchet", () => {
  const files: string[] = [];
  for (const r of ROOTS) {
    try { walk(join(ROOT, r), files); } catch { /* root absent in this checkout */ }
  }
  const writers = files
    .map((p) => ({ rel: relative(ROOT, p).replace(/\\/g, "/"), src: readFileSync(p, "utf8") }))
    .filter((f) => detectDirectWrite(f.src).writes);
  const frozen = new Set(allowlist.files);

  it("the sweep saw the source tree (not a vacuous pass)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(writers.length).toBeGreaterThan(20);
  });

  it("no NEW direct BrainMemory writer without a declared reason — use admitMemory() / brainMemory.remember()", () => {
    const offenders = writers
      .filter((f) => !frozen.has(f.rel) && !detectDirectWrite(f.src).declared)
      .map((f) => f.rel);
    expect(
      offenders,
      `new direct writers: ${offenders.join(", ")} — route through lib/brain/memory-admission.ts admitMemory(), or add a line "// brain-memory-direct-write: <why this row is not a semantic memory>"`,
    ).toEqual([]);
  });

  it("the allowlist only shrinks: an entry whose file no longer writes directly must be removed", () => {
    const stillWriting = new Set(writers.map((f) => f.rel));
    const stale = allowlist.files.filter((f) => !stillWriting.has(f));
    expect(stale, `remove from the allowlist (they no longer write directly): ${stale.join(", ")}`).toEqual([]);
  });

  it("POSITIVE CONTROL: the detector catches an undeclared write and honours the marker", () => {
    expect(detectDirectWrite("await prisma.brainMemory.create({ data })")).toEqual({ writes: true, declared: false });
    expect(detectDirectWrite("await tx.brainMemory.upsert({ where, create, update })").writes).toBe(true);
    expect(detectDirectWrite("// brain-memory-direct-write: telemetry row, not a memory\nawait prisma.brainMemory.create({ data })")).toEqual({ writes: true, declared: true });
    expect(detectDirectWrite("await brainMemory.remember(cat, key, content, source)").writes).toBe(false);
  });
});
