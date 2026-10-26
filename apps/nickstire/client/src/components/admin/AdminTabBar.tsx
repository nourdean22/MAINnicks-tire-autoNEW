/**
 * AdminTabBar: the phone bottom bar (Admin UI v1 W1, apps/nickstire/docs/design/admin-ui-v1/PLAN.md).
 *
 * Four section slots and Search, inside the thumb arc. A tab bar navigates and never acts (HIG tab
 * bars), so Search only opens the command palette; the palette is where actions live. The slots are
 * Today, Lot, Approvals and Customers when the role may open them, topped up from the Daily sidebar
 * group in priority order, so a restricted role is not left with gaps. The hamburger drawer still
 * holds every section. Phones only (`lg:hidden`); .admin-content reserves its height in index.css.
 */
import { MessageSquare, Search } from "lucide-react";
import type { AdminRole } from "@shared/adminPermissions";
import { describeBadge, foldSignals, signalsForSection, type AdminSignal } from "@shared/adminSignal";
import { getSidebarGroups } from "@/pages/admin/registry";
import type { AdminSection } from "@/pages/admin/shared";

const PINNED: readonly AdminSection[] = ["overview", "lot", "approvals", "customers"];
const SLOT_COUNT = 4;

/** The bar's sections for a role: pinned ones it may open, then Daily fills, at most four. */
function barSections(role: AdminRole) {
  const daily = getSidebarGroups(role).find((g) => g.label === "Daily")?.items ?? [];
  const pinned = PINNED.flatMap((id) => daily.filter((item) => item.id === id));
  const fills = daily.filter((item) => !PINNED.includes(item.id));
  return [...pinned, ...fills].slice(0, SLOT_COUNT);
}

/**
 * The three-state badge shared by the sidebar and the bar: a count, "?" when the count could not be
 * read, nothing when nothing measures it. A pending Approvals count is the owner-priority gold.
 */
export function NavBadge({ section, signals, className = "" }: { section: AdminSection; signals: readonly AdminSignal[]; className?: string }) {
  const sectionSignals = signalsForSection(signals, section);
  const badge = foldSignals(sectionSignals);
  // Every number on screen names its source, so a badge can be traced without reading code.
  const title = describeBadge(badge, sectionSignals);
  const base = `shrink-0 text-[10px] font-semibold min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center ${className}`;
  if (badge.state === "unknown") {
    return <span data-badge className={`${base} bg-amber-500/15 text-amber-400`} title={title} aria-label="outstanding work unknown">?</span>;
  }
  if (badge.state === "counted" && badge.count > 0) {
    const tone = section === "approvals" ? "bg-[var(--owner-priority)] text-[#0B0C0E]" : "bg-destructive text-[#0B0C0E]";
    return <span data-badge className={`${base} tabular-nums ${tone}`} title={title}>{badge.count > 99 ? "99+" : badge.count}</span>;
  }
  return null;
}

export function AdminTabBar({ role, active, signals, onNavigate, onSearch, onAsk }: {
  role: AdminRole;
  active: AdminSection;
  signals: readonly AdminSignal[];
  onNavigate: (section: AdminSection) => void;
  onSearch: () => void;
  /** Opens the assistant sheet; the slot renders only for roles that may use it. */
  onAsk?: () => void;
}) {
  // z-30: under the drawer scrim (z-40) and drawer (z-50), so an open drawer covers the bar.
  const slot = "flex-1 min-w-0 min-h-12 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium leading-tight transition-colors duration-100";
  return (
    <nav
      aria-label="Primary sections"
      className="lg:hidden fixed bottom-0 inset-x-0 z-30 flex items-stretch border-t border-border bg-[var(--surface-raised)] px-1 h-[calc(56px+env(safe-area-inset-bottom,0px))] pb-[env(safe-area-inset-bottom,0px)]"
    >
      {barSections(role).map((item) => {
        const isActive = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            data-slot={item.id}
            onClick={() => onNavigate(item.id)}
            aria-current={isActive ? "page" : undefined}
            className={`${slot} ${isActive ? "text-foreground" : "text-muted-foreground"}`}
          >
            <span className="relative">
              <span className="block [&>svg]:w-5 [&>svg]:h-5" aria-hidden>{item.icon}</span>
              <NavBadge section={item.id} signals={signals} className="absolute -top-1.5 left-3" />
            </span>
            <span className="max-w-full truncate">{item.label}</span>
          </button>
        );
      })}
      {onAsk && (
        <button type="button" data-slot="ask" onClick={onAsk} className={`${slot} text-muted-foreground`}>
          <MessageSquare className="w-5 h-5" aria-hidden />
          <span>Ask</span>
        </button>
      )}
      <button type="button" data-slot="search" onClick={onSearch} className={`${slot} text-muted-foreground`}>
        <Search className="w-5 h-5" aria-hidden />
        <span>Search</span>
      </button>
    </nav>
  );
}
