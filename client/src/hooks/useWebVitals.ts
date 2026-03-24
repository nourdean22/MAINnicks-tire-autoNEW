/**
 * useWebVitals — Tracks Core Web Vitals (LCP, CLS, TTFB, INP).
 * Logs metrics to console in development, can be extended to send
 * to an analytics endpoint in production.
 */
import { useEffect } from "react";

interface WebVitalMetric {
  name: string;
  value: number;
  rating: "good" | "needs-improvement" | "poor";
}

function getRating(name: string, value: number): WebVitalMetric["rating"] {
  const thresholds: Record<string, [number, number]> = {
    LCP: [2500, 4000],
    CLS: [0.1, 0.25],
    TTFB: [800, 1800],
    INP: [200, 500],
  };

  const [good, poor] = thresholds[name] ?? [Infinity, Infinity];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

export function useWebVitals(onMetric?: (metric: WebVitalMetric) => void) {
  useEffect(() => {
    const report = (name: string, value: number) => {
      const metric: WebVitalMetric = { name, value, rating: getRating(name, value) };
      if (onMetric) {
        onMetric(metric);
      } else if (import.meta.env.DEV) {
        const color = metric.rating === "good" ? "green" : metric.rating === "needs-improvement" ? "orange" : "red";
        console.log(`%c[Web Vital] ${name}: ${value.toFixed(1)}ms (${metric.rating})`, `color: ${color}`);
      }
    };

    // Largest Contentful Paint
    try {
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) report("LCP", last.startTime);
      });
      lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
    } catch { /* unsupported */ }

    // Cumulative Layout Shift
    try {
      let clsValue = 0;
      const clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!(entry as any).hadRecentInput) {
            clsValue += (entry as any).value;
          }
        }
        report("CLS", clsValue);
      });
      clsObserver.observe({ type: "layout-shift", buffered: true });
    } catch { /* unsupported */ }

    // Time to First Byte
    try {
      const navEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      if (navEntry) {
        report("TTFB", navEntry.responseStart - navEntry.requestStart);
      }
    } catch { /* unsupported */ }

    // Interaction to Next Paint
    try {
      const inpObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          report("INP", entry.duration);
        }
      });
      inpObserver.observe({ type: "event", buffered: true });
    } catch { /* unsupported */ }
  }, [onMetric]);
}
