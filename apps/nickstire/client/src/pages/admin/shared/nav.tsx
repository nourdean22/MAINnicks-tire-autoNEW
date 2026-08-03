/**
 * Shared admin navigation config.
 *
 * There is no nav structure in this file any more, and that is the point.
 *
 * WHAT WAS HERE (until 2026-08-03): a hand-written `NAV_GROUPS` containing a
 * single group with `label: ""` — a flat list built by mapping every
 * `showInSidebar` section. The registry had carried a `group` field the whole
 * time and this file discarded it, so the admin shipped grouping metadata that
 * nothing rendered. Because nothing rendered it, nothing contradicted it, and
 * it rotted: `intelligence` sat under "Outreach", `customers` under "Revenue",
 * `voiceReceptionist` under "Money", and "Revenue" and "Money" existed as two
 * names for one concept.
 *
 * The header comment was equally stale — it described "9 clean operational
 * sections" and listed them, while the registry carried 14 visible sections
 * and 2 hidden ones. A future reader trusting that comment would have deleted
 * five live sections believing they were strays.
 *
 * Sidebar shape now comes from ONE place: `getSidebarGroups(role)` in
 * `../registry`, which orders groups by `ADMIN_NAV_GROUPS` and sections by
 * `priority`, and filters by `allowedRoles`. `adminRegistryTruth.test.ts`
 * fails if a section is routable but unreachable, or reachable but ungrouped.
 *
 * `NAV_ITEMS` was also removed here: it was exported through the shared barrel
 * and had no consumer anywhere in the app.
 */
export { getSidebarGroups, sectionsForRole, ADMIN_NAV_GROUPS, type AdminNavGroup } from "../registry";
