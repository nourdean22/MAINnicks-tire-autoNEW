import type { NavItem } from "@/components/layout/nav-items";

/**
 * Resolve the NavItem matching the current pathname so the floating orb
 * can reflect WHERE the operator is on every surface (not just the 4
 * mobile tabs). Mirrors the orb's existing active-match rule:
 *   - "/" matches only an exact "/" (every path starts with "/").
 *   - external items (Admin -> nickstire.org) never match in-app.
 *   - otherwise exact match OR a sub-path (base + "/").
 * Query/hash suffixes on nav hrefs are ignored. Most specific (longest
 * base path) wins. Returns null when nothing matches.
 */
export function resolveActiveNav(
  pathname: string,
  items: NavItem[],
): NavItem | null {
  let best: NavItem | null = null;
  let bestLen = -1;
  for (const item of items) {
    if (item.external) continue;
    const base = item.href.split("?")[0].split("#")[0];
    const matches =
      base === "/"
        ? pathname === "/"
        : pathname === base || pathname.startsWith(base + "/");
    if (matches && base.length > bestLen) {
      best = item;
      bestLen = base.length;
    }
  }
  return best;
}
