/**
 * The statenour runtime image forces Pillow 13.0.0 over moviepy's pin (2026-10-22).
 *
 * moviepy 2.2.1, the latest release, declares pillow<12, so pip resolves Pillow 11.3.0, which
 * carries 3 CRITICAL CVEs fixed only in 13.0.0 (container-scan "os layer" went red on #3223).
 * Nour chose forcing the new Pillow over accepting the CVEs. MoneyPrinter's 27 video tests and
 * a full subtitle render passed on 13.0.0 with moviepy 2.2.1 (PR body). The override must run
 * AFTER the moviepy install, or pip's resolver puts 11.x back.
 *
 * Removal condition: when moviepy is bumped, check whether the new release allows pillow>=13;
 * if it does, delete the override and this test. The moviepy pin is asserted so that a bump
 * fails here and forces that check instead of silently keeping a stale override.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DOCKERFILE = resolve(dirname(fileURLToPath(import.meta.url)), "../../Dockerfile");

/** The runtime stage's ACTIVE lines: Dockerfile comment lines dropped, so a commented-out command never counts. */
function runtimeStage(text: string): string {
  const i = text.search(/^FROM .* AS runtime$/m);
  return i < 0 ? "" : text.slice(i).split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
}

/** True when an active `pip install ... pillow==13.0.0` runs after the moviepy install. */
function overrideAfterMoviepy(runtime: string): boolean {
  const moviepyAt = runtime.indexOf("moviepy==");
  const pillowAt = runtime.search(/pip install[^\n]*pillow==13\.0\.0/);
  return moviepyAt >= 0 && pillowAt > moviepyAt;
}

describe("statenour runtime image Pillow override", () => {
  const runtime = runtimeStage(readFileSync(DOCKERFILE, "utf8"));

  it("the instrument finds the runtime stage and its moviepy install", () => {
    expect(runtime).toMatch(/^FROM .* AS runtime/);
    expect(runtime).toMatch(/moviepy==/);
  });

  it("moviepy is still 2.2.1 (a bump must re-check whether the override is still needed)", () => {
    expect(runtime).toMatch(/moviepy==2\.2\.1\b/);
  });

  it("Pillow 13.0.0 is installed after moviepy, so the resolver cannot put 11.x back", () => {
    expect(overrideAfterMoviepy(runtime)).toBe(true);
  });

  it("the check fails on a commented-out override and on one placed before moviepy (PR #3224 review)", () => {
    const stage = (body: string) => runtimeStage(`FROM node:24-alpine3.23 AS runtime\n${body}`);
    const active = "RUN pip install moviepy==2.2.1 \\\n && pip install pillow==13.0.0";
    const commented = "RUN pip install moviepy==2.2.1\n# RUN pip install pillow==13.0.0";
    const before = "RUN pip install pillow==13.0.0\nRUN pip install moviepy==2.2.1";
    expect(overrideAfterMoviepy(stage(active))).toBe(true);
    expect(overrideAfterMoviepy(stage(commented))).toBe(false);
    expect(overrideAfterMoviepy(stage(before))).toBe(false);
  });
});
