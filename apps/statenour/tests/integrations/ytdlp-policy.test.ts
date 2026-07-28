import { describe, it, expect } from "vitest";
import { validateVideoUrl, vttToPlainText } from "@/lib/integrations/ytdlp";

describe("validateVideoUrl — the ingestion allowlist", () => {
  it("accepts canonical YouTube hosts over https", () => {
    expect(validateVideoUrl("https://www.youtube.com/watch?v=abc123").ok).toBe(true);
    expect(validateVideoUrl("https://youtu.be/abc123").ok).toBe(true);
    expect(validateVideoUrl("https://m.youtube.com/watch?v=abc123").ok).toBe(true);
  });

  it("refuses http, foreign hosts, lookalikes and embedded credentials", () => {
    expect(validateVideoUrl("http://www.youtube.com/watch?v=a").ok).toBe(false);
    expect(validateVideoUrl("https://vimeo.com/12345").ok).toBe(false);
    expect(validateVideoUrl("https://youtube.com.evil.tld/watch?v=a").ok).toBe(false);
    expect(validateVideoUrl("https://user:pass@youtube.com/watch?v=a").ok).toBe(false);
    expect(validateVideoUrl("not a url").ok).toBe(false);
  });
});

describe("vttToPlainText — caption normalization", () => {
  it("drops headers, timings, indexes and inline tags; dedupes rolling repeats", () => {
    const vtt = [
      "WEBVTT",
      "Kind: captions",
      "Language: en",
      "",
      "1",
      "00:00:00.000 --> 00:00:02.000",
      "hello <c>world</c>",
      "",
      "2",
      "00:00:02.000 --> 00:00:04.000",
      "hello world",
      "",
      "00:00:04.000 --> 00:00:06.000 align:start position:0%",
      "the second line",
    ].join("\n");
    expect(vttToPlainText(vtt)).toBe("hello world the second line");
  });

  it("returns empty string for an empty/header-only track", () => {
    expect(vttToPlainText("WEBVTT\n\n")).toBe("");
  });
});
