/**
 * Long-knowledge-dump guard for the image-intent classifier · May 02
 *
 * Pre-fix · pasting a long brand-style blueprint that mentioned
 * "design" + "visual" + "graphic" tripped the verb+noun image
 * intent matcher and Nick tried to generate an image. Real intent
 * was "ingest this into the brain."
 *
 * The fix in lib/ai/chat/interceptors.ts adds isLongKnowledgeDump()
 * — long (>600 chars) + structured (3+ newlines OR section markers)
 * input forces nlImage = false. Slash commands still bypass.
 */

import { describe, it, expect } from "vitest";
import {
  classifyIntercept,
  isLongKnowledgeDump,
} from "@/lib/ai/chat/interceptors";

describe("isLongKnowledgeDump", () => {
  it("returns false on short prompts", () => {
    expect(isLongKnowledgeDump("make me a brake post")).toBe(false);
    expect(isLongKnowledgeDump("/image cyberpunk car")).toBe(false);
  });

  it("returns true on long multi-paragraph dumps", () => {
    const dump = `Here are my thoughts on the brand strategy.

Trust matters more than discount.

The visual style should be authentic.

We need to lean into educational content.`.padEnd(700, " more text");
    expect(isLongKnowledgeDump(dump)).toBe(true);
  });

  it("returns true on documents with section markers", () => {
    const blueprint = "Executive Summary " + "x".repeat(700) + "\nSECTION 1 — BRAND CORE\nLorem ipsum.";
    expect(isLongKnowledgeDump(blueprint)).toBe(true);
  });

  it("returns false on long but non-structured single-paragraph text", () => {
    // Long single line without newlines or section markers — could be a
    // detailed image prompt, so we don't claim it as a knowledge dump.
    const text = "make me a really detailed cinematic photo of a Cleveland auto repair shop ".repeat(10);
    expect(isLongKnowledgeDump(text)).toBe(false);
  });
});

describe("classifyIntercept · knowledge-dump gate", () => {
  it("does NOT trigger nlImage on a brand blueprint mentioning visual/design", () => {
    const blueprint = `Nick's Tire & Auto: Forensic Brand Style Blueprint
Executive Summary
This document provides a forensic analysis of the Nick's Tire & Auto Instagram account. The visual style is a mix of authentic, in-shop imagery and more polished, informational graphics.

SECTION 1 — BRAND CORE
What this brand is: A direct, no-nonsense, and highly knowledgeable local auto repair shop that prioritizes trust and education over aggressive sales tactics.

The most successful content educates the audience about common car problems and provides clear, actionable advice. The blueprint should guide future content creation through design rules and a visual library.`;

    const r = classifyIntercept(blueprint);
    expect(r.nlImage).toBe(false);
    expect(r.slashImage).toBe(false);
  });

  it("STILL triggers nlImage on a short direct image ask", () => {
    expect(classifyIntercept("make me a brake post image").nlImage).toBe(true);
    expect(classifyIntercept("can you generate a picture of a tire shop").nlImage).toBe(true);
    expect(classifyIntercept("/image cyberpunk car").slashImage).toBe(true);
  });

  it("respects /image even inside long structured content", () => {
    const explicitSlash = "/image " + "a really detailed prompt ".repeat(50);
    const r = classifyIntercept(explicitSlash);
    // Slash command bypasses the knowledge-dump guard intentionally —
    // user typed "/image" so they explicitly want generation.
    expect(r.slashImage).toBe(true);
  });
});

describe("classifyIntercept · /save slash command", () => {
  it("recognizes /save with a space", () => {
    const r = classifyIntercept("/save brand voice should be direct");
    expect(r.slashSave).toBe(true);
    expect(r.any).toBe(true);
  });
  it("recognizes /save: with colon", () => {
    expect(classifyIntercept("/save: this is the saved thing").slashSave).toBe(true);
  });
  it("recognizes /remember and /ingest aliases", () => {
    expect(classifyIntercept("/remember this conversation").slashSave).toBe(true);
    expect(classifyIntercept("/ingest the brand blueprint").slashSave).toBe(true);
  });
  it("does NOT trigger on mid-sentence /save", () => {
    expect(classifyIntercept("I want to /save this thought later").slashSave).toBe(false);
  });
  it("does NOT trigger on unrelated slash commands", () => {
    expect(classifyIntercept("/image cyberpunk car").slashSave).toBe(false);
  });
});
