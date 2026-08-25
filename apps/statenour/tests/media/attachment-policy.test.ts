/**
 * BDN-314 · composer attachment policy.
 *
 * The property that matters: every rejection must carry a reason the
 * operator can act on. The incumbent message ("Images only for now")
 * outlived the constraint that produced it precisely because it said
 * nothing about WHY.
 */

import { describe, expect, it } from "vitest";
import {
  ACCEPT_ATTRIBUTE,
  MAX_BYTES_BY_KIND,
  decideAttachment,
  isAttachable,
  type AttachmentCandidate,
} from "@/lib/media/attachment-policy";

const file = (over: Partial<AttachmentCandidate> = {}): AttachmentCandidate => ({
  name: "shot.png",
  type: "image/png",
  size: 1024,
  ...over,
});

describe("attachment-policy · accepted kinds", () => {
  it("accepts images, audio and PDFs", () => {
    expect(decideAttachment(file())).toEqual({ accepted: true, kind: "image", lane: "inline" });
    expect(decideAttachment(file({ name: "memo.m4a", type: "audio/x-m4a" }))).toEqual({
      accepted: true,
      kind: "audio",
      lane: "inline",
    });
    expect(decideAttachment(file({ name: "inv.pdf", type: "application/pdf" }))).toEqual({
      accepted: true,
      kind: "pdf",
      lane: "inline",
    });
  });

  it("recovers the kind from the extension when the type is generic", () => {
    // Uploads routinely arrive as octet-stream; a type-only gate would
    // reject most real files.
    expect(
      decideAttachment(file({ name: "memo.mp3", type: "application/octet-stream" })),
    ).toEqual({ accepted: true, kind: "audio", lane: "inline" });
    expect(decideAttachment(file({ name: "scan.pdf", type: "" }))).toEqual({
      accepted: true,
      kind: "pdf",
      lane: "inline",
    });
  });

  it("is case-insensitive on type and extension", () => {
    expect(isAttachable(file({ name: "SHOT.JPEG", type: "IMAGE/JPEG" }))).toBe(true);
  });
});

describe("attachment-policy · video routes to the UPLOAD lane (BDN-319)", () => {
  it("refuses video with the storage-backend reason (2026-08-25 · VideoDB retired, zero uploads ever)", () => {
    // The refusal must name the constraint — a bare "not supported" is
    // how the original "Images only for now" outlived its reason.
    const d = decideAttachment(file({ name: "bay5.mp4", type: "video/mp4", size: 50 * 1024 * 1024 }));
    expect(d.accepted).toBe(false);
    if (!d.accepted) expect(d.reason).toMatch(/storage backend/i);
  });

  it("keeps every other kind on the inline lane", () => {
    for (const f of [
      file(),
      file({ name: "m.m4a", type: "audio/x-m4a" }),
      file({ name: "i.pdf", type: "application/pdf" }),
    ]) {
      const d = decideAttachment(f);
      expect(d.accepted).toBe(true);
      if (d.accepted) expect(d.lane).toBe("inline");
    }
  });

  it("detects video by extension too — the refusal cannot be dodged via octet-stream", () => {
    const d = decideAttachment(file({ name: "clip.mov", type: "application/octet-stream" }));
    expect(d.accepted).toBe(false);
    if (!d.accepted) expect(d.reason).toMatch(/storage backend/i);
  });

  it("video is not attachable at any size while no storage backend exists", () => {
    expect(isAttachable(file({ name: "a.mp4", type: "video/mp4", size: 1024 }))).toBe(false);
    expect(isAttachable(file({ name: "a.mp4", type: "video/mp4", size: 400 * 1024 * 1024 }))).toBe(
      false,
    );
  });
});

describe("attachment-policy · size caps", () => {
  it("preserves the incumbent 10 MB image cap", () => {
    expect(MAX_BYTES_BY_KIND.image).toBe(10 * 1024 * 1024);
    expect(isAttachable(file({ size: MAX_BYTES_BY_KIND.image }))).toBe(true);
    expect(isAttachable(file({ size: MAX_BYTES_BY_KIND.image + 1 }))).toBe(false);
  });

  it("states the actual size and the limit in the rejection", () => {
    const d = decideAttachment(file({ size: 12 * 1024 * 1024 }));
    expect(d.accepted).toBe(false);
    if (!d.accepted) {
      expect(d.reason).toContain("12.0 MB");
      expect(d.reason).toContain("10.0 MB");
    }
  });

  it("caps audio and PDF tighter than images", () => {
    // base64 inflates ~33% and the encoded string is persisted per
    // message — a bloated conversation row never shrinks.
    expect(MAX_BYTES_BY_KIND.audio).toBeLessThan(MAX_BYTES_BY_KIND.image);
    expect(MAX_BYTES_BY_KIND.pdf).toBeLessThan(MAX_BYTES_BY_KIND.image);
  });
});

describe("attachment-policy · rejections", () => {
  it("rejects an unsupported type by name", () => {
    const d = decideAttachment(file({ name: "book.epub", type: "application/epub+zip" }));
    expect(d.accepted).toBe(false);
    if (!d.accepted) expect(d.reason).toContain("application/epub+zip");
  });

  it("rejects a zero-byte file rather than sending an empty data URL", () => {
    // A 0-byte attach reads as success and then delivers nothing to the
    // model — a silent no-op the operator cannot see.
    const d = decideAttachment(file({ size: 0 }));
    expect(d.accepted).toBe(false);
    if (!d.accepted) expect(d.reason).toContain("empty");
  });

  it("every rejection carries a non-trivial reason", () => {
    const rejects = [
      file({ name: "b.epub", type: "application/epub+zip" }),
      file({ size: 0 }),
      file({ size: 99 * 1024 * 1024 }),
    ];
    for (const r of rejects) {
      const d = decideAttachment(r);
      expect(d.accepted).toBe(false);
      if (!d.accepted) expect(d.reason.length).toBeGreaterThan(20);
    }
  });
});

describe("attachment-policy · picker hint", () => {
  it("advertises every accepted family", () => {
    expect(ACCEPT_ATTRIBUTE).toContain("image/png");
    expect(ACCEPT_ATTRIBUTE).toContain("audio/mpeg");
    expect(ACCEPT_ATTRIBUTE).toContain("application/pdf");
  });

  it("does NOT advertise video while decideAttachment refuses it", () => {
    // Advertising a type the gate refuses would invite a refusal at
    // attach time — the picker and the policy must agree.
    expect(ACCEPT_ATTRIBUTE).not.toContain("video/mp4");
  });
});
