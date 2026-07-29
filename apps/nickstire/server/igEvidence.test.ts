/**
 * Evidence-first Create (Wave B) — the contract that keeps a REAL photo and a
 * RENDERED card distinguishable, plus the wiring a big upload silently dies
 * without.
 *
 * These scans deliberately do NOT strip comments: naive block-comment
 * stripping on a large file eats CODE when any string literal contains
 * a slash-star (measured on _core/index.ts — the stripped text lost the very
 * line under test). Instead every anchor is a code-shaped string that cannot
 * appear in prose: a backtick template prefix, an exact predicate, an exact
 * mount path + limit pair.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pickSubjectImage, STUDIO_ASSET_PREFIX } from "./services/instagramStudio";

describe("evidence photos vs rendered cards", () => {
  it("an ig-evidence URL is a valid subject — the upload prefix must never collide with the renderer's", () => {
    expect("ig-evidence/").not.toContain(STUDIO_ASSET_PREFIX);
    expect(pickSubjectImage(["https://cdn.example/ig-evidence/171-tread.jpg"]))
      .toBe("https://cdn.example/ig-evidence/171-tread.jpg");
  });

  it("a card the renderer produced is NEVER a subject (the card-inside-a-card class)", () => {
    expect(pickSubjectImage([`https://cdn.example/${STUDIO_ASSET_PREFIX}card.jpg`])).toBeNull();
    // Mixed list: the real photo wins even when a card precedes it.
    expect(pickSubjectImage([
      `https://cdn.example/${STUDIO_ASSET_PREFIX}card.jpg`,
      "https://cdn.example/ig-evidence/tread.jpg",
    ])).toBe("https://cdn.example/ig-evidence/tread.jpg");
  });
});

describe("upload wiring pins", () => {
  it("uploadEvidencePhoto stores under ig-evidence/ (backtick template anchor — comments can't match it)", () => {
    const src = readFileSync(resolve(process.cwd(), "server/routers/instagramStudio.ts"), "utf8");
    const proc = src.slice(src.indexOf("uploadEvidencePhoto:"));
    expect(proc).toContain("`ig-evidence/");
    expect(proc.slice(0, proc.indexOf("generate:"))).not.toContain("`instagram-studio/");
  });

  it("generate refuses rendered-card URLs as evidence at the input boundary", () => {
    const src = readFileSync(resolve(process.cwd(), "server/routers/instagramStudio.ts"), "utf8");
    expect(src).toContain('!u.includes("instagram-studio/")');
  });

  it("_core mounts the 12mb body limit for the upload path — without it uploads die at the global parser cap", () => {
    const src = readFileSync(resolve(process.cwd(), "server/_core/index.ts"), "utf8");
    const line = src.split("\n").find((l) => l.includes('"/api/trpc/instagramStudio.uploadEvidencePhoto"'));
    expect(line, "the per-procedure json mount is missing").toBeTruthy();
    expect(line).toContain('limit: "12mb"');
  });
});
