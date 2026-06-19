import {
  Brain,
  MessageSquare,
  ListTodo,
  Shield,
  Settings,
  Store,
  NotebookPen,
  Activity,
  Clock,
  AlertTriangle,
  Zap,
  Bot,
  Pin,
  Send,
  Target,
  Image as ImageIcon,
  Newspaper,
  History,
  TrendingUp,
  Filter,
  Radar,
  Search,
  Users,
  Link2,
  Mic,
  BookOpen,
  GraduationCap,
  Wallet,
  Contact,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof Brain;
  mobileTab?: boolean;
  /** External link — opens in a new tab. Used for the Admin tab
   *  that now points at nickstire.org/admin (the business admin
   *  moved there per the Apr 17 separation pass). */
  external?: boolean;
  /** v11.0 — part of the System ops deck. Rendered as a compact row in
   *  FloatingHome below the core 5 so the orb stays a 5-tab surface but
   *  the op power knobs are one tap away with live health signals. */
  systemTab?: boolean;
  /** v11.0 — which key from /api/system/pulse feeds the badge for this
   *  surface. Undefined = no live badge. */
  pulseKey?: "cronsDrifted" | "errors24h" | "aiErrorRate" | "actionsPending";
};

// ═══ NOUR OS v10 — chat-as-home era. Wave 27 dissolved Ultron's apex
// surface · the root route (/) now renders the conversational
// interface with a tight HomeStrip above. /cockpit alias preserves
// the full dashboard view for anyone who wants it.
//
// Mobile bottom nav · 4 wide:
//   Home (chat) · Actions (tasks) · Journal · Admin
// Nick label dropped from bottom nav · home IS Nick now.
//
// Changes from Wave 18 (which had dropped Brain/Life/Ops from QUICK
// NAV): Ultron tab also goes · /cockpit available via ⌘K + the
// FloatingHome quick-nav for muscle memory.

export const NAV_ITEMS: NavItem[] = [
  // CORE 4 — mobile bottom nav. Wave 27 · chat is home.
  { href: "/",          label: "Home",        icon: MessageSquare,  mobileTab: true },
  // 2026-05-28 · Wave AA · /tasks renamed to /missions (Missions-led IA).
  // Label stays "Missions" so the mental model is mission-first; the
  // old /tasks URL 308-redirects via next.config redirects.
  { href: "/missions",  label: "Missions",    icon: ListTodo,       mobileTab: true },
  { href: "/journal",   label: "Journal",     icon: NotebookPen,    mobileTab: true },
  // Apr 17 separation: /admin on autonicks was retired — business
  // ops live at nickstire.org/admin. Tab now points external so the
  // mobile bottom nav stays compact + Nour gets one-tap into shop admin.
  { href: "https://nickstire.org/admin", label: "Admin", icon: Store, mobileTab: true, external: true },

  // CHAT canonical URL still exists for deep-links + ⌘K + back-compat.
  // Mobile users land on / which renders the same experience.
  { href: "/chat",      label: "Nick",        icon: MessageSquare },
  // Wave AD · 2026-05-28 · /cockpit deleted · the Sam-led / IS the
  // cockpit now (Wave AC). next.config redirects /cockpit → /.

  // DEPTH — stats, people, growth, system, settings (sidebar + ⌘K)
  // 2026-05-30 · /scoreboard + /goals CONSOLIDATED into /stats (one page:
  // character sheet → goals → KPIs). Both old routes redirect to /stats.
  { href: "/stats",         label: "Stats",    icon: Target },
  // 2026-05-28 · Power Atlas surface lands in the DEPTH section. /relationships
  // is the per-person CIA dossier + Greene-law coach + RelationshipLedger.
  // /relationships/network is the SVG graph view (degree centrality + bridges).
  { href: "/people", label: "People", icon: Users },
  // 2026-05-30 · "/mastery → Growth" entry removed · it 308-redirected to
  // /stats (a duplicate of the "Stats" entry above). next.config keeps the
  // /mastery redirect for any external / bookmarked links.
  { href: "/brain",         label: "Brain",    icon: Brain },
  { href: "/system",        label: "System",   icon: Activity },
  { href: "/settings",      label: "Settings", icon: Settings },

  // SYSTEM OPS DECK (v11.0) — rendered as a compact second section in
  // FloatingHome with live badges. Accessible via ⌘K too.
  { href: "/system/crons",    label: "Crons",    icon: Clock,          systemTab: true, pulseKey: "cronsDrifted" },
  // v10.0.306 · /system/errors absorbed into /system/logs as a
  // GROUPED view-mode tab. URL param triggers initial view.
  { href: "/system/logs?view=errors",   label: "Errors",   icon: AlertTriangle,  systemTab: true, pulseKey: "errors24h" },
  { href: "/system/ai-cost",  label: "AI Cost",  icon: Zap,            systemTab: true, pulseKey: "aiErrorRate" },
  { href: "/system/actions",  label: "Actions",  icon: Bot,            systemTab: true, pulseKey: "actionsPending" },

  // v6 (Apr 28) — new tools added in the mega-overhaul. ⌘K-only,
  // not in the bottom nav (those tabs are sacred — 5 wide).
  // 2026-05-21 · KommandoShell dismantle · Phase 3 · the dead `/plan`
  // entry removed — there is no /plan page (next.config.ts redirects
  // /plan → /stats) and goal authoring now lives at /stats (added to
  // the DEPTH section above).
  { href: "/pins",            label: "Pinned Memory",   icon: Pin },
  // v10.0.302 · /intel removed · automotive-RSS dashboard's business
  // value moved to nickstire (per its own docstring); the personal-OS
  // version was low-signal noise. Page deleted, API kept (still used
  // by chat adaptive-placeholder). Best part is no part.
  { href: "/content?tab=publish", label: "Publish",      icon: Send },
  { href: "/photo-improver",  label: "Photo Improver",  icon: ImageIcon },
  { href: "/content?tab=history", label: "Content History", icon: History },
  // Wave AD · 2026-05-28 · /system/prompt + /system/costs deleted ·
  // /system/ai-cost is the only cost surface now · /system/prompt
  // collapsed into /system. next.config redirects in place.

  // 2026-05-24 · Wave X.e (consolidation+activation pass) ·
  // Intelligence Dispersal Wave 3 surfaces · 3 statenour-side bridge
  // pages were SHIPPED but never wired into nav · invisible to ⌘K +
  // FloatingHome · operator could only reach them by typing the URL.
  // /funnel · 6-stage Lead→Estimate→Drop-off→Job→Review→Retained
  //          consumes nickstire bridges funnel_overview +
  //          funnel_first_visit.
  // Wave 2 surface merge · /radar + /seo folded into the tabbed /market
  // surface; these two entries deep-link the Radar + Search tabs.
  // /market?tab=radar  · competitor + AI-visibility · master_report bridge.
  // /market?tab=search · GSC + Ahrefs forensic · nickstire seo bridges.
  { href: "/business?tab=funnel", label: "Funnel",          icon: Filter },
  { href: "/market?tab=radar",  label: "Radar",           icon: Radar },
  { href: "/market?tab=search", label: "SEO",             icon: Search },
  { href: "/links",             label: "Short Links",     icon: Link2 },

  // Wave AD · 2026-05-28 · /system/data-source-health deleted ·
  // folded into /system/health. next.config redirects in place.
];

// Pages accessible via ⌘K command palette or Nick chat (personal OS only):
// /body, /financial, /decisions, /cameras, /devices, /knowledge,
// /integrations
// Retired (business moved to nickstire.org/admin Apr 17): /appointments
// /revenue /tires /quotes /reviews /campaigns /estimator /margins /scrapers
// /applicants /leads /crm /projections
// Retired (personal redirected / folded): /command /strategy /brief
// /causation /drift /habits /loops /commitments /personal /capture /mobile

export const MOBILE_TABS = NAV_ITEMS.filter((item) => item.mobileTab);
export const SYSTEM_TABS = NAV_ITEMS.filter((item) => item.systemTab);

// ════════════════════════════════════════════════════════════════════
// SECTIONED NAV MODEL — 2026-06-18 · IA reorg Phase 2 (additive)
// ════════════════════════════════════════════════════════════════════
// One source of truth the future bottom bar, the MORE sheet, AND ⌘K all
// read — so the three never drift (the old flat NAV_ITEMS + hardcoded
// cmdK + orb were three independent copies). ADDITIVE: the legacy
// NAV_ITEMS / MOBILE_TABS / SYSTEM_TABS above stay live until the Phase 4
// renderer flip consumes this. Phase 3 makes ⌘K iterate NAV.
// See docs/audits/IA-REORG-DESIGN.md §2 + §5.
//
// Sections are the operator's OS-loop VERBS: capture → execute → reflect
// → money → operate. `bottomTab` items are the 4 always-visible daily
// content tabs (rendered in the bar, excluded from the MORE sheet by
// `bySection`). `/system` owns its own sub-surfaces via the System hub
// grid, so the system/* children are NOT listed here.

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
  { href: "/",         label: "Home",     icon: MessageSquare, section: "capture", bottomTab: true },
  { href: "/missions", label: "Missions", icon: ListTodo,      section: "execute", bottomTab: true },
  { href: "/journal",  label: "Journal",  icon: NotebookPen,   section: "reflect", bottomTab: true },
  { href: "/stats",    label: "Stats",    icon: Target,        section: "reflect", bottomTab: true },

  // ── CAPTURE ──
  { href: "/voice", label: "Voice",         icon: Mic, section: "capture", flatRow: true },
  { href: "/pins",  label: "Pinned Memory", icon: Pin, section: "capture", flatRow: true },

  // ── EXECUTE ──
  { href: "/content", label: "Content", icon: Send, section: "execute",
    tabs: [{ key: "drafts", label: "Drafts" }, { key: "history", label: "History" }, { key: "publish", label: "Publish" }, { key: "outreach", label: "Outreach" }] },
  { href: "/market", label: "Market", icon: Radar, section: "execute",
    tabs: [{ key: "search", label: "SEO" }, { key: "radar", label: "Radar" }] },
  { href: "/knowledge",      label: "Knowledge",      icon: BookOpen,       section: "execute", flatRow: true },
  { href: "/learn",          label: "Learn",          icon: GraduationCap,  section: "execute", flatRow: true },
  { href: "/photo-improver", label: "Photo Improver", icon: ImageIcon,      section: "execute", flatRow: true },
  { href: "/links",          label: "Short Links",    icon: Link2,          section: "execute", flatRow: true },

  // ── REFLECT ──
  { href: "/brain", label: "Brain", icon: Brain, section: "reflect",
    tabs: [{ key: "memory", label: "Memory" }, { key: "board", label: "Board" }, { key: "wisdom", label: "Wisdom" }, { key: "reason", label: "Reason" }] },
  { href: "/people", label: "People", icon: Users, section: "reflect", flatRow: true },

  // ── MONEY ── (Phase 5 folds finance+wealth into a /money hub + folds
  // /crm into /business?tab=clients; for now they're flat rows so the
  // orphans are reachable.)
  { href: "/finance", label: "Finance", icon: Wallet,     section: "money", flatRow: true },
  { href: "/wealth",  label: "Wealth",  icon: TrendingUp, section: "money", flatRow: true },
  { href: "/crm",     label: "CRM",     icon: Contact,    section: "money", flatRow: true },
  { href: "/business", label: "Business", icon: Store, section: "money",
    tabs: [{ key: "money", label: "Money" }, { key: "funnel", label: "Funnel" }] },

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
