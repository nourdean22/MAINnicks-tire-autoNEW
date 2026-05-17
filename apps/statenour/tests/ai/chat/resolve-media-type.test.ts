/**
 * Tests for the resolveMediaType helper · v10.0.185
 *
 * Pre-fix · file parts persisted with no mediaType / mimeType ended up
 * as `mediaType: undefined`. On replay the AI SDK emitted:
 *   "'file part media type ' functionality not supported."
 * 26 chat-turn fails in 72h came from exactly this. The resolver is
 * the kaizen poka-yoke — never returns undefined, always a valid
 * MIME string.
 */

import { describe, it, expect } from "vitest";
import { resolveMediaType, isUsableFilePart } from "@/lib/ai/chat/message-fields";

describe("resolveMediaType · returns a valid MIME string in all cases", () => {
  it("uses part.mediaType when set", () => {
    expect(resolveMediaType({ mediaType: "image/png" })).toBe("image/png");
  });

  it("falls back to part.mimeType when mediaType missing", () => {
    expect(resolveMediaType({ mimeType: "image/jpeg" })).toBe("image/jpeg");
  });

  it("derives from data:URL when both fields missing", () => {
    expect(
      resolveMediaType({}, "data:image/webp;base64,UklGRiIA"),
    ).toBe("image/webp");
  });

  it("returns octet-stream as last resort when nothing usable", () => {
    expect(resolveMediaType({}, "https://example.com/file.bin")).toBe(
      "application/octet-stream",
    );
    expect(resolveMediaType({})).toBe("application/octet-stream");
  });

  it("ignores empty-string mediaType (the real prod bug)", () => {
    // The DB had rows with mediaType="" not undefined — same
    // failure mode, different shape. Treat empty as missing.
    expect(resolveMediaType({ mediaType: "" }, "data:image/png;base64,a")).toBe(
      "image/png",
    );
  });

  it("ignores non-string mediaType (defensive)", () => {
    expect(resolveMediaType({ mediaType: null as unknown as string })).toBe(
      "application/octet-stream",
    );
    expect(resolveMediaType({ mediaType: 42 as unknown as string })).toBe(
      "application/octet-stream",
    );
  });
});

describe("isUsableFilePart · skip invalid parts before they hit streamText", () => {
  it("accepts file with url", () => {
    expect(isUsableFilePart({ type: "file", url: "data:image/png;base64,a" })).toBe(true);
  });

  it("accepts image with image url", () => {
    expect(isUsableFilePart({ type: "image", image: "https://x" })).toBe(true);
  });

  it("rejects file with no url/data/image", () => {
    expect(isUsableFilePart({ type: "file" })).toBe(false);
  });

  it("rejects non-file types", () => {
    expect(isUsableFilePart({ type: "text" })).toBe(false);
  });
});
