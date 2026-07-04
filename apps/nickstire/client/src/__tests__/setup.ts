import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// RTL auto-cleanup never registers here (it requires vitest `globals: true`),
// and in singleFork serial mode the jsdom document persists across client
// test files — unmount after every test so renders can't leak across files.
afterEach(() => {
  cleanup();
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
