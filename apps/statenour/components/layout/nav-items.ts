import { STATS_TABS } from "@/lib/stats/resolve-tab";
import {
  Brain,
  Home,
  MessageSquare,
  ListTodo,
  Settings,
  NotebookPen,
  Activity,
  Target,
  Users,
  Image as ImageIcon,
} from "lucide-react";

// ════════════════════════════════════════════════════════════════════
// SECTIONED NAV MODEL — the single source of truth for navigation.
// ════════════════════════════════════════════════════════════════════
// The bottom-tab bar (bottom-tab-bar.tsx), the MORE sheet (more-sheet.tsx),
// and the ⌘K command palette (command-palette.tsx) ALL read this one array,
// so the three nav surfaces can never drift. Before the 2026-06-18 IA reorg
// they were three independent hand-maintained copies (the flat NAV_ITEMS, a
// hardcoded cmdK list, and the FloatingHome orb) — all now consolidated here.
//
// Sections are the operator's OS-loop VERBS: capture → execute → reflect →
// operate. `bottomTab` items are the 4 always-visible daily content
// tabs (rendered in the bar; excluded from the MORE sheet by `bySection`).
// `/system` owns its own sub-surfaces via the System hub grid, so the
// system/* children are NOT listed here. Hidden routes (/decisions/[id],
// /auth/sign-in) and redirect stubs (/goals, /scoreboard)
// are intentionally absent. See docs/audits/IA-REORG-DESIGN.md §2 + §5.

export type NavSection = "capture" | "execute" | "reflect" | "operate";

export interface NavEntry {
  href: string;
  label: string;
  icon: typeof Brain;
  section: NavSection;
  /** One of the 4 always-visible bottom content tabs. */
  bottomTab?: boolean;
  /** Rendered as a flat one-tap MORE row (vs a hub that owns its own tabs). */
  flatRow?: boolean;
  /** External link — opens in a new tab. No current entries; renderers keep the branch. */
  external?: boolean;
  /** Footer placement in the MORE sheet (Settings). */
  footer?: boolean;
  /** Hub routes that own in-page tabs — lets ⌘K hint sub-surfaces. */
  tabs?: { key: string; label: string }[];
}

export const NAV: NavEntry[] = [
  // ── TIER 1 · bottom content tabs (the smart-now daily loop) ──
  { href: "/",         label: "Home",     icon: Home,          section: "capture", bottomTab: true },
  { href: "/chat",     label: "Chat",     icon: MessageSquare, section: "capture", bottomTab: true },
  { href: "/missions", label: "Missions", icon: ListTodo,      section: "execute", bottomTab: true },
  { href: "/journal",  label: "Journal",  icon: NotebookPen,   section: "reflect", bottomTab: true },
  { href: "/stats",    label: "Stats",    icon: Target,        section: "reflect", flatRow: true,
    tabs: STATS_TABS.map((tab) => ({ key: tab.id, label: tab.label })) },

  // ── CAPTURE ──
  { href: "/photo-improver", label: "Photo Improver", icon: ImageIcon,      section: "execute", flatRow: true },

  // ── EXECUTE ──

  // ── REFLECT ──
  // 2026-10-19 (wave 2V) · Brain is three tabs. Order and labels mirror
  // app/(mastery)/brain/page.tsx; pinned by tests/repo/brain-nav-tabs.test.ts
  // so the two cannot drift apart.
  { href: "/brain", label: "Brain", icon: Brain, section: "reflect",
    tabs: [
      { key: "memory", label: "Memory" },
      { key: "review", label: "Review" },
      { key: "health", label: "Health" },
    ] },
  { href: "/people", label: "People", icon: Users, section: "reflect", flatRow: true },

  // ── OPERATE ── (/system owns its own hub grid of sub-surfaces)
  // The money section (/business hub) + the external nickstire.org/admin
  // footer link were removed 2026-09-01 on operator verdict — both dead in
  // practice. The /business PAGE followed on 2026-09-02 (plan R7, operator
  // verdict "delete"): page + its three tabs deleted, /business redirects to
  // /stats, and the AI-facing routes to it (context-hints, tool-result links,
  // brain-graph anchors, page-visit) were repointed so Nick cannot route the
  // operator to a surface that no longer exists. The personal /money page
  // predeceased them (2026-07-29, WP-9 verdict).
  { href: "/system", label: "System", icon: Activity, section: "operate" },

  // ── FOOTER ──
  { href: "/settings", label: "Settings", icon: Settings, section: "operate", footer: true },
];

/** The 4 bottom content tabs. Since UI v3 W1b the fourth slot is pinnable (default Journal), and the fifth is Command. */
export const BOTTOM_TABS = NAV.filter((n) => n.bottomTab);

// ── UI v3 W1b · pin-to-tab-bar ───────────────────────────────────────
// The fourth bottom slot holds one entry the operator picks from the More
// sheet (Linear mobile, 2026-01-22); Journal is the default. The stored
// value is a bare href in localStorage (lib/state/pinned-tab-store.ts);
// everything below is pure so the bar, the sheet and the tests share one
// answer for "what is in the slot" and "what is a row".

/** The default occupant of the pinned slot. Pinning it again restores the default. */
export const DEFAULT_PINNED_HREF = "/journal";

/** The three slots that never move: every bottom tab except the default pinned one. */
export const FIXED_TABS = BOTTOM_TABS.filter((n) => n.href !== DEFAULT_PINNED_HREF);

/** A flat More row, or Journal itself. Hubs, the footer and the fixed tabs cannot take the slot (a fixed tab would show twice). */
export const isPinnable = (n: NavEntry): boolean => {
  if (n.footer) return false;
  if (n.bottomTab) return n.href === DEFAULT_PINNED_HREF;
  return n.flatRow === true;
};

/** The entry in the pinned slot for a stored href; anything stale, unknown or not pinnable is Journal. */
export function resolvePinnedTab(stored: string | null | undefined, nav: NavEntry[]): NavEntry {
  const hit = stored ? nav.find((n) => n.href === stored && isPinnable(n)) : undefined;
  return hit ?? nav.find((n) => n.href === DEFAULT_PINNED_HREF) ?? nav[0];
}

/** MORE-sheet rows for a verb section given the pinned href: the pinned entry leaves, Journal joins Reflect when displaced. */
export const moreRows = (s: NavSection, pinnedHref: string) =>
  NAV.filter(
    (n) => n.section === s && !n.footer && n.href !== pinnedHref && (!n.bottomTab || n.href === DEFAULT_PINNED_HREF),
  );
