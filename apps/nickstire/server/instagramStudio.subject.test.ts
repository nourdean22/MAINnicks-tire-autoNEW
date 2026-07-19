/**
 * pickSubjectImage — the renderer must never treat its OWN output as a photo.
 *
 * `imageUrls` is renderInstagramStudioAssets' return value. The router does
 * `return { ...evaluated, imageUrls }`, the client stores that back into the
 * draft, and the Queue re-renders stored drafts. So on any SECOND render the
 * "subject photo" was the JPEG of the card the FIRST render produced.
 *
 * The output was a card inside a card — the previous render painted full-bleed
 * as the background, a scrim over it, the same headline drawn on top again —
 * nesting one level deeperon every re-render, publishable, with nothing flagging it.
 * It also flipped hasSubjectImage to true, silently changing which visual family
 * was selected.
 */
import { describe, it, expect } from "vitest";
import { pickSubjectImage, STUDIO_ASSET_PREFIX } from "./services/instagramStudio";

const rendered = (n = 1) => `https://cdn.example.com/${STUDIO_ASSET_PREFIX}ig_abc-${n}.jpg`;
const photo = "https://cdn.example.com/uploads/worn-tread-closeup.jpg";

describe("a card we rendered is never a subject", () => {
  it("REFUSES the renderer's own output — the re-render case", () => {
    expect(pickSubjectImage([rendered(1)])).toBeNull();
  });

  it("refuses every one of them, not just the first", () => {
    expect(pickSubjectImage([rendered(1), rendered(2), rendered(3)])).toBeNull();
  });

  it("still accepts a real photograph", () => {
    expect(pickSubjectImage([photo])).toBe(photo);
  });

  it("finds the real photo even when a rendered card comes first", () => {
    // The exact mixed state after a re-render of a draft that HAD a subject.
    expect(pickSubjectImage([rendered(1), photo])).toBe(photo);
  });

  it("treats no images as no subject — the normal case, not a failure", () => {
    // Most drafts have no subject and render on the family background instead.
    expect(pickSubjectImage([])).toBeNull();
    expect(pickSubjectImage(null)).toBeNull();
    expect(pickSubjectImage(undefined)).toBeNull();
  });

  it("ignores empty and non-string entries rather than returning them", () => {
    expect(pickSubjectImage(["", photo])).toBe(photo);
    expect(pickSubjectImage([null as never, undefined as never, photo])).toBe(photo);
  });

  it("matches the prefix wherever it appears in the URL", () => {
    // Storage may serve from a bucket path, a CDN, or the local /generated route;
    // the discriminator has to be the key, not the host.
    expect(pickSubjectImage([`https://s3.amazonaws.com/bucket/${STUDIO_ASSET_PREFIX}x-1.jpg`])).toBeNull();
    expect(pickSubjectImage([`/generated/${STUDIO_ASSET_PREFIX}x-1.jpg`])).toBeNull();
  });

  it("is idempotent — re-running on its own result cannot degrade", () => {
    const first = pickSubjectImage([photo, rendered(1)]);
    expect(pickSubjectImage([first as string])).toBe(photo);
  });
});
