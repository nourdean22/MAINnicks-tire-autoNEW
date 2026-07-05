/**
 * Shared admin types, constants, and small utility components.
 *
 * Re-export barrel. The definitions live in focused files under ./shared/*.
 * This module preserves the historical `./shared` import path so every
 * admin section keeps importing from one place. Add new shared primitives
 * to the appropriate ./shared/* file and re-export them here.
 */

// ─── TYPES ──────────────────────────────────────────────
export type { AdminSection, BookingStatus, LeadStatus, NavGroup } from "./shared/types";

// ─── CONSTANTS ──────────────────────────────────────────
export {
  BOOKING_STATUS_CONFIG,
  LEAD_STATUS_CONFIG,
  TIME_LABELS,
  CHART_COLORS,
  CHART_THEME,
  SECTION_TITLES,
} from "./shared/constants";

// ─── NAV ────────────────────────────────────────────────
export { NAV_GROUPS, NAV_ITEMS } from "./shared/nav";

// ─── DATE FORMATTING ────────────────────────────────────
export { formatDate, formatDateTime, formatRelativeDate } from "./shared/format";

// ─── CROSS-SECTION NAVIGATION ───────────────────────────
export { navigateToAdminSection, openCustomerDrawer } from "./shared/navigation";
export type { AdminNavigateDetail, AdminOpenCustomerDrawerDetail } from "./shared/navigation";

// ─── HOOKS ──────────────────────────────────────────────
export { useUrlFilter } from "./shared/hooks";

// ─── LAYOUT PRIMITIVES ──────────────────────────────────
export { PageHeader, Panel, Section, MetricGrid, Toolbar } from "./shared/layout";

// ─── STATE INDICATORS ───────────────────────────────────
export { LoadingState, EmptyState, ErrorState } from "./shared/states";

// ─── ROW + SECONDARY-NAV PRIMITIVES ─────────────────────
export {
  ClickableRow,
  RowAction,
  FilterChips,
  TabBar,
  SearchInput,
  Breadcrumbs,
} from "./shared/table";

// ─── METRIC / CARD PRIMITIVES ───────────────────────────
export {
  StatCard,
  KpiTile,
  UrgencyBadge,
  StatusDot,
  ActivityIcon,
  TimestampLabel,
} from "./shared/cards";

// ─── INSIGHT STRIPS ─────────────────────────────────────
export { SectionInsightStrip, InsightStrip } from "./shared/insight";
