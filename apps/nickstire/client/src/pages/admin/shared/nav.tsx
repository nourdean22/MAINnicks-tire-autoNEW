/**
 * Shared admin navigation config.
 */
import type { NavGroup } from "./types";

/**
 * NAV STRUCTURE — Restructured 9-Section Organization Pass (2026-06-12)
 *
 * Reorganizes the admin panel into 9 clean operational sections:
 *   1. Today (overview)
 *   2. Customers (customers)
 *   3. Sales Pipeline (leads)
 *   4. Tires (tireOrders)
 *   5. Marketing / Growth (growth)
 *   6. Winback (campaigns)
 *   7. Nonstop Nick (memberships)
 *   8. Reports (opsHub)
 *   9. Settings / Safety (settings)
 */
import { ADMIN_REGISTRY } from "../registry";

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "", // Flat list
    items: ADMIN_REGISTRY.filter(s => s.showInSidebar).map(s => ({
      id: s.id,
      label: s.label,
      icon: s.icon,
      badge: s.badgeKey,
    })),
  },
];

// Flat list for backward compatibility
export const NAV_ITEMS = NAV_GROUPS.flatMap(g => g.items);
