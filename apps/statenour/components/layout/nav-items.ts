import {
  Brain,
  Home,
  MessageSquare,
  ListTodo,
  Settings,
  Store,
  NotebookPen,
  Activity,
  Pin,
  Send,
  Target,
  Image as ImageIcon,
  Radar,
  Users,
  Link2,
  GraduationCap,
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
// money → operate. `bottomTab` items are the 4 always-visible daily content
// tabs (rendered in the bar; excluded from the MORE sheet by `bySection`).
// `/system` owns its own sub-surfaces via the System hub grid, so the
// system/* children are NOT listed here. Hidden routes (the /chat alias,
// /decisions/[id], /auth/sign-in) and redirect stubs (/goals, /scoreboard)
// are intentionally absent. See docs/audits/IA-REORG-DESIGN.md §2 + §5.

export type NavSection = "capture" | "execute" | "reflect" | "money" | "operate";

export interface NavEntry {
  href: string;
  label: string;
  icon: typeof Brain;
  section: NavSection;
  /** One of the 4 always-visible bottom content tabs. */
  bottomTab?: boolean;
  /** Rendered as a flat one-tap MORE row (vs a hub that owns its own tabs). */
  flatRow?: boolean;
  /** External link — opens in a new tab (e.g. nickstire.org/admin). */
  external?: boolean;
  /** Footer placement in the MORE sheet (Settings · Admin). */
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
  { href: "/stats",    label: "Stats",    icon: Target,        section: "reflect", flatRow: true },

  // ── CAPTURE ──
  { href: "/pins",  label: "Pinned Memory", icon: Pin, section: "capture", flatRow: true },

  // ── EXECUTE ──
  { href: "/content", label: "Content", icon: Send, section: "execute",
    tabs: [{ key: "drafts", label: "Drafts" }, { key: "history", label: "History" }, { key: "publish", label: "Publish" }, { key: "outreach", label: "Outreach" }] },
  { href: "/market", label: "Market", icon: Radar, section: "execute",
    tabs: [{ key: "search", label: "SEO" }, { key: "radar", label: "Radar" }] },
  { href: "/learn",          label: "Learn",          icon: GraduationCap,  section: "execute", flatRow: true },
  { href: "/photo-improver", label: "Photo Improver", icon: ImageIcon,      section: "execute", flatRow: true },
  { href: "/links",          label: "Short Links",    icon: Link2,          section: "execute", flatRow: true },

  // ── REFLECT ──
  { href: "/brain", label: "Brain", icon: Brain, section: "reflect",
    tabs: [{ key: "memory", label: "Memory" }, { key: "board", label: "Board" }, { key: "wisdom", label: "Wisdom" }, { key: "reason", label: "Reason" }] },
  { href: "/people", label: "People", icon: Users, section: "reflect", flatRow: true },

  // ── MONEY ── the shop /business hub. The personal /money page (former
  // /finance + /wealth tabs) was deleted 2026-07-29 per the operator's WP-9
  // verdict — its models died in the 2026-06-21 schema purge and the tabs had
  // been in honest retired-state since 07-28. Shop money lives in Business.
  { href: "/business", label: "Business", icon: Store, section: "money",
    tabs: [{ key: "money", label: "Money" }, { key: "funnel", label: "Funnel" }, { key: "clients", label: "Clients" }] },

  // ── OPERATE ── (/system owns its own hub grid of sub-surfaces)
  { href: "/system", label: "System", icon: Activity, section: "operate" },

  // ── FOOTER ──
  { href: "/settings", label: "Settings", icon: Settings, section: "operate", footer: true },
  { href: "https://nickstire.org/admin", label: "Admin", icon: Store, section: "operate", external: true, footer: true },
];

/** The 4 always-visible bottom content tabs (a synthetic "More" is added by the renderer). */
export const BOTTOM_TABS = NAV.filter((n) => n.bottomTab);

/** MORE-sheet rows for a verb section — excludes the bottom tabs + footer. */
export const bySection = (s: NavSection) =>
  NAV.filter((n) => n.section === s && !n.bottomTab && !n.footer);
