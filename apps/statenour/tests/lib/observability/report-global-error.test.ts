/**
 * tests/lib/observability/report-global-error.test.ts · 2026-09-02
 *
 * `app/global-error.tsx` is the App Router's last resort: it replaces the root
 * layout when rendering fails above every nested error.tsx, and Sentry's
 * Next.js integration documents it as the only capture point for that class of
 * error. The app shipped without one, so a root render crash reached nobody.
 *
 * The boundary itself is a client component whose effect does not run under
 * the node-environment SSR render this suite uses, so the reporting call lives
 * in a helper and is pinned here; a source check keeps the boundary wired to it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const captureException = vi.hoisted(() => vi.fn().mockReturnValue("event-1"));
vi.mock("@sentry/nextjs", () => ({ captureException }));

import { reportGlobalError } from "@/lib/observability/report-global-error";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

beforeEach(() => captureException.mockClear());

describe("reportGlobalError", () => {
  it("captures the exception and tags which boundary caught it", () => {
    const err = new Error("root render exploded");
    expect(reportGlobalError(err)).toBe("event-1");
    expect(captureException).toHaveBeenCalledWith(err, expect.objectContaining({ tags: { boundary: "global-error" } }));
  });

  it("carries Next's error digest when there is one, and omits it when there is not", () => {
    const withDigest = Object.assign(new Error("boom"), { digest: "d-123" });
    reportGlobalError(withDigest);
    expect(captureException).toHaveBeenCalledWith(withDigest, expect.objectContaining({ extra: { digest: "d-123" } }));

    captureException.mockClear();
    reportGlobalError(new Error("no digest"));
    expect(captureException.mock.calls[0][1]).not.toHaveProperty("extra");
  });
});

describe("the root boundary is wired to the helper", () => {
  const source = readFileSync(join(APP_ROOT, "app", "global-error.tsx"), "utf8");

  it("exists, is a client component, and renders its own html/body (no root layout above it)", () => {
    expect(source).toMatch(/^"use client";/);
    expect(source).toMatch(/<html/);
    expect(source).toMatch(/<body/);
  });

  it("calls reportGlobalError from an effect", () => {
    expect(source).toMatch(/useEffect\(/);
    expect(source).toMatch(/reportGlobalError\(error\)/);
  });

  it("offers the reader a way out rather than a dead end", () => {
    expect(source).toMatch(/reset\(\)/);
  });
});
