import { useCallback } from "react";

const prefetched = new Set<string>();

/**
 * Returns an onMouseEnter handler that prefetches the JS chunk for a route.
 * Uses dynamic import to trigger Vite's code-split chunk loading on hover,
 * so by the time the user clicks, the bundle is already cached.
 */
export function usePrefetchRoute() {
  return useCallback((path: string) => {
    if (prefetched.has(path)) return;
    prefetched.add(path);

    // Map common routes to their lazy-loaded page modules
    const routeMap: Record<string, () => Promise<unknown>> = {
      "/contact": () => import("@/pages/Contact"),
      "/about": () => import("@/pages/About"),
      "/services": () => import("@/pages/ServicesOverview"),
      "/tires": () => import("@/pages/TireFinder"),
      "/reviews": () => import("@/pages/ReviewsPage"),
      "/specials": () => import("@/pages/SpecialsPage"),
      "/blog": () => import("@/pages/Blog"),
      "/faq": () => import("@/pages/FAQ"),
      "/diagnose": () => import("@/pages/DiagnosePage"),
      "/fleet": () => import("@/pages/Fleet"),
      "/financing": () => import("@/pages/Financing"),
    };

    const loader = routeMap[path];
    if (loader) {
      loader().catch(() => {
        // Silently fail — it's just a prefetch optimization
        prefetched.delete(path);
      });
    }
  }, []);
}
