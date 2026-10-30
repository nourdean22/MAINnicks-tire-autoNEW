/**
 * Home's Instagram strip must not download reel videos (railway-audit, 2026-10-30).
 *
 * The strip is a row of links to Instagram; nothing plays inline. It rendered
 * each VIDEO post as <video preload="metadata">, and the durable DB fallback
 * returns no thumbnailUrl, so browsers pulled the whole 14-18 MB reel. Railway
 * HTTP logs, 07:22-13:19Z: reel MP4s were 750 of the 869 MB nickstire served
 * (86%), about 50 MB per homepage view.
 *
 * Pins, through the component Home renders:
 *  - a VIDEO post renders no <video> at all, with or without a thumbnail;
 *  - POSITIVE CONTROL: a thumbnail still renders as the poster image, so the
 *    fix cannot pass by rendering nothing;
 *  - a video tile carries a play badge, an image post does not;
 *  - an image post still shows its own media.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InstagramTileMedia } from "../components/InstagramTileMedia";

const REEL = "https://nickstire.org/generated/reels/reel-2070012.mp4";
const THUMB = "https://scontent.cdninstagram.com/v/t51/thumb.jpg";

describe("Home Instagram tile: facade, never a <video>", () => {
  it("a VIDEO post with no thumbnail (the live 2026-10-30 payload) renders no video and no MP4 reference", () => {
    const { container } = render(<InstagramTileMedia post={{ type: "VIDEO", mediaUrl: REEL }} />);
    expect(container.querySelector("video")).toBeNull();
    expect(container.innerHTML).not.toContain(".mp4");
    expect(container.querySelector("[data-testid='instagram-tile-placeholder']")).not.toBeNull();
  });

  it("POSITIVE CONTROL: a VIDEO post with a thumbnail renders it as a lazy image, still no video", () => {
    const { container } = render(<InstagramTileMedia post={{ type: "VIDEO", mediaUrl: REEL, thumbnailUrl: THUMB }} />);
    expect(container.querySelector("video")).toBeNull();
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(THUMB);
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("a video file is never put in an <img>, whatever the post type says (review finding)", () => {
    for (const post of [
      { type: "CAROUSEL_ALBUM", mediaUrl: REEL },
      { type: "IMAGE", mediaUrl: "https://nickstire.org/generated/reels/reel-1.MOV?v=2" },
      { type: "IMAGE", mediaUrl: THUMB, mediaProductType: "REELS" },
    ]) {
      const { container } = render(<InstagramTileMedia post={post} />);
      expect(container.querySelector("video")).toBeNull();
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("[data-testid='instagram-tile-play']")).not.toBeNull();
    }
  });

  it("Home renders the strip only through the facade: its source holds no <video> and uses InstagramTileMedia", () => {
    const home = readFileSync(join(__dirname, "..", "pages", "Home.tsx"), "utf8");
    expect(home).not.toMatch(/<video\b/);
    expect(home).toMatch(/<InstagramTileMedia post=\{post\} \/>/);
  });

  it("a video tile carries a play badge; an image post does not, and keeps its own media", () => {
    const video = render(<InstagramTileMedia post={{ type: "VIDEO", mediaUrl: REEL }} />);
    expect(video.container.querySelector("[data-testid='instagram-tile-play']")).not.toBeNull();
    const image = render(<InstagramTileMedia post={{ type: "IMAGE", mediaUrl: THUMB }} />);
    expect(image.container.querySelector("[data-testid='instagram-tile-play']")).toBeNull();
    expect(image.container.querySelector("img")?.getAttribute("src")).toBe(THUMB);
  });
});
