/**
 * Client-side Core Web Vitals collector.
 *
 * Uses native PerformanceObserver API — no web-vitals package dependency.
 * Measures LCP, CLS, INP, FCP, TTFB and POSTs each sample to /api/cwv
 * via sendBeacon when the tab hides (guaranteed delivery even on close).
 *
 * Zero impact on FCP — observer setup happens after first paint.
 * Fails silently on older browsers.
 */

const sessionId = (() => {
  try {
    const existing = sessionStorage.getItem("cwv-sid");
    if (existing) return existing;
    const fresh = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem("cwv-sid", fresh);
    return fresh;
  } catch {
    return `s-${Date.now().toString(36)}`;
  }
})();

type Metric = "LCP" | "CLS" | "INP" | "FCP" | "TTFB";

interface Sample {
  metric: Metric;
  value: number;
  route: string;
  navType: string;
  sessionId: string;
  timestamp: number;
}

const pendingSamples: Sample[] = [];

function getNavType(): string {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return nav?.type ?? "navigate";
  } catch {
    return "navigate";
  }
}

function queueSample(metric: Metric, value: number): void {
  pendingSamples.push({
    metric,
    value,
    route: window.location.pathname,
    navType: getNavType(),
    sessionId,
    timestamp: Date.now(),
  });
}

function flushSamples(): void {
  if (pendingSamples.length === 0) return;
  const payload = JSON.stringify({ samples: pendingSamples.splice(0) });
  try {
    // sendBeacon is the right tool — delivers even if the tab is closing
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/cwv", new Blob([payload], { type: "application/json" }));
    } else {
      fetch("/api/cwv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => { /* silent */ });
    }
  } catch { /* silent — this is telemetry, not critical */ }
}

export function initCwvCollector(): void {
  // Only run in browser, only once per page
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;
  if ((window as unknown as { __cwvInit?: boolean }).__cwvInit) return;
  (window as unknown as { __cwvInit?: boolean }).__cwvInit = true;

  // ─── LCP ───────────────────────────────────────
  try {
    let lastLcp = 0;
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1] as PerformanceEntry & { renderTime?: number; loadTime?: number };
      const lcp = last.renderTime || last.loadTime || last.startTime;
      if (lcp && lcp > lastLcp) {
        lastLcp = lcp;
      }
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
    // Report final LCP when tab hides or page unloads
    const reportLcp = () => {
      if (lastLcp > 0) {
        queueSample("LCP", lastLcp);
        lastLcp = 0; // prevent double-report
      }
    };
    addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") reportLcp();
    });
    addEventListener("pagehide", reportLcp);
  } catch { /* silent */ }

  // ─── CLS ───────────────────────────────────────
  try {
    let clsValue = 0;
    let clsEntries: PerformanceEntry[] = [];

    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { hadRecentInput?: boolean; value?: number }>) {
        if (entry.hadRecentInput) continue;
        clsValue += entry.value || 0;
        clsEntries.push(entry);
      }
    });
    clsObserver.observe({ type: "layout-shift", buffered: true });
    const reportCls = () => {
      if (clsEntries.length > 0) {
        queueSample("CLS", Math.round(clsValue * 1000) / 1000);
        clsValue = 0;
        clsEntries = [];
      }
    };
    addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") reportCls();
    });
    addEventListener("pagehide", reportCls);
  } catch { /* silent */ }

  // ─── INP ───────────────────────────────────────
  try {
    const inpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { duration?: number }>) {
        // Any interaction > 40ms is worth reporting; server percentiles over it
        if (entry.duration && entry.duration > 40) {
          queueSample("INP", Math.round(entry.duration));
        }
      }
    });
    inpObserver.observe({ type: "event", buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
  } catch { /* silent — older browsers don't support "event" entryType */ }

  // ─── FCP ───────────────────────────────────────
  try {
    const fcpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "first-contentful-paint") {
          queueSample("FCP", Math.round(entry.startTime));
          fcpObserver.disconnect();
        }
      }
    });
    fcpObserver.observe({ type: "paint", buffered: true });
  } catch { /* silent */ }

  // ─── TTFB ──────────────────────────────────────
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav && nav.responseStart > 0) {
      queueSample("TTFB", Math.round(nav.responseStart - nav.requestStart));
    }
  } catch { /* silent */ }

  // Flush on hide / unload
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSamples();
  });
  addEventListener("pagehide", flushSamples);

  // Also flush opportunistically every 30s in case the user stays on one page
  setInterval(flushSamples, 30_000);
}
