/** U3 (2026-10-31) · which links in a chat message are videos that may play in place. */
import { describe, it, expect } from "vitest";
import { embedUrl, findVideoLinks, parseVideoLink, MAX_VIDEO_LINKS } from "@/lib/chat/video-link";

describe("parseVideoLink", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=42", "youtube", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://vimeo.com/76979871", "vimeo", "76979871"],
    ["https://player.vimeo.com/video/76979871", "vimeo", "76979871"],
  ])("%s plays in place", (url, kind, id) => {
    expect(parseVideoLink(url)).toMatchObject({ kind, id });
  });

  it.each([
    ["https://www.instagram.com/reel/Cabc123/", "instagram"],
    ["https://www.tiktok.com/@shop/video/7299999999999999999", "tiktok"],
  ])("%s gets a link card", (url, kind) => {
    expect(parseVideoLink(url)).toMatchObject({ kind });
  });

  it.each([
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://youtu.be/not-eleven",
    "https://vimeo.com/channels/staffpicks",
    "https://www.instagram.com/someaccount/",
    "javascript:alert(1)",
    "https://example.com/watch?v=dQw4w9WgXcQ",
  ])("CONTROL: %s is not a video", (url) => {
    expect(parseVideoLink(url)).toBeNull();
  });
});

describe("findVideoLinks", () => {
  it("finds links in prose, trims punctuation, de-duplicates and caps the count", () => {
    const text = `watch https://youtu.be/dQw4w9WgXcQ. also https://www.youtube.com/watch?v=dQw4w9WgXcQ and https://vimeo.com/76979871,
      https://www.youtube.com/watch?v=aaaaaaaaaaa https://www.youtube.com/watch?v=bbbbbbbbbbb`;
    const links = findVideoLinks(text);
    expect(links).toHaveLength(MAX_VIDEO_LINKS);
    expect(links.map((l) => ("id" in l ? l.id : l.url))).toEqual(["dQw4w9WgXcQ", "76979871", "aaaaaaaaaaa"]);
  });

  it("the player URLs are the privacy-enhanced hosts", () => {
    expect(embedUrl({ kind: "youtube", id: "dQw4w9WgXcQ", url: "" })).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0");
    expect(embedUrl({ kind: "vimeo", id: "76979871", url: "" })).toBe("https://player.vimeo.com/video/76979871?autoplay=1&dnt=1");
  });
});
