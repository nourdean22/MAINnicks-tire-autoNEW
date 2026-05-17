/**
 * Unit tests for lib/ai/chat/message-fields.ts
 *
 * v7.6 · C14 · Apr 29 — covers the single-source-of-truth helpers
 * used by both write paths (user + assistant) AND the backfill cron.
 * Pure functions, no DB, deterministic — perfect vitest target.
 */

import { describe, it, expect } from "vitest";
import {
  extractParts,
  extractAttachments,
  computeAttachmentsHash,
  buildSearchableContent,
  extractClientMessageId,
  synthesizeFallbackClientMessageId,
} from "@/lib/ai/chat/message-fields";

describe("extractParts", () => {
  it("returns null when given nothing usable", () => {
    expect(extractParts(null)).toBeNull();
    expect(extractParts(undefined)).toBeNull();
    expect(extractParts([])).toBeNull();
    expect(extractParts("not-an-array")).toBeNull();
  });

  it("synthesizes a single text part from fallback when no parts present", () => {
    const out = extractParts(null, "hello world");
    expect(out).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("extracts text parts intact", () => {
    const out = extractParts([{ type: "text", text: "yo" }]);
    expect(out).toEqual([{ type: "text", text: "yo" }]);
  });

  it("extracts file parts with mediaType + url + filename", () => {
    const out = extractParts([
      { type: "file", url: "https://x.com/a.png", mediaType: "image/png", filename: "a.png" },
    ]);
    expect(out).toEqual([
      { type: "file", mediaType: "image/png", url: "https://x.com/a.png", filename: "a.png" },
    ]);
  });

  it("up-converts v4/v5 image parts to file shape", () => {
    const out = extractParts([{ type: "image", image: "data:image/jpeg;base64,abc", mimeType: "image/jpeg" }]);
    expect(out).toEqual([{ type: "file", mediaType: "image/jpeg", url: "data:image/jpeg;base64,abc" }]);
  });

  it("handles reasoning parts", () => {
    const out = extractParts([{ type: "reasoning", text: "thinking..." }]);
    expect(out).toEqual([{ type: "reasoning", text: "thinking..." }]);
  });

  it("handles tool-call + tool-result parts", () => {
    const out = extractParts([
      { type: "tool-call", toolName: "searchKnowledge", toolCallId: "tc-1", args: { q: "test" } },
      { type: "tool-result", toolName: "searchKnowledge", toolCallId: "tc-1", result: { hits: 3 } },
    ]);
    expect(out).toEqual([
      { type: "tool-call", toolName: "searchKnowledge", toolCallId: "tc-1", args: { q: "test" } },
      { type: "tool-result", toolName: "searchKnowledge", toolCallId: "tc-1", result: { hits: 3 } },
    ]);
  });

  it("drops malformed parts silently", () => {
    const out = extractParts([
      null,
      { type: "text", text: "keep" },
      { type: "file" /* missing url */ },
      "not-an-object",
      { type: "unknown-type", x: 1 },
    ]);
    expect(out).toEqual([{ type: "text", text: "keep" }]);
  });

  it("extracts source parts (citations)", () => {
    const out = extractParts([{ type: "source", url: "https://example.com", title: "Doc" }]);
    expect(out).toEqual([{ type: "source", url: "https://example.com", title: "Doc" }]);
  });
});

describe("extractAttachments", () => {
  it("filters file parts only", () => {
    const parts = [
      { type: "text" as const, text: "x" },
      { type: "file" as const, url: "u1", mediaType: "image/png" },
      { type: "reasoning" as const, text: "y" },
      { type: "file" as const, url: "u2" },
    ];
    expect(extractAttachments(parts)).toEqual([
      { type: "file", url: "u1", mediaType: "image/png" },
      { type: "file", url: "u2" },
    ]);
  });

  it("returns empty array for null/undefined", () => {
    expect(extractAttachments(null)).toEqual([]);
    expect(extractAttachments(undefined)).toEqual([]);
  });
});

describe("computeAttachmentsHash", () => {
  it("returns null for empty / null", () => {
    expect(computeAttachmentsHash(null)).toBeNull();
    expect(computeAttachmentsHash([])).toBeNull();
    expect(computeAttachmentsHash(undefined)).toBeNull();
  });

  it("hashes urls deterministically + sort-stable", () => {
    const a = computeAttachmentsHash([{ url: "a" }, { url: "b" }]);
    const b = computeAttachmentsHash([{ url: "b" }, { url: "a" }]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns different hash for different urls", () => {
    const a = computeAttachmentsHash([{ url: "a" }]);
    const b = computeAttachmentsHash([{ url: "b" }]);
    expect(a).not.toBe(b);
  });

  it("ignores non-string urls", () => {
    expect(computeAttachmentsHash([{ url: "" }])).toBeNull();
  });
});

describe("buildSearchableContent", () => {
  it("returns null on empty input + no fallback", () => {
    expect(buildSearchableContent(null)).toBeNull();
    expect(buildSearchableContent([])).toBeNull();
  });

  it("falls back to plain text when no parts", () => {
    expect(buildSearchableContent(null, "fallback text")).toBe("fallback text");
  });

  it("flattens text + reasoning + tool-result", () => {
    const out = buildSearchableContent([
      { type: "text", text: "hello" },
      { type: "reasoning", text: "thinking" },
      { type: "tool-result", toolName: "search", result: "found 3 hits" },
    ]);
    expect(out).toBe("hello\n[reasoning] thinking\n[tool:search] found 3 hits");
  });

  it("includes file names + source titles", () => {
    const out = buildSearchableContent([
      { type: "file", url: "x.png", filename: "schematic.png" },
      { type: "source", url: "https://x.com", title: "Doc Title" },
    ]);
    expect(out).toContain("schematic.png");
    expect(out).toContain("Doc Title");
  });
});

describe("extractClientMessageId", () => {
  it("returns string ids unchanged", () => {
    expect(extractClientMessageId({ id: "msg-abc-123" })).toBe("msg-abc-123");
  });

  it("rejects non-string ids", () => {
    expect(extractClientMessageId({ id: 42 })).toBeUndefined();
    expect(extractClientMessageId({ id: null })).toBeUndefined();
    expect(extractClientMessageId({ id: undefined })).toBeUndefined();
  });

  it("rejects empty / oversized ids", () => {
    expect(extractClientMessageId({ id: "" })).toBeUndefined();
    expect(extractClientMessageId({ id: "x".repeat(65) })).toBeUndefined();
    expect(extractClientMessageId({ id: "x".repeat(64) })).toBe("x".repeat(64));
  });

  it("handles non-objects gracefully", () => {
    expect(extractClientMessageId(null)).toBeUndefined();
    expect(extractClientMessageId(undefined)).toBeUndefined();
    expect(extractClientMessageId("string")).toBeUndefined();
  });
});

describe("synthesizeFallbackClientMessageId", () => {
  it("produces deterministic ids within a 10s bucket", () => {
    const args = { conversationId: "c1", role: "user", content: "hi", timestamp: 1700000000000 };
    const a = synthesizeFallbackClientMessageId(args);
    const b = synthesizeFallbackClientMessageId({ ...args, timestamp: 1700000005000 });
    expect(a).toBe(b);
  });

  it("differs across 10s buckets", () => {
    const args = { conversationId: "c1", role: "user", content: "hi", timestamp: 1700000000000 };
    const a = synthesizeFallbackClientMessageId(args);
    const b = synthesizeFallbackClientMessageId({ ...args, timestamp: 1700000020000 });
    expect(a).not.toBe(b);
  });

  it("differs across content", () => {
    const a = synthesizeFallbackClientMessageId({
      conversationId: "c1",
      role: "user",
      content: "hi",
      timestamp: 0,
    });
    const b = synthesizeFallbackClientMessageId({
      conversationId: "c1",
      role: "user",
      content: "yo",
      timestamp: 0,
    });
    expect(a).not.toBe(b);
  });

  it("uses srv- prefix to distinguish from client-minted", () => {
    const out = synthesizeFallbackClientMessageId({
      conversationId: "c1",
      role: "user",
      content: "hi",
      timestamp: 0,
    });
    expect(out).toMatch(/^srv-[a-f0-9]{32}$/);
  });
});
