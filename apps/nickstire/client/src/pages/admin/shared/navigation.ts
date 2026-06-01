/**
 * Shared admin cross-section navigation helpers (event-bus based).
 */
import type { AdminSection } from "./types";

// ─── SMALL UTILITY COMPONENTS ───────────────────────────
/**
 * Section-navigation helper — fires the same `admin:navigate-section` event
 * that Admin.tsx listens for (see line 220-233). Optionally also writes
 * `settingsTab` to the URL so SettingsSection lands on the right inner tab.
 *
 * Why an event + URL write instead of a wouter <Link>: Admin.tsx is a
 * single-page component; clicking a Link to /admin?tab=X doesn't actually
 * remount Admin or re-resolve the section state. The event bridge is the
 * existing mechanism the codebase uses for cross-section nav.
 */
export function navigateToAdminSection(section: AdminSection, opts?: { settingsTab?: string }) {
  if (typeof window === "undefined") return;
  if (opts?.settingsTab) {
    const url = new URL(window.location.href);
    url.searchParams.set("settingsTab", opts.settingsTab);
    window.history.replaceState({}, "", url.toString());
  }
  window.dispatchEvent(
    new CustomEvent("admin:navigate-section", { detail: { section } })
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
export function openCustomerDrawer(customerId: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("admin:open-customer-drawer", { detail: { customerId } }),
  );
}
