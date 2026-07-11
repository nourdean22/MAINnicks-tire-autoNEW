/**
 * Shared admin cross-section navigation helpers (event-bus based).
 */
import type { AdminSection } from "./types";

// ─── EVENT PAYLOAD CONTRACTS ─────────────────────────────
// 2026-07-04 maintainability audit: the `admin:navigate-section` and
// `admin:open-customer-drawer` CustomEvent payloads were retyped by hand
// as inline object literals at every listener (registry.tsx x2,
// CustomersSection.tsx) with nothing tying them to what's actually
// dispatched below — a rename here wouldn't be a type error anywhere,
// just a silent no-op at runtime. These are now the one source of truth;
// listeners import them instead of re-declaring the shape.
export interface AdminNavigateDetail {
  section: AdminSection;
  highlightId?: number;
}
export interface AdminOpenCustomerDrawerDetail {
  customerId: number;
}

// ─── SMALL UTILITY COMPONENTS ───────────────────────────
/**
 * Section-navigation helper — fires the same `admin:navigate-section` event
 * that Admin.tsx listens for (see line 220-233). Optionally also writes
 * `settingsTab` to the URL so SettingsSection lands on the right inner tab,
 * and/or carries a `highlightId` for the target section to scroll/flash the
 * relevant row (Priority Queue items, tire orders, etc.).
 *
 * Why an event + URL write instead of a wouter <Link>: Admin.tsx is a
 * single-page component; clicking a Link to /admin?tab=X doesn't actually
 * remount Admin or re-resolve the section state. The event bridge is the
 * existing mechanism the codebase uses for cross-section nav.
 *
 * `highlightId` support added 2026-07-04 — three call sites (Overview's
 * priority-queue jump, Revenue's legacy tire-orders redirect, Outreach's
 * settings jump) were hand-rolling raw `window.dispatchEvent(new
 * CustomEvent(...))` instead of this helper because the signature didn't
 * cover their needs. Extending the helper removed that duplication rather
 * than leaving a second, untyped way to fire the same event.
 */
export function navigateToAdminSection(
  section: AdminSection,
  opts?: { settingsTab?: string; highlightId?: number },
) {
  if (typeof window === "undefined") return;
  if (opts?.settingsTab) {
    const url = new URL(window.location.href);
    url.searchParams.set("settingsTab", opts.settingsTab);
    window.history.replaceState({}, "", url.toString());
  }
  const detail: AdminNavigateDetail = { section };
  if (opts?.highlightId !== undefined) detail.highlightId = opts.highlightId;
  window.dispatchEvent(
    new CustomEvent("admin:navigate-section", { detail })
  );
}

/**
 * wave-115 — open the customer drawer directly from any admin surface.
 * Fires `admin:open-customer-drawer` with the target customer id;
 * Admin.tsx listens and calls `setDrawerCustomerId(id)`. Use this from
 * cards that show a specific customer (at-risk whales, top spenders,
 * lapsed VIPs, NBA recommendations, etc.) so the operator drills in
 * without losing their place by navigating to the full Customers list.
 */
/**
 * 2026-07-11 · in-admin link navigation. For anchors whose href is an
 * /admin?tab=… deep-link: write the FULL href to the URL (so inner-tab
 * params like outreachTab/smsPhone are visible to the target section's
 * deep-link parser, and refresh/share keeps working), then fire the
 * section event. Use from an <a onClick> — keep the real href on the
 * anchor so middle-click/new-tab still deep-links via fresh load.
 * Returns false for modified clicks (caller should NOT preventDefault —
 * let the browser open the tab).
 */
export function navigateToAdminUrl(
  e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button?: number },
  href: string,
  section: AdminSection,
): boolean {
  if (typeof window === "undefined") return false;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (e.button !== undefined && e.button !== 0)) {
    return false; // modified/middle click — let the browser handle it
  }
  window.history.replaceState({}, "", href);
  window.dispatchEvent(
    new CustomEvent("admin:navigate-section", { detail: { section } satisfies AdminNavigateDetail })
  );
  return true;
}

export function openCustomerDrawer(customerId: number) {
  if (typeof window === "undefined") return;
  const detail: AdminOpenCustomerDrawerDetail = { customerId };
  window.dispatchEvent(
    new CustomEvent("admin:open-customer-drawer", { detail }),
  );
}
