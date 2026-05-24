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
  { href: "/tasks",     label: "Actions",     icon: ListTodo,       mobileTab: true },
  { href: "/journal",   label: "Journal",     icon: NotebookPen,    mobileTab: true },
  // Apr 17 separation: /admin on autonicks was retired — business
  // ops live at nickstire.org/admin. Tab now points external so the
  // mobile bottom nav stays compact + Nour gets one-tap into shop admin.
  { href: "https://nickstire.org/admin", label: "Admin", icon: Store, mobileTab: true, external: true },

  // CHAT canonical URL still exists for deep-links + ⌘K + back-compat.
  // Mobile users land on / which renders the same experience.
  { href: "/chat",      label: "Nick",        icon: MessageSquare },
  // COCKPIT — the full Ultron apex dashboard. Was the root pre-Wave-27.
  { href: "/cockpit",   label: "Cockpit",     icon: Shield },

  // DEPTH — goals, growth, system, settings (accessible via sidebar + ⌘K)
  // 2026-05-21 · KommandoShell dismantle · Phase 3 · /goals added to the
  // nav. /goals is now the goal-authoring surface (the relocated PLAN
  // tab) — it earns a real nav entry.
  { href: "/goals",         label: "Goals",    icon: Target },
  { href: "/mastery",       label: "Growth",   icon: Brain },
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
  // /plan → /goals) and goal authoring now lives at /goals (added to
  // the DEPTH section above).
  { href: "/pins",            label: "Pinned Memory",   icon: Pin },
  // v10.0.302 · /intel removed · automotive-RSS dashboard's business
  // value moved to nickstire (per its own docstring); the personal-OS
  // version was low-signal noise. Page deleted, API kept (still used
  // by chat adaptive-placeholder). Best part is no part.
  { href: "/social",          label: "Publish",         icon: Send },
  { href: "/photo-improver",  label: "Photo Improver",  icon: ImageIcon },
  { href: "/content/history", label: "Content History", icon: History },
  { href: "/system/prompt",   label: "System Prompt",   icon: Newspaper },
  { href: "/system/costs",    label: "AI Costs (deep)", icon: TrendingUp },

  // 2026-05-24 · Wave X.e (consolidation+activation pass) ·
  // Intelligence Dispersal Wave 3 surfaces · 3 statenour-side bridge
  // pages were SHIPPED but never wired into nav · invisible to ⌘K +
  // FloatingHome · operator could only reach them by typing the URL.
  // /funnel · 6-stage Lead→Estimate→Drop-off→Job→Review→Retained
  //          consumes nickstire bridges funnel_overview +
  //          funnel_first_visit.
  // /radar  · competitor + AI-visibility surface ·
  //          consumes master_report bridge.
  // /seo    · GSC + Ahrefs forensic surface ·
  //          consumes nickstire seo bridges.
  { href: "/funnel",          label: "Funnel",          icon: Filter },
  { href: "/radar",           label: "Radar",           icon: Radar },
  { href: "/seo",             label: "SEO",             icon: Search },

  // 2026-05-24 · Wave X.f activation · data-source-health canary
  // (v10.0.58 Wave B) had no operator surface · the cron probed
  // every 6h but nothing rendered the streaks. Now ⌘K reachable.
  { href: "/system/data-source-health", label: "Data Source Health", icon: Activity },
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
