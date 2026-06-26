/**
 * CommandSearch — Searchable command bar for the admin top bar.
 * Searches customers, navigates to sections, and provides quick actions.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { Search, Users, CalendarClock, Phone, X, LayoutDashboard, Zap, RefreshCw, Sparkles, AlertTriangle, DollarSign, Star, Crown, PhoneCall, FileText, Activity, Send, MessageSquare, RotateCcw, LayoutGrid } from "lucide-react";
// wave-181.x Customers Phase 4 · additional icons used by the new
// Customers Cmd+K shortcuts (Users · Crown · AlertTriangle reused).
import { toast } from "sonner";
import { ADMIN_REGISTRY } from "@/pages/admin/registry";
import { openDrilldown } from "./DrilldownDrawer";
import type { AdminSection } from "@/pages/admin/shared";

interface Props {
  onNavigate: (section: AdminSection) => void;
  onSelectCustomer: (customerId: number) => void;
}

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// Dynamic shortcuts derived from ADMIN_REGISTRY
const SECTION_SHORTCUTS = ADMIN_REGISTRY.map(s => ({
  id: s.id,
  label: s.id === "overview"
    ? "Dashboard Overview"
    : (s.id === "settings"
        ? "Settings & System"
        : (s.id === "voiceReceptionist"
            ? "Voice Receptionist (Nick)"
            : (s.id === "customers"
                ? "Customer Database"
                : (s.id === "memberships"
                    ? "Nonstop Nick (member lookup)"
                    : (s.id === "leads"
                        ? "Leads / CRM"
                        : s.label))))),
  keywords: s.keywords ?? [],
  group: s.group ?? "Operations",
}));

// 2026-05-06 — Quick Actions registry for ⌘K palette.
// Each action either opens a drilldown, triggers a mutation, or fires
// a side effect. Type-safe action handler is set up at runtime.
interface QuickAction {
  id: string;
  label: string;
  keywords: string[];
  icon: React.ReactNode;
  group: "Drilldown" | "Action";
  /** Set at component runtime — closure over hooks/dispatchers */
  run: () => void | Promise<void>;
}

export function CommandSearch({ onNavigate, onSelectCustomer }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(query, 300);

  // Fetch customers when query looks like a search
  const { data: customerResults } = trpc.customers.list.useQuery(
    { search: debouncedQuery, pageSize: 5 },
    { enabled: open && debouncedQuery.length >= 2 }
  );

  // 2026-05-06 — AI Admin Copilot mutations. Wired into Quick Actions
  // registry so ⌘K can trigger them without leaving keyboard flow.
  const refreshAlgMutation = trpc.shopdriver.requestProbe.useMutation({
    onSuccess: (res) => {
      if (res?.outcome === "success") {
        toast.success("ALG probe fired", {
          description: `Synced ${res.recordsProcessed ?? 0} records in ${res.durationMs ?? 0}ms`,
        });
      } else if (res?.outcome === "dedup" || res?.outcome === "skipped_recent" || res?.alreadyFresh) {
        toast.message("ALG probe skipped", { description: "Recent data still valid" });
      } else {
        toast.warning("ALG probe finished", { description: res?.errorMessage || res?.outcome || "Unknown outcome" });
      }
    },
    onError: (err) => toast.error("ALG probe failed", { description: err.message }),
  });
  const generateGbpMutation = trpc.contentAdmin.generateGBPPost.useMutation({
    onSuccess: (res) => {
      toast.success("GBP post generated", {
        description: res?.archetype ? `Archetype: ${res.archetype} — ready to copy` : "Ready to paste into business.google.com",
      });
    },
    onError: (err) => toast.error("GBP generation failed", { description: err.message }),
  });

  // Filter section shortcuts
  const matchingSections = query.length >= 1
    ? SECTION_SHORTCUTS.filter(s =>
        s.label.toLowerCase().includes(query.toLowerCase()) ||
        s.keywords.some(k => k.includes(query.toLowerCase()))
      ).slice(0, 4)
    : [];

  // Quick Actions registry — built at runtime so closures capture
  // mutation hooks + onNavigate. Memoized to avoid re-running every keystroke.
  const quickActions = useMemo<QuickAction[]>(() => [
    {
      id: "drilldown-walkaways",
      label: "Show walk-aways",
      keywords: ["walk", "walkaway", "lost", "declined", "bounced", "abandoned"],
      icon: <AlertTriangle className="w-4 h-4 text-amber-500" />,
      group: "Drilldown",
      run: () => openDrilldown({ kind: "walk_aways", title: "Walk-Aways (Last 7 Days)" }),
    },
    {
      id: "drilldown-callbacks",
      label: "Show pending callbacks",
      keywords: ["callback", "call", "missed", "phone", "pending", "owed"],
      icon: <PhoneCall className="w-4 h-4 text-blue-500" />,
      group: "Drilldown",
      run: () => openDrilldown({ kind: "pending_callbacks", title: "Pending Callbacks" }),
    },
    {
      id: "drilldown-fresh-leads",
      label: "Show fresh leads",
      keywords: ["lead", "fresh", "new", "today", "incoming"],
      icon: <Sparkles className="w-4 h-4 text-emerald-500" />,
      group: "Drilldown",
      run: () => openDrilldown({ kind: "fresh_leads", title: "Fresh Leads (24h)" }),
    },
    {
      id: "drilldown-revenue-today",
      label: "Show today's revenue",
      keywords: ["revenue", "money", "today", "income", "sales", "invoice"],
      icon: <DollarSign className="w-4 h-4 text-green-500" />,
      group: "Drilldown",
      run: () => openDrilldown({ kind: "revenue_today", title: "Revenue — Today" }),
    },
    {
      id: "drilldown-negative-reviews",
      label: "Show negative reviews",
      keywords: ["review", "negative", "bad", "complaint", "1-star", "rating"],
      icon: <Star className="w-4 h-4 text-red-500" />,
      group: "Drilldown",
      run: () => openDrilldown({ kind: "negative_reviews", title: "Negative Reviews (≤3★)" }),
    },
    {
      id: "drilldown-lapsed-vips",
      label: "Show lapsed VIPs",
      keywords: ["vip", "lapsed", "loyal", "winback", "dormant", "best"],
      icon: <Crown className="w-4 h-4 text-purple-500" />,
      group: "Drilldown",
      run: () => openDrilldown({ kind: "lapsed_vips", title: "Lapsed VIPs" }),
    },
    {
      id: "action-refresh-alg",
      label: "Refresh ALG (tire counts)",
      keywords: ["alg", "refresh", "shopdriver", "probe", "tire", "count", "sync"],
      icon: <RefreshCw className="w-4 h-4 text-cyan-500" />,
      group: "Action",
      run: () => refreshAlgMutation.mutate({ reason: "manual_refresh" }),
    },
    {
      id: "action-generate-gbp",
      label: "Generate GBP post",
      keywords: ["gbp", "google", "post", "social", "business profile", "generate"],
      icon: <FileText className="w-4 h-4 text-orange-500" />,
      group: "Action",
      run: () => generateGbpMutation.mutate(undefined),
    },
    {
      id: "action-jump-overview",
      label: "Jump to Today's Brief",
      keywords: ["brief", "today", "morning", "overview", "dashboard", "home"],
      icon: <Zap className="w-4 h-4 text-yellow-500" />,
      group: "Action",
      run: () => onNavigate("overview"),
    },
    // 2026-05-19 · Walk-In Quote · was a top-level route, now an event-
    // bus drawer (WalkInQuoteDrawer mounted globally in Admin.tsx). This
    // Quick Action fires openWalkInQuote() instead of navigating.
    {
      id: "action-walkin-quote",
      label: "Walk-In Quote · pricing tool",
      keywords: ["walkin", "walk-in", "quote", "estimate", "calculator", "labor", "price"],
      icon: <DollarSign className="w-4 h-4 text-emerald-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("admin:open-walkin-quote"));
        }
      },
    },
    {
      id: "action-winback",
      label: "Win-Back lapsed customers",
      keywords: ["winback", "win-back", "lapsed", "reengage", "re-engage", "dormant"],
      icon: <RefreshCw className="w-4 h-4 text-blue-500" />,
      group: "Action",
      // 2026-05-19 — re-engage tab killed; the winback tab covers the same cohort.
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=campaigns&outreachTab=winback");
        }
        onNavigate("campaigns");
      },
    },
    // 2026-05-19 MONEY consolidation · Declined + Snap are inner tabs
    // of Money. These actions land Cmd+K users on the right tab.
    {
      id: "action-declined-work",
      label: "Declined Work · $321K pipeline",
      keywords: ["declined", "walked", "lost", "recovery", "pipeline", "estimates"],
      icon: <AlertTriangle className="w-4 h-4 text-amber-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=revenue&moneyTab=declined");
        }
        onNavigate("revenue");
      },
    },
    {
      id: "action-snap-finance",
      label: "Snap Finance dashboard",
      keywords: ["snap", "financing", "finance", "acima", "koalafi", "payment", "loan"],
      icon: <DollarSign className="w-4 h-4 text-emerald-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=revenue&moneyTab=financing");
        }
        onNavigate("revenue");
      },
    },
    // wave-181.x · Settings page redesign · Phase 4
    // Cmd+K shortcuts for the new Settings sub-tabs.
    {
      id: "action-settings-status",
      label: "Settings · Status (open issues)",
      keywords: ["status", "open issues", "alert", "warning", "attention", "morning brief", "health"],
      icon: <Activity className="w-4 h-4 text-emerald-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=settings&settingsTab=status");
        }
        onNavigate("settings");
      },
    },
    {
      id: "action-settings-shopdriver",
      label: "Settings · ShopDriver HQ (ALG sync)",
      keywords: ["shopdriver", "alg", "sync", "invoice", "customer", "probe"],
      icon: <RefreshCw className="w-4 h-4 text-cyan-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=settings&settingsTab=shopdriver");
        }
        onNavigate("settings");
      },
    },
    {
      id: "action-settings-flags",
      label: "Find a feature flag",
      keywords: ["flag", "feature flag", "toggle", "enable", "disable", "FEATURE_", "sms_", "engine_", "search flag"],
      icon: <Zap className="w-4 h-4 text-amber-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=settings&settingsTab=shopdriver");
          // Scroll to feature flags panel after navigation
          setTimeout(() => {
            const el = Array.from(document.querySelectorAll("h3")).find((h) =>
              /feature flags/i.test(h.textContent || ""),
            );
            el?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 200);
        }
        onNavigate("settings");
      },
    },
    {
      id: "action-settings-health",
      label: "Settings · System Health",
      keywords: ["health", "uptime", "db", "database", "memory", "vendor status", "system"],
      icon: <Activity className="w-4 h-4 text-blue-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=settings&settingsTab=health");
        }
        onNavigate("settings");
      },
    },
    // wave-181.x Customers Phase 4 · jumps for the Customers page.
    {
      id: "action-customers-lapsed",
      label: "Customers · show lapsed cohort",
      keywords: ["customers", "lapsed", "dormant", "win-back", "churn", "at-risk"],
      icon: <Users className="w-4 h-4 text-amber-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=customers&seg=lapsed");
        }
        onNavigate("customers");
      },
    },
    {
      id: "action-customers-vips",
      label: "Customers · show VIPs (3+ visits)",
      keywords: ["customers", "vip", "loyalty", "best", "regulars", "3+", "visits"],
      icon: <Crown className="w-4 h-4 text-amber-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=customers&seg=all");
        }
        onNavigate("customers");
        // The Customers page reads minVisits from local state · we
        // can't pre-seed via URL · but the VIP StatCard is the first
        // click target on landing. Future: extend useUrlFilter to
        // cover minVisits so deep-linking works fully.
      },
    },
    {
      id: "action-customers-declined",
      label: "Customers · show declined-work cohort",
      keywords: ["customers", "declined", "walked", "estimate", "recovery"],
      icon: <AlertTriangle className="w-4 h-4 text-amber-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=customers&seg=all");
        }
        onNavigate("customers");
      },
    },
    {
      id: "action-flip-declined-recovery",
      label: "Flip FEATURE_DECLINED_RECOVERY (84 estimates · $47K)",
      keywords: ["declined", "recovery", "flag", "flip", "47k", "84", "sms", "FEATURE_DECLINED"],
      icon: <DollarSign className="w-4 h-4 text-emerald-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=settings&settingsTab=shopdriver");
          // Scroll to flags + open the dialog via the new ⚠ RISKY confirmDialog
          setTimeout(() => {
            const flagBtn = Array.from(document.querySelectorAll("button")).find((b) =>
              (b.getAttribute("aria-label") || "").includes("FEATURE_DECLINED_RECOVERY"),
            );
            flagBtn?.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 250);
        }
        onNavigate("settings");
      },
    },
    // wave-181.x Outreach Hub Phase 4 · jumps to each bulk-send surface.
    // Cmd+K → "campaign" / "review" / "winback" lands you one click from
    // the bulk-SMS gate (which itself is confirm-dialog protected since
    // Phase 1). Highest-frequency outreach jumps · the operator no
    // longer needs to drill through the sidebar to reach them.
    {
      id: "action-outreach-campaigns",
      label: "Outreach · Send a campaign",
      keywords: ["outreach", "campaign", "blast", "bulk sms", "send", "broadcast", "segment"],
      icon: <Send className="w-4 h-4 text-blue-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=campaigns&outreachTab=campaigns");
        }
        // AdminSection name for the Outreach Hub is "campaigns" (legacy).
        // Writing the canonical tab=campaigns avoids Admin.tsx's effect
        // overwriting the alias `tab=outreach` immediately after mount.
        onNavigate("campaigns");
      },
    },
    {
      id: "action-outreach-reviews",
      label: "Outreach · Process review request queue",
      keywords: ["outreach", "reviews", "review request", "google review", "queue", "process", "due"],
      icon: <Star className="w-4 h-4 text-amber-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=campaigns&outreachTab=reviews");
        }
        // AdminSection name for the Outreach Hub is "campaigns" (legacy).
        // Writing the canonical tab=campaigns avoids Admin.tsx's effect
        // overwriting the alias `tab=outreach` immediately after mount.
        onNavigate("campaigns");
      },
    },
    {
      id: "action-outreach-winback",
      label: "Outreach · Win-Back sequences",
      keywords: ["outreach", "winback", "win-back", "lapsed", "re-engagement", "reactivation", "sequence"],
      icon: <RotateCcw className="w-4 h-4 text-emerald-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=campaigns&outreachTab=winback");
        }
        // AdminSection name for the Outreach Hub is "campaigns" (legacy).
        // Writing the canonical tab=campaigns avoids Admin.tsx's effect
        // overwriting the alias `tab=outreach` immediately after mount.
        onNavigate("campaigns");
      },
    },
    // wave-181.x Leads Hub Phase 4 · 3 jumps for the most-frequent
    // Leads queries. Each lands the operator one click from a
    // common-action surface. Leads filter taxonomy keys are validated
    // in LeadsSection's useUrlFilter (status, source, view).
    {
      id: "action-leads-kanban",
      label: "Leads · Kanban board",
      keywords: ["leads", "kanban", "board", "pipeline", "drag", "drop"],
      icon: <LayoutGrid className="w-4 h-4 text-blue-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=leads&view=kanban");
        }
        onNavigate("leads");
      },
    },
    {
      id: "action-leads-urgent",
      label: "Leads · Uncontacted backlog (urgent)",
      keywords: ["leads", "urgent", "uncontacted", "sla", "new", "backlog", "ghost"],
      icon: <AlertTriangle className="w-4 h-4 text-red-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          // ?status=new lands on the freshest uncontacted cohort; the
          // urgent-banner shows on top of the list/Kanban for the
          // operator to triage in order.
          window.history.replaceState({}, "", "/admin?tab=leads&status=new");
        }
        onNavigate("leads");
        // After section mount, scroll the urgent banner into view if it
        // exists. Banner has id="leads-urgent-banner".
        setTimeout(() => {
          const el = document.getElementById("leads-urgent-banner");
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 250);
      },
    },
    {
      id: "action-leads-vapi",
      label: "Leads · Nick AI (VAPI) source filter",
      keywords: ["leads", "vapi", "nick", "ai", "voice", "source", "call"],
      icon: <PhoneCall className="w-4 h-4 text-amber-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=leads&source=vapi");
        }
        onNavigate("leads");
      },
    },
    // wave-181.x Money Phase 4 · 3 jumps for the highest-leverage Money
    // surfaces. Operator runs all three multiple times per day. Each
    // compresses 3-4 sidebar clicks into one keystroke.
    {
      id: "action-money-declined-fire",
      label: "Money · Declined work · FIRE bulk recovery",
      keywords: ["money", "declined", "fire", "recovery", "bulk", "sms", "$321K", "47K"],
      icon: <DollarSign className="w-4 h-4 text-amber-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=revenue&moneyTab=declined");
          // After section mount, scroll the FIRE button into view. The
          // operator still has to confirm the confirmDialog gate, but
          // we save them the tab-drill + scroll.
          setTimeout(() => {
            const btn = Array.from(document.querySelectorAll("button")).find((b) =>
              /FIRE ALL ELIGIBLE/i.test(b.textContent || ""),
            );
            btn?.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 250);
        }
        onNavigate("revenue");
      },
    },
    {
      id: "action-money-create-invoice",
      label: "Money · Create invoice",
      keywords: ["money", "invoice", "create", "new", "bill", "charge"],
      icon: <FileText className="w-4 h-4 text-emerald-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=revenue&moneyTab=revenue&revTab=create");
        }
        onNavigate("revenue");
      },
    },
    {
      id: "action-money-top-declined",
      label: "Money · Top declined ≥$500 by amount",
      keywords: ["money", "declined", "top", "high-ticket", "$500", "amount", "sort"],
      icon: <AlertTriangle className="w-4 h-4 text-amber-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          // DeclinedEstimates reads sort+min from local useState (not
          // useUrlFilter) so we can't seed those · land on the tab and
          // let the operator click the existing $500/$1K threshold pills.
          window.history.replaceState({}, "", "/admin?tab=revenue&moneyTab=declined");
        }
        onNavigate("revenue");
      },
    },
    // wave-181.x Voice Phase 4 · 3 high-leverage Voice jumps. Each
    // compresses 3-4 sidebar clicks into one keystroke. Live-calls +
    // stuck-calls anchors lean on `#voice-live-calls` injected in
    // VoiceReceptionistSection on the LiveCallsCard wrapper.
    {
      id: "action-voice-live",
      label: "Voice · Live in-flight calls",
      keywords: ["voice", "nick", "vapi", "live", "in-flight", "active", "calls"],
      icon: <PhoneCall className="w-4 h-4 text-violet-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=voiceReceptionist");
        }
        onNavigate("voiceReceptionist");
        setTimeout(() => {
          const el = document.getElementById("voice-live-calls");
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 250);
      },
    },
    {
      id: "action-voice-stuck",
      label: "Voice · Stuck calls (Nick fumbled · needs review)",
      keywords: ["voice", "nick", "stuck", "tool", "fumble", "review", "verify"],
      icon: <AlertTriangle className="w-4 h-4 text-amber-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", "/admin?tab=voiceReceptionist");
        }
        onNavigate("voiceReceptionist");
        // Same anchor as the VoiceBrief action CTA · flash the card.
        setTimeout(() => {
          const el = document.getElementById("voice-live-calls");
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.classList.add("ring-2", "ring-amber-400/50");
            setTimeout(() => el.classList.remove("ring-2", "ring-amber-400/50"), 1200);
          }
        }, 250);
      },
    },
    {
      id: "action-voice-today",
      label: "Voice · Today's calls (reset filters)",
      keywords: ["voice", "nick", "today", "calls", "reset", "filter"],
      icon: <Phone className="w-4 h-4 text-blue-500" />,
      group: "Action",
      run: () => {
        if (typeof window !== "undefined") {
          // ?range=today resets the date-range to default · VoiceReceptionist
          // reads rangePreset from local useState though, not useUrlFilter,
          // so this is a soft hint · operator may need to click "Today"
          // chip if they were on a custom range. Better than nothing.
          window.history.replaceState({}, "", "/admin?tab=voiceReceptionist");
        }
        onNavigate("voiceReceptionist");
      },
    },
  ], [refreshAlgMutation, generateGbpMutation, onNavigate]);

  // Filter actions by query
  const matchingActions = query.length >= 1
    ? quickActions.filter(a =>
        a.label.toLowerCase().includes(query.toLowerCase()) ||
        a.keywords.some(k => k.includes(query.toLowerCase()))
      ).slice(0, 6)
    : [];

  // Keyboard shortcut to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const [selectedIndex, setSelectedIndex] = useState(-1);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedIndex(-1);
  }, []);

  // Trap Tab inside the palette + restore focus on close (WCAG 2.4.3).
  // autoFocus disabled — the input already self-focuses (effect below).
  useFocusTrap(overlayRef, open, { onEscape: close, autoFocus: false });

  const customers = customerResults?.customers || [];
  const hasResults = customers.length > 0 || matchingSections.length > 0 || matchingActions.length > 0;

  // Total results for keyboard navigation. Order: Sections → Actions → Customers
  const totalResults = matchingSections.length + matchingActions.length + customers.length;

  // Keyboard navigation within results
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, totalResults - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, -1));
      }
      if (e.key === "Enter" && selectedIndex >= 0) {
        e.preventDefault();
        if (selectedIndex < matchingSections.length) {
          onNavigate(matchingSections[selectedIndex].id);
          close();
        } else if (selectedIndex < matchingSections.length + matchingActions.length) {
          const actIdx = selectedIndex - matchingSections.length;
          const action = matchingActions[actIdx];
          if (action) {
            void action.run();
            close();
          }
        } else {
          const custIdx = selectedIndex - matchingSections.length - matchingActions.length;
          if (customers[custIdx]) {
            onSelectCustomer((customers[custIdx] as { id: number }).id);
            close();
          }
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, selectedIndex, totalResults, matchingSections, matchingActions, customers, close, onNavigate, onSelectCustomer]);

  // Reset selection when query changes
  useEffect(() => { setSelectedIndex(-1); }, [query]);

  return (
    <>
      {/* Trigger button — wave-130 minimalist ghost icon, matches the
          rest of the topbar utilities. ⌘K hint shows inline on lg+. */}
      <button
        onClick={() => setOpen(true)}
        title="Search (⌘K)"
        aria-label="Search"
        className="inline-flex items-center justify-center gap-2 h-9 px-2.5 lg:px-3 text-muted-foreground hover:text-foreground hover:bg-foreground/5 rounded-md transition-colors"
      >
        <Search className="w-4 h-4" />
        <kbd className="hidden lg:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-foreground/40 border border-border/40 rounded">
          ⌘K
        </kbd>
      </button>

      {/* Modal overlay */}
      {open && (
        <>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-50" onClick={close} />
          <div className="fixed top-[max(0.75rem,env(safe-area-inset-top))] sm:top-[15%] left-1/2 -translate-x-1/2 z-50 w-[calc(100vw-1.5rem)] sm:w-full max-w-lg">
            <div
              ref={overlayRef}
              role="dialog"
              aria-modal="true"
              aria-label="Command search"
              className="bg-card border border-border/30 shadow-2xl overflow-hidden rounded-xl"
            >
              {/* SR-only status — announces result count as the operator types. */}
              <div aria-live="polite" className="sr-only">
                {query.length >= 1
                  ? hasResults
                    ? `${totalResults} result${totalResults === 1 ? "" : "s"}`
                    : query.length >= 2
                      ? "No results"
                      : ""
                  : ""}
              </div>
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border/20">
                <Search className="w-4 h-4 text-foreground/40 shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search customers, navigate sections..."
                  role="combobox"
                  aria-expanded={totalResults > 0 ? "true" : "false"}
                  aria-controls="command-search-listbox"
                  aria-activedescendant={selectedIndex >= 0 ? `cmd-opt-${selectedIndex}` : undefined}
                  aria-autocomplete="list"
                  className="flex-1 bg-transparent text-[16px] sm:text-sm text-foreground placeholder:text-foreground/30 outline-none"
                />
                {query && (
                  <button onClick={() => setQuery("")} className="text-foreground/30 hover:text-foreground/60" aria-label="Clear search">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Results */}
              {query.length >= 1 && (
                <div role="listbox" id="command-search-listbox" className="max-h-[calc(100dvh-12rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] sm:max-h-[50vh] overflow-y-auto overscroll-contain">
                  {/* Section shortcuts */}
                  {matchingSections.length > 0 && (
                    <div className="px-2 py-2">
                      <div className="px-2 py-1 text-[10px] font-semibold text-foreground/40 tracking-wider uppercase">Sections</div>
                      {matchingSections.map((s, i) => (
                        <button
                          key={s.id}
                          role="option"
                          id={`cmd-opt-${i}`}
                          aria-selected={selectedIndex === i ? "true" : "false"}
                          onClick={() => { onNavigate(s.id); close(); }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm text-foreground transition-colors ${
                            selectedIndex === i ? "bg-primary/15 text-primary" : "hover:bg-primary/10"
                          }`}
                        >
                          <LayoutDashboard className="w-4 h-4 text-foreground/40" />
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Quick Actions (drilldowns + mutations) */}
                  {matchingActions.length > 0 && (
                    <div className="px-2 py-2 border-t border-border/10">
                      <div className="px-2 py-1 text-[10px] font-semibold text-foreground/40 tracking-wider uppercase">Actions</div>
                      {matchingActions.map((a, ai) => {
                        const idx = matchingSections.length + ai;
                        const isPending =
                          (a.id === "action-refresh-alg" && refreshAlgMutation.isPending) ||
                          (a.id === "action-generate-gbp" && generateGbpMutation.isPending);
                        return (
                          <button
                            key={a.id}
                            role="option"
                            id={`cmd-opt-${idx}`}
                            aria-selected={selectedIndex === idx ? "true" : "false"}
                            onClick={() => { void a.run(); close(); }}
                            disabled={isPending}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                              selectedIndex === idx ? "bg-primary/15 text-primary" : "hover:bg-primary/10"
                            }`}
                          >
                            {a.icon}
                            <span className="flex-1">{a.label}</span>
                            <span className="text-[10px] text-foreground/30 uppercase tracking-wider">{a.group}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Customer results */}
                  {customers.length > 0 && (
                    <div className="px-2 py-2 border-t border-border/10">
                      <div className="px-2 py-1 text-[10px] font-semibold text-foreground/40 tracking-wider uppercase">Customers</div>
                      {customers.map((c: any, ci: number) => {
                        const idx = matchingSections.length + matchingActions.length + ci;
                        return (
                        <button
                          key={c.id}
                          role="option"
                          id={`cmd-opt-${idx}`}
                          aria-selected={selectedIndex === idx ? "true" : "false"}
                          onClick={() => { onSelectCustomer(c.id); close(); }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors group ${
                            selectedIndex === idx ? "bg-primary/15" : "hover:bg-primary/10"
                          }`}
                        >
                          <Users className="w-4 h-4 text-foreground/40 group-hover:text-primary" />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-foreground block truncate">
                              {c.firstName} {c.lastName || ""}
                            </span>
                            <span className="text-[11px] text-foreground/40 flex items-center gap-2">
                              {c.phone && <><Phone className="w-3 h-3 inline" /> {c.phone}</>}
                            </span>
                          </div>
                        </button>
                        );
                      })}
                    </div>
                  )}

                  {/* No results */}
                  {!hasResults && query.length >= 2 && (
                    <div className="px-4 py-8 text-center text-sm text-foreground/40">
                      No results for "{query}"
                    </div>
                  )}
                </div>
              )}

              {/* Footer hint */}
              <div className="hidden sm:block px-4 py-2 border-t border-border/10 text-[10px] text-foreground/30">
                <kbd className="px-1 py-0.5 bg-background/50 border border-border/30 rounded">↑↓</kbd> navigate · <kbd className="px-1 py-0.5 bg-background/50 border border-border/30 rounded">↵</kbd> select · <kbd className="px-1 py-0.5 bg-background/50 border border-border/30 rounded">Esc</kbd> close
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
