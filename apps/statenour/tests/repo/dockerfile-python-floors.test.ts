/**
 * The runtime image's Python packages stay at or above their security fixes (2026-10-22).
 *
 * The image pip-installs MoneyPrinter's Python deps from the pins in the Dockerfile, not from
 * lib/ai/moneyprinter/uv.lock, so Dependabot never sees what actually ships. OSV on what the pin
 * list resolved to found yt-dlp 2025.1.15 (5 high, used live by the last30days transcript lane) and
 * python-multipart 0.0.27 (high). Pillow has its own guard: dockerfile-pillow-override.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DOCKERFILE = resolve(dirname(fileURLToPath(import.meta.url)), "../../Dockerfile");

/** Every `name==version` / `name>=version` token in the runtime stage, comment lines dropped. */
function pipPins(text: string): Map<string, string> {
  const runtime = text
    .slice(Math.max(0, text.search(/^FROM .* AS runtime$/m)))
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  const pins = new Map<string, string>();
  for (const m of runtime.matchAll(/"?([A-Za-z0-9_.-]+)(?:==|>=)([0-9][0-9A-Za-z.]*)"?/g)) {
    pins.set(m[1].toLowerCase(), m[2]);
  }
  return pins;
}

function atLeast(version: string, floor: string): boolean {
  const a = version.split(".").map(Number);
  const b = floor.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

const FLOORS: Record<string, string> = {
  certifi: "2026.10.19",
  anyio: "4.14.2",
  "yt-dlp": "2026.7.4",
  "python-multipart": "0.0.31",
};

describe("statenour Dockerfile Python security floors", () => {
  const pins = pipPins(readFileSync(DOCKERFILE, "utf8"));

  it("the instrument reads runtime pip pins and skips the build stage and comments", () => {
    expect(pins.get("moviepy")).toBe("2.2.1");
    const sample = 'FROM x AS build\nRUN pip install a==9\nFROM y AS runtime\n# old: b==0.1\nRUN pip install "b>=1.2" c==3.4.5';
    expect([...pipPins(sample)]).toEqual([["b", "1.2"], ["c", "3.4.5"]]);
  });

  it.each(Object.entries(FLOORS))("%s is pinned at or above %s", (name, floor) => {
    const v = pins.get(name);
    expect(v, `${name} is not pinned in the runtime stage`).toBeDefined();
    expect(atLeast(v!, floor), `${name} ${v} is below ${floor}`).toBe(true);
  });

  it("the comparison rejects a version below the floor", () => {
    expect(atLeast("2025.1.15", "2026.7.4")).toBe(false);
    expect(atLeast("0.0.27", "0.0.31")).toBe(false);
    expect(atLeast("2026.2.25", "2026.10.19")).toBe(false);
    expect(atLeast("4.14.2", "4.14.2")).toBe(true);
  });
});
