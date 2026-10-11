/**
 * tests/lib/observability/report-page-error.test.ts
 *
 * app/(mastery)/error.tsx is the inner Next boundary: it catches every page render error under (mastery) before the
 * layout's <ErrorBoundary> sees it. It used to only console.error, so those errors reached neither /api/errors nor
 * Sentry. The effect does not run under the node SSR render, so the call lives in a helper pinned here, plus a source
 * check that keeps the boundary wired to it (same shape as report-global-error.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const captureException = vi.hoisted(() => vi.fn().mockReturnValue("event-1"));
const mutate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@sentry/nextjs", () => ({ captureException }));
vi.mock("@/lib/trpc/vanilla-client", () => ({ trpcVanilla: { system: { recordClientError: { mutate } } } }));

import { reportPageError } from "@/lib/observability/report-page-error";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

beforeEach(() => {
  captureException.mockClear();
  mutate.mockClear();
  vi.stubGlobal("window", { location: { href: "https://bdnick.info/journal" } });
  vi.stubGlobal("navigator", { userAgent: "vitest" });
});
afterEach(() => vi.unstubAllGlobals());

describe("reportPageError", () => {
  it("posts the page error to recordClientError as a boundary trip named mastery.error", () => {
    const err = new Error("journal page exploded");
    reportPageError(err);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "boundary",
        errorBoundary: "mastery.error",
        message: "journal page exploded",
        url: "https://bdnick.info/journal",
      }),
    );
  });

  it("captures the exception in Sentry, tagged with the boundary and carrying the digest", () => {
    const err = Object.assign(new Error("missions page exploded"), { digest: "d-9" });
    reportPageError(err);
    expect(captureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ tags: { boundary: "mastery.error" }, extra: { digest: "d-9" } }),
    );
  });
});

describe("the (mastery) boundary is wired to the helper", () => {
  const source = readFileSync(join(APP_ROOT, "app", "(mastery)", "error.tsx"), "utf8");

  it("calls reportPageError(error) from an effect", () => {
    expect(source).toMatch(/useEffect\(\(\) => \{[\s\S]*?reportPageError\(error\)[\s\S]*?\}, \[error\]\)/);
  });
});
