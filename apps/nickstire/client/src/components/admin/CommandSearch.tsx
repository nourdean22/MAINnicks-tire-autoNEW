/**
 * CommandSearch — Searchable command bar for the admin top bar.
 * Searches customers, navigates to sections, and provides quick actions.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Search, Users, CalendarClock, Phone, X, LayoutDashboard, Zap, RefreshCw, Sparkles, AlertTriangle, DollarSign, Star, Crown, PhoneCall, FileText } from "lucide-react";
import { toast } from "sonner";
import type { AdminSection } from "@/pages/admin/shared";
import { openDrilldown } from "./DrilldownDrawer";

interface Props {
  onNavigate: (section: AdminSection) => void;
  onSelectCustomer: (customerId: number) => void;
}

// Debounce helper
function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// Curated shortcut list — mirrors current 16-section navigation (2026-04-24
// admin audit). Deleted sections (bookings, workOrders, sms, winback, etc.)
// removed here but still reachable via TAB_ALIASES in Admin.tsx for legacy
// bookmarks.
const SECTION_SHORTCUTS: { id: AdminSection; label: string; keywords: string[]; group: string }[] = [
  // Core Operations
  { id: "overview", label: "Dashboard Overview", keywords: ["dashboard", "overview", "home", "today"], group: "Operations" },
  { id: "trafficFunnel", label: "Traffic → Revenue", keywords: ["funnel", "traffic", "seo", "conversion", "clicks"], group: "Operations" },
  { id: "walkInCalc", label: "Walk-In Quote", keywords: ["quote", "estimate", "walk-in", "labor"], group: "Operations" },
  { id: "commandCenter", label: "NOUR OS Bridge", keywords: ["nour", "brain", "bridge", "sync", "command"], group: "Operations" },

  // Sales Pipeline
  { id: "leads", label: "Leads / CRM", keywords: ["lead", "crm", "prospect", "new customer", "no-show", "risk"], group: "Sales" },
  { id: "declinedEstimates", label: "Declined Work", keywords: ["declined", "walked", "lost", "recovery"], group: "Sales" },
  { id: "snapDashboard", label: "Snap Finance", keywords: ["snap", "financing", "acima", "koalafi", "payment"], group: "Sales" },

  // Revenue & Customers
  { id: "revenue", label: "Revenue & Shop", keywords: ["revenue", "money", "income", "sales"], group: "Revenue" },
  { id: "callTrackingView", label: "Call Tracking", keywords: ["call", "phone", "tracking", "missed", "callback"], group: "Revenue" },
  { id: "customers", label: "Customer Database", keywords: ["customer", "client", "database", "lookup", "loyalty", "winback", "referral"], group: "Revenue" },

  // Outreach + Intelligence
  // wave-110 — reEngagement merged into campaigns (Outreach Hub tab)
  { id: "campaigns", label: "Outreach Hub", keywords: ["campaign", "outreach", "sms", "email", "review", "follow-up", "re-engage", "winback", "dormant", "inactive"], group: "Outreach" },
  { id: "content", label: "Content & AI", keywords: ["content", "post", "social", "blog", "ai", "seo", "specials"], group: "Outreach" },
  { id: "intelligence", label: "Intelligence", keywords: ["intelligence", "brain", "insight", "ai", "analysis"], group: "Intelligence" },

  // System (tabs inside Settings)
  { id: "settings", label: "Settings & System", keywords: ["setting", "config", "sync", "shopdriver", "health", "compliance", "integrations"], group: "System" },
];

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
    // 2026-05-06 Elon-deeper-cut · walkInCalc was removed from the
    // sidebar to declutter daily nav. Surfacing it as a Cmd+K quick
    // action keeps it 3-keystrokes-away without the visual tax.
    // 2026-05-19 Elon-cut · removed action-no-show-risk + action-
    // conversion-preview + action-re-engagement (zombie sections
    // fully deleted; their quick-actions had nowhere to navigate).
    {
      id: "action-walkin-quote",
      label: "Walk-In Quote",
      keywords: ["walkin", "walk-in", "quote", "estimate", "calculator", "labor"],
      icon: <DollarSign className="w-4 h-4 text-emerald-500" />,
      group: "Action",
      run: () => onNavigate("walkInCalc"),
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
          <div className="fixed top-[15%] left-1/2 -translate-x-1/2 z-50 w-full max-w-lg">
            <div className="bg-card border border-border/30 shadow-2xl overflow-hidden">
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border/20">
                <Search className="w-4 h-4 text-foreground/40 shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search customers, navigate sections..."
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/30 outline-none"
                />
                {query && (
                  <button onClick={() => setQuery("")} className="text-foreground/30 hover:text-foreground/60" aria-label="Clear search">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Results */}
              {query.length >= 1 && (
                <div className="max-h-[50vh] overflow-y-auto">
                  {/* Section shortcuts */}
                  {matchingSections.length > 0 && (
                    <div className="px-2 py-2">
                      <div className="px-2 py-1 text-[10px] font-semibold text-foreground/40 tracking-wider uppercase">Sections</div>
                      {matchingSections.map((s, i) => (
                        <button
                          key={s.id}
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
                      {customers.map((c: any, ci: number) => (
                        <button
                          key={c.id}
                          onClick={() => { onSelectCustomer(c.id); close(); }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors group ${
                            selectedIndex === matchingSections.length + matchingActions.length + ci ? "bg-primary/15" : "hover:bg-primary/10"
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
                      ))}
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
              <div className="px-4 py-2 border-t border-border/10 text-[10px] text-foreground/30">
                <kbd className="px-1 py-0.5 bg-background/50 border border-border/30 rounded">↑↓</kbd> navigate · <kbd className="px-1 py-0.5 bg-background/50 border border-border/30 rounded">↵</kbd> select · <kbd className="px-1 py-0.5 bg-background/50 border border-border/30 rounded">Esc</kbd> close
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
