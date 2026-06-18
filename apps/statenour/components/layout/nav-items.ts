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
