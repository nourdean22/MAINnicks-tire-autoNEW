/**
 * statenour-web's `next build` gets a 4 GB heap (2026-10-22).
 *
 * Railway builds 3d2dd55b and 78284042 died in `next build`'s "Running TypeScript" step:
 * "Mark-Compact ... 2040 MB ... JavaScript heap out of memory", Node's default old space.
 * CI typechecks the same code green; the app outgrew the default heap after ~25 merges
 * since the last good build (d43575b, 2026-10-20). Precedent: MAINnicks-tire-auto builds
 * with --max-old-space-size=4096. A Railway service variable cannot fix it, because a
 * Dockerfile build only sees ARGs, so the flag lives on the build command itself. The
 * runtime stage keeps Node's default, so the running server's memory is unchanged.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DOCKERFILE = resolve(dirname(fileURLToPath(import.meta.url)), "../../Dockerfile");

/** [build stage text, runtime stage text], split at the runtime FROM line. */
function stages(text: string): [string, string] {
  const i = text.search(/^FROM .* AS runtime$/m);
  return i < 0 ? [text, ""] : [text.slice(0, i), text.slice(i)];
}

describe("statenour Dockerfile heap for next build", () => {
  const [build, runtime] = stages(readFileSync(DOCKERFILE, "utf8"));

  it("the instrument finds both stages", () => {
    expect(build).toMatch(/RUN .*pnpm run build/);
    expect(runtime).toMatch(/^FROM .* AS runtime/);
  });

  it("the app build runs with a 4 GB old space", () => {
    expect(build).toMatch(/^RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm run build$/m);
  });

  it("the runtime stage leaves the server on Node's default heap", () => {
    expect(runtime).not.toMatch(/max-old-space-size/);
  });
});
