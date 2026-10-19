/**
 * OpsHubSection — Reports, Owner Actions, and Danger-Zone truth in one
 * read-only surface.
 *
 * 2026-06-10 danger-zone-safe-build wave. Three views:
 *   - Owner Actions: the ops registry (what's dangerous, what's safe,
 *     what only the owner can do, exact next action per item)
 *   - Reports: the repo's audit/report corpus with paths
 *   - Search: the former Market section (owner/manager only)
 *   - Traffic: the former Traffic to Revenue section (owner/manager only)
 * Message Previews was cut 2026-10-19 (0 opens in 14 days; no send path exists).
 *
 * SAFETY: this section performs zero mutations. The only network calls
 * are read-only admin queries (payments.health booleans + rendered
 *  template previews). No fake numbers — anything unwired says so.
 */
import { lazy, Suspense } from "react";
import {
  ShieldAlert, FileText, AlertTriangle, CheckCircle2,
  Wrench, ExternalLink, Loader2, Lock, Search, TrendingUp,
} from "lucide-react";
import { Section, Panel, TabBar, useUrlFilter } from "./shared";
import { innerTabsForRole, resolveInnerTab } from "./innerTabs";
import type { AdminRole } from "@shared/adminPermissions";
import { trpc } from "@/lib/trpc";
import {
  OPS_REGISTRY, REPORT_DOCS, type OpsItem, type OpsStatus,
} from "@/lib/opsRegistry";

const MarketSection = lazy(() => import("./MarketSection"));
const TrafficFunnelSection = lazy(() => import("./TrafficFunnelSection"));

const HUB_TABS: { id: string; label: string; icon: React.ReactNode }[] = [
  { id: "actions", label: "Owner Actions", icon: <ShieldAlert className="w-3.5 h-3.5" /> },
  { id: "reports", label: "Reports", icon: <FileText className="w-3.5 h-3.5" /> },
  { id: "search", label: "Search", icon: <Search className="w-3.5 h-3.5" /> },
  { id: "traffic", label: "Traffic", icon: <TrendingUp className="w-3.5 h-3.5" /> },
];

const tabFallback = <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

const STATUS_META: Record<OpsStatus, { label: string; cls: string }> = {
  done: { label: "DONE", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  partial: { label: "PARTIAL", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  preview_only: { label: "PREVIEW ONLY", cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  design_only: { label: "DESIGN ONLY", cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  manual_owner: { label: "OWNER MANUAL", cls: "bg-primary/10 text-primary border-primary/20" },
  blocked_external: { label: "BLOCKED: EXTERNAL", cls: "bg-red-500/10 text-red-400 border-red-500/20" },
  requires_approval: { label: "NEEDS APPROVAL", cls: "bg-red-500/10 text-red-400 border-red-500/20" },
  not_started: { label: "NOT STARTED", cls: "bg-foreground/5 text-foreground/40 border-border/20" },
};

const RISK_CLS: Record<OpsItem["risk"], string> = {
  high: "bg-red-500/10 text-red-400 border-red-500/20",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  low: "bg-foreground/5 text-foreground/50 border-border/20",
};

export default function OpsHubSection() {
  // Role decides which tabs show (innerTabs.ts): Search and Traffic were
  // owner/manager sections. A link to them for another role lands on Owner
  // Actions. Until the role loads, only the unrestricted tabs show.
  const { data: security } = trpc.adminSecurity.status.useQuery();
  const role = (security?.adminRole ?? null) as AdminRole | null;
  const [requested, setTab] = useUrlFilter<string>("reportsTab", "actions");
  const tab = resolveInnerTab("opsHub", requested, role) ?? "actions";
  const visibleTabs = HUB_TABS.filter((t) => innerTabsForRole("opsHub", role).includes(t.id));

  // Live read-only health (booleans only) — annotates the Stripe/Sheets
  // registry cards with what's actually true right now in this deploy.
  const { data: health, isError: healthError, fetchStatus: healthFetchStatus } = trpc.payments.health.useQuery(undefined, {
    refetchInterval: 5 * 60_000,
  });

  // Unknown, never a missing line: a failed read, or a paused one (offline PWA: no data, no error, never ran).
  const healthUnknown = healthError
    ? "Live check couldn't load. This deploy's state is unknown."
    : !health && healthFetchStatus === "paused"
      ? "Offline, live check not run. This deploy's state is unknown."
      : undefined;

  const categories = [...new Set(OPS_REGISTRY.map((i) => i.category))];

  return (
    <Section
      title="Ops Hub"
      subtitle="Reports, owner actions, and danger-zone truth. Read-only: nothing here sends, posts, refunds, or orders."
      icon={<Wrench className="w-5 h-5 text-primary" />}
    >
      <TabBar tabs={visibleTabs} activeTab={tab} onChange={setTab} variant="pill" size="compact" />

      {tab === "actions" && (
        <div className="space-y-5 mt-4">
          {categories.map((cat) => (
            <Panel key={cat} title={cat} icon={<ShieldAlert className="w-4 h-4" />}>
              <div className="space-y-3 mt-2">
                {OPS_REGISTRY.filter((i) => i.category === cat).map((item) => (
                  <OpsCard key={item.id} item={item} health={health} healthUnknown={healthUnknown} />
                ))}
              </div>
            </Panel>
          ))}
          <p className="text-[10px] text-foreground/30 leading-relaxed">
            This registry is hand-maintained and evidence-based: update it in the
            same PR that changes an item's truth. Statuses are claims; if reality
            disagrees, the registry is wrong and should be fixed.
          </p>
        </div>
      )}

      {tab === "reports" && (
        <div className="space-y-2 mt-4">
          {REPORT_DOCS.map((r) => (
            <div key={r.path} className="bg-card border border-border/30 rounded p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground">{r.title}</div>
                <div className="text-[10px] text-muted-foreground">{r.category}{r.note ? ` · ${r.note}` : ""}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "search" && <div className="mt-4"><Suspense fallback={tabFallback}><MarketSection /></Suspense></div>}
      {tab === "traffic" && <div className="mt-4"><Suspense fallback={tabFallback}><TrafficFunnelSection /></Suspense></div>}
    </Section>
  );
}

function OpsCard({ item, health, healthUnknown }: {
  item: OpsItem;
  healthUnknown?: string;
  health?: { stripe: { fullyConfigured: boolean; halfConfigured: boolean }; sheetsConfigured: boolean };
}) {
  const meta = STATUS_META[item.status];

  // Live annotations for the two registry entries we can actually verify
  // from this deploy, read-only. Everything else renders registry truth.
  let liveNote: { ok: boolean; text: string } | null = null;
  // A failed health read must not make the live line vanish: say the live state is unknown.
  if (healthUnknown && (item.id === "stripe-config" || item.id === "sheets-tire-orders")) {
    liveNote = { ok: false, text: healthUnknown };
  }
  if (item.id === "stripe-config" && health) {
    liveNote = health.stripe.halfConfigured
      ? { ok: false, text: "Live check: half-configured right now, paid events are being dropped." }
      : health.stripe.fullyConfigured
        ? { ok: true, text: "Live check: Stripe fully configured in this deploy." }
        : { ok: false, text: "Live check: Stripe not configured, Pay Now degrades to call-to-pay." };
  }
  if (item.id === "sheets-tire-orders" && health) {
    liveNote = health.sheetsConfigured
      ? { ok: true, text: "Live check: GOOGLE_SHEETS_CRM_ID is set in this deploy." }
      : { ok: false, text: "Live check: Sheets env NOT set, order rows are not mirrored." };
  }

  return (
    <div className="bg-background/40 border border-border/30 rounded p-3 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-foreground">{item.title}</span>
        <span className={`px-1.5 py-0.5 text-[9px] font-bold border rounded ${meta.cls}`}>{meta.label}</span>
        <span className={`px-1.5 py-0.5 text-[9px] font-bold border rounded ${RISK_CLS[item.risk]}`}>{item.risk} risk</span>
        {item.ownerRequired && (
          <span className="px-1.5 py-0.5 text-[9px] font-bold border rounded bg-primary/10 text-primary border-primary/20 inline-flex items-center gap-1">
            <Lock className="w-2.5 h-2.5" /> OWNER
          </span>
        )}
      </div>
      <p className="text-[11px] text-foreground/70 leading-relaxed">{item.truth}</p>
      {item.forbidden && (
        <p className="text-[11px] text-red-400/90 leading-relaxed flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
          <span><span className="font-semibold">Forbidden without approval:</span> {item.forbidden}</span>
        </p>
      )}
      {liveNote && (
        <p className={`text-[11px] flex items-start gap-1 ${liveNote.ok ? "text-emerald-400/90" : "text-red-400"}`}>
          {liveNote.ok ? <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5" /> : <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />}
          {liveNote.text}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
        <p className="text-[11px] text-foreground/80">
          <span className="font-semibold text-primary">Next:</span> {item.nextAction}
        </p>
        <div className="flex items-center gap-2 text-[10px] text-foreground/40">
          {item.doc && <code className="break-all">{item.doc}</code>}
          {item.href && (
            <a href={item.href} className="text-primary hover:underline inline-flex items-center gap-0.5">
              open <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
          <span>verified {item.lastVerified}</span>
        </div>
      </div>
    </div>
  );
}
