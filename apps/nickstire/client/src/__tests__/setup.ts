import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// RTL auto-cleanup never registers here (it requires vitest `globals: true`),
// and in singleFork serial mode the jsdom document persists across client
// test files — unmount after every test so renders can't leak across files.
afterEach(() => {
  cleanup();
});

// Settle every dynamic import a file left in flight before the file ends.
// Between files vitest resets the module cache and the mock registry; an
// unawaited `import("./x")` still loading then evaluates x (and whatever it
// imports, such as server/db.ts with the real mysql2 driver) into the NEXT
// file's cache before that file's vi.mock calls register. Witnessed
// 2026-09-23: callbackAuditReceipt's fire-and-forget nickMemory import made
// coupon-redemptions fail with ENOTFOUND in some orders. Waiting here, while the
// file's own mocks are still active, closes that for every file at once.
afterAll(async () => {
  await vi.dynamicImportSettled();
});

// Polyfill IntersectionObserver for jsdom (used by framer-motion, lazy loading, etc.)
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class IntersectionObserver {
    readonly root: Element | null = null;
    readonly rootMargin: string = "0px";
    readonly thresholds: ReadonlyArray<number> = [0];
    constructor(_cb: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] { return []; }
  } as any;
}

// Polyfill ResizeObserver for jsdom
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    constructor(_cb: ResizeObserverCallback) {}
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}

// Stub scrollTo for jsdom
if (typeof window !== "undefined") {
  window.scrollTo = () => {};
}

// Stub scrollIntoView for jsdom (PageLayout's hash-scroll effect calls it)
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Polyfill matchMedia for jsdom (used by ScrollProgressBar, theme detection,
// responsive components). Returns a default-false MediaQueryList shaped object
// so component code that calls .matches / .addEventListener doesn't throw.
if (typeof window !== "undefined" && typeof window.matchMedia === "undefined") {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},      // legacy
    removeListener: () => {},   // legacy
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}
