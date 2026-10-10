/**
 * The CLI result parser must hand the pipeline a VIDEO, not the preview still
 * (2026-10-10). On seedance_2_5 the --json result carries a thumbnail
 * (`..._resize.jpg`) before the video; parseResultUrl took the first http URL it
 * met, five "clips" were saved as 1158x2048 JPEGs, assembly produced a 5-second
 * cut and the render-integrity gate refused it (job 2070005). The five paid
 * renders were lost. These pins make the parser choose by media kind.
 */
import { describe, expect, it } from "vitest";
import { parseResultUrl } from "./services/higgsfieldStudio";

const VIDEO = "https://cdn.example/u/8244882f-0869-46fc-affd-4059b031d7b4.mp4";
const STILL = "https://cdn.example/u/8244882f-0869-46fc-affd-4059b031d7b4_resize.jpg";

describe("parseResultUrl — the media kind the caller asked for", () => {
  it("video: skips a preview still that comes first and returns the mp4 (the seedance_2_5 shape)", () => {
    const stdout = JSON.stringify({ id: "job", status: "completed", thumbnail: STILL, results: [{ type: "video", url: VIDEO, preview: STILL }] });
    expect(parseResultUrl(stdout, "video")).toBe(VIDEO);
  });

  it("video: the seedance1_5 shape (one url) still works unchanged", () => {
    expect(parseResultUrl(JSON.stringify({ url: VIDEO }), "video")).toBe(VIDEO);
  });

  it("video: a result with only image URLs is REFUSED, never saved as a clip", () => {
    const stdout = JSON.stringify({ results: [{ type: "image", url: STILL }], thumbnail: STILL });
    expect(() => parseResultUrl(stdout, "video")).toThrow(/no video URL/i);
  });

  it("video: an extension-less URL under a video key is accepted when nothing better exists", () => {
    const signed = "https://cdn.example/u/abc?sig=1";
    expect(parseResultUrl(JSON.stringify({ video: { url: signed }, thumbnail: STILL }), "video")).toBe(signed);
  });

  it("image: returns the image and ignores a video sitting next to it", () => {
    expect(parseResultUrl(JSON.stringify({ results: [{ url: VIDEO }, { url: STILL }] }), "image")).toBe(STILL);
  });

  it("no URL at all is still an error", () => {
    expect(() => parseResultUrl(JSON.stringify({ status: "completed" }), "video")).toThrow(/No URL/);
  });
});
