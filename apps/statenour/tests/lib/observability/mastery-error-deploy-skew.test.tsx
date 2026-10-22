// @vitest-environment jsdom
/**
 * app/(mastery)/error.tsx · deploy skew (bug hunt 2026-10-22).
 *
 * Chat, brain, missions, journal and every other page under (mastery) render
 * inside this boundary, so a chunk that 404s after a deploy lands HERE, not in
 * global-error.tsx. It used to only report: "Something broke", and Try again
 * re-requested the same dead chunk. It now reloads once, like the root
 * boundary, and a repeat inside the window is reported instead of looping.
 *
 * Real effect in jsdom, real reloadOnceForDeploySkew, real sessionStorage;
 * only the reload itself and the reporter are spies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ reload: vi.fn(), reportPageError: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/observability/report-page-error", () => ({ reportPageError: h.reportPageError }));
vi.mock("@/lib/observability/deploy-skew", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/observability/deploy-skew")>();
  return {
    ...actual,
    // Keep the real decision; swap only the navigation jsdom cannot perform.
    reloadOnceForDeploySkew: (error: unknown, storage: Parameters<typeof actual.reloadOnceForDeploySkew>[1]) =>
      actual.reloadOnceForDeploySkew(error, storage, h.reload),
  };
});

import MasteryError from "@/app/(mastery)/error";

let container: HTMLDivElement;
let root: Root;

function mount(error: Error) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<MasteryError error={error} reset={() => {}} />));
}

beforeEach(() => {
  window.sessionStorage.clear();
  h.reload.mockClear();
  h.reportPageError.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const chunk = () => Object.assign(new Error("Loading chunk 123 failed."), { name: "ChunkLoadError" });

describe("(mastery) error boundary · deploy skew", () => {
  it("a stale chunk reloads the page once and is not reported", () => {
    mount(chunk());
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.reportPageError).not.toHaveBeenCalled();
  });

  it("the same error right after the reload does not loop: it is reported", () => {
    mount(chunk());
    act(() => root.unmount());
    container.remove();
    mount(chunk()); // the reloaded page fails again; sessionStorage remembers the first reload
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.reportPageError).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: an ordinary page error is reported and never reloads", () => {
    mount(new Error("journal page exploded"));
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.reportPageError).toHaveBeenCalledTimes(1);
  });
});
