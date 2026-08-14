/**
 * BDN-309 · chat media part classification + URL safety.
 *
 * Pure helpers only — the JSX branches are thin wrappers over these two
 * decisions, and testing them without a DOM keeps this in the fast
 * suite. The two properties that matter:
 *   1. a real upload is classified by EXTENSION when mediaType is
 *      generic, because that is how most uploads actually arrive;
 *   2. no hostile scheme ever reaches a src/href.
 */

import { describe, expect, it } from "vitest";
import {
  classifyMediaPart,
  isRenderableUrl,
} from "@/features/chat-v2/components/chat-media-part";

describe("chat-media-part · classification by mediaType", () => {
  it("classifies the four first-class kinds", () => {
    expect(classifyMediaPart({ mediaType: "image/png" })).toBe("image");
    expect(classifyMediaPart({ mediaType: "video/mp4" })).toBe("video");
    expect(classifyMediaPart({ mediaType: "audio/mpeg" })).toBe("audio");
    expect(classifyMediaPart({ mediaType: "application/pdf" })).toBe("pdf");
  });

  it("is case-insensitive on mediaType", () => {
    expect(classifyMediaPart({ mediaType: "VIDEO/MP4" })).toBe("video");
  });

  it("falls back to 'other' for a genuinely unknown type", () => {
    expect(classifyMediaPart({ mediaType: "application/vnd.ms-excel" })).toBe("other");
    expect(classifyMediaPart({})).toBe("other");
  });
});

describe("chat-media-part · classification by extension (the real-upload path)", () => {
  it("recovers the kind when mediaType is the generic octet-stream", () => {
    // Browsers send octet-stream constantly and the server does not
    // always correct it. Trusting mediaType alone would push most real
    // uploads into 'other' — the exact bug this component fixes.
    expect(
      classifyMediaPart({ mediaType: "application/octet-stream", filename: "bay5.mp4" }),
    ).toBe("video");
    expect(
      classifyMediaPart({ mediaType: "application/octet-stream", filename: "note.m4a" }),
    ).toBe("audio");
    expect(
      classifyMediaPart({ mediaType: "application/octet-stream", filename: "invoice.pdf" }),
    ).toBe("pdf");
  });

  it("recovers the kind when mediaType is missing entirely", () => {
    expect(classifyMediaPart({ filename: "shop.MOV" })).toBe("video");
    expect(classifyMediaPart({ filename: "photo.JPEG" })).toBe("image");
  });

  it("does not mistake a dotless filename for an extension", () => {
    expect(classifyMediaPart({ filename: "mp4" })).toBe("other");
  });

  it("prefers an explicit mediaType over a misleading extension", () => {
    expect(classifyMediaPart({ mediaType: "image/png", filename: "screenshot.mp4" })).toBe(
      "image",
    );
  });
});

describe("chat-media-part · URL safety (load-bearing)", () => {
  it("admits the schemes we actually serve media over", () => {
    expect(isRenderableUrl("https://cdn.example.com/a.mp4")).toBe(true);
    expect(isRenderableUrl("http://localhost:3001/a.mp4")).toBe(true);
    expect(isRenderableUrl("data:image/png;base64,iVBORw0KG")).toBe(true);
    expect(isRenderableUrl("blob:https://bdnick.info/9f1c")).toBe(true);
    expect(isRenderableUrl("/api/images/42")).toBe(true);
  });

  it("rejects hostile and local-file schemes", () => {
    // A file part's url is attacker-influenceable via tool output or a
    // poisoned attachment; this is the only gate before it lands in a
    // src/href.
    expect(isRenderableUrl("javascript:alert(1)")).toBe(false);
    expect(isRenderableUrl("JavaScript:alert(1)")).toBe(false);
    expect(isRenderableUrl("file:///etc/passwd")).toBe(false);
    expect(isRenderableUrl("vbscript:msgbox")).toBe(false);
  });

  it("rejects empty and undefined urls", () => {
    expect(isRenderableUrl(undefined)).toBe(false);
    expect(isRenderableUrl("")).toBe(false);
    expect(isRenderableUrl("   ")).toBe(false);
  });

  it("ignores surrounding whitespace rather than being fooled by it", () => {
    expect(isRenderableUrl("  https://example.com/a.mp4  ")).toBe(true);
    expect(isRenderableUrl("  javascript:alert(1)")).toBe(false);
  });
});
