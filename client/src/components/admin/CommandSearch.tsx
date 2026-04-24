/**
 * CommandSearch — Searchable command bar for the admin top bar.
 * Searches customers, navigates to sections, and provides quick actions.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Search, Users, CalendarClock, Phone, X, LayoutDashboard } from "lucide-react";
import type { AdminSection } from "@/pages/admin/shared";

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
  { id: "leads", label: "Leads / CRM", keywords: ["lead", "crm", "prospect", "new customer"], group: "Sales" },
  { id: "declinedEstimates", label: "Declined Work", keywords: ["declined", "walked", "lost", "recovery"], group: "Sales" },
  { id: "noShowRisk", label: "No-Show Risk", keywords: ["no-show", "risk", "missing"], group: "Sales" },
  { id: "snapDashboard", label: "Snap Finance", keywords: ["snap", "financing", "acima", "koalafi", "payment"], group: "Sales" },

  // Revenue & Customers
  { id: "revenue", label: "Revenue & Shop", keywords: ["revenue", "money", "income", "sales"], group: "Revenue" },
  { id: "callTrackingView", label: "Call Tracking", keywords: ["call", "phone", "tracking", "missed", "callback"], group: "Revenue" },
  { id: "customers", label: "Customer Database", keywords: ["customer", "client", "database", "lookup", "loyalty", "winback", "referral"], group: "Revenue" },

  // Outreach + Intelligence
  { id: "campaigns", label: "Outreach Hub", keywords: ["campaign", "outreach", "sms", "email", "review", "follow-up"], group: "Outreach" },
  { id: "reEngagement", label: "Re-engagement", keywords: ["re-engage", "winback", "dormant", "inactive"], group: "Outreach" },
  { id: "content", label: "Content & AI", keywords: ["content", "post", "social", "blog", "ai", "seo", "specials"], group: "Outreach" },
  { id: "intelligence", label: "Intelligence", keywords: ["intelligence", "brain", "insight", "ai", "analysis"], group: "Intelligence" },

  // System (tabs inside Settings)
  { id: "settings", label: "Settings & System", keywords: ["setting", "config", "sync", "shopdriver", "health", "compliance", "integrations"], group: "System" },
];

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

  // Filter section shortcuts
  const matchingSections = query.length >= 1
    ? SECTION_SHORTCUTS.filter(s =>
        s.label.toLowerCase().includes(query.toLowerCase()) ||
        s.keywords.some(k => k.includes(query.toLowerCase()))
      ).slice(0, 4)
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
  const hasResults = customers.length > 0 || matchingSections.length > 0;

  // Total results for keyboard navigation
  const totalResults = matchingSections.length + customers.length;

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
        } else {
          const custIdx = selectedIndex - matchingSections.length;
          if (customers[custIdx]) {
            onSelectCustomer((customers[custIdx] as { id: number }).id);
            close();
          }
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, selectedIndex, totalResults, matchingSections, customers, close, onNavigate, onSelectCustomer]);

  // Reset selection when query changes
  useEffect(() => { setSelectedIndex(-1); }, [query]);

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 bg-muted/50 border border-border px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all text-xs"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Search...</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-background/50 border border-border/30 rounded text-[10px] text-foreground/30 ml-2">
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

                  {/* Customer results */}
                  {customers.length > 0 && (
                    <div className="px-2 py-2 border-t border-border/10">
                      <div className="px-2 py-1 text-[10px] font-semibold text-foreground/40 tracking-wider uppercase">Customers</div>
                      {customers.map((c: any, ci: number) => (
                        <button
                          key={c.id}
                          onClick={() => { onSelectCustomer(c.id); close(); }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors group ${
                            selectedIndex === matchingSections.length + ci ? "bg-primary/15" : "hover:bg-primary/10"
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
