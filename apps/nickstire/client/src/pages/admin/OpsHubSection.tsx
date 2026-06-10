/**
 * OpsHubSection — Reports, Owner Actions, and Danger-Zone truth in one
 * read-only surface.
 *
 * 2026-06-10 danger-zone-safe-build wave. Three views:
 *   - Owner Actions: the ops registry (what's dangerous, what's safe,
 *     what only the owner can do, exact next action per item)
 *   - Reports: the repo's audit/report corpus with paths
 *   - Message Previews: the five PREVIEW-ONLY customer confirmation
 *     templates (no send path exists)
 *
 * SAFETY: this section performs zero mutations. The only network calls
 * are read-only admin queries (payments.health booleans + rendered
 *  template previews). No fake numbers — anything unwired says so.
 */
import { useState } from "react";
import {
  ShieldAlert, FileText, MessageSquareText, AlertTriangle, CheckCircle2,
  Wrench, ExternalLink, Loader2, Lock,
} from "lucide-react";
import { Section, Panel, TabBar } from "./shared";
import { trpc } from "@/lib/trpc";
import {
  OPS_REGISTRY, REPORT_DOCS, type OpsItem, type OpsStatus,
} from "@/lib/opsRegistry";

type HubTab = "actions" | "reports" | "messages";

const HUB_TABS: { id: HubTab; label: string; icon: React.ReactNode }[] = [
  { id: "actions", label: "Owner Actions", icon: <ShieldAlert className="w-3.5 h-3.5" /> },
  { id: "reports", label: "Reports", icon: <FileText className="w-3.5 h-3.5" /> },
  { id: "messages", label: "Message Previews", icon: <MessageSquareText className="w-3.5 h-3.5" /> },
];

const STATUS_META: Record<OpsStatus, { label: string; cls: string }> = {
  done: { label: "DONE", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  partial: { label: "PARTIAL", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  preview_only: { label: "PREVIEW ONLY", cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  design_only: { label: "DESIGN ONLY", cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  manual_owner: { label: "OWNER MANUAL", cls: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
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
  const [tab, setTab] = useState<HubTab>("actions");

  // Live read-only health (booleans only) — annotates the Stripe/Sheets
  // registry cards with what's actually true right now in this deploy.
  const { data: health } = trpc.payments.health.useQuery(undefined, {
    refetchInterval: 5 * 60_000,
  });

  const categories = [...new Set(OPS_REGISTRY.map((i) => i.category))];

  return (
    <Section
      title="Ops Hub"
      subtitle="Reports, owner actions, and danger-zone truth. Read-only — nothing here sends, posts, refunds, or orders."
      icon={<Wrench className="w-5 h-5 text-primary" />}
    >
      <TabBar tabs={HUB_TABS} activeTab={tab} onChange={setTab} variant="pill" size="compact" />

      {tab === "actions" && (
        <div className="space-y-5 mt-4">
          {categories.map((cat) => (
            <Panel key={cat} title={cat} icon={<ShieldAlert className="w-4 h-4" />}>
              <div className="space-y-3 mt-2">
                {OPS_REGISTRY.filter((i) => i.category === cat).map((item) => (
                  <OpsCard key={item.id} item={item} health={health} />
                ))}
              </div>
            </Panel>
          ))}
          <p className="text-[10px] text-foreground/30 leading-relaxed">
            This registry is hand-maintained and evidence-based — update it in the
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
                <div className="text-[10px] text-muted-foreground">{r.category}{r.note ? ` — ${r.note}` : ""}</div>
                <code className="text-[10px] text-foreground/40 break-all">{r.path}</code>
              </div>
            </div>
          ))}
          <p className="text-[10px] text-foreground/30 leading-relaxed pt-1">
            Reports live in the repo as markdown — open them in the repo/editor.
            Paths are relative to the repository root unless prefixed otherwise.
          </p>
        </div>
      )}

      {tab === "messages" && <MessagePreviews />}
    </Section>
  );
}

function OpsCard({ item, health }: {
  item: OpsItem;
  health?: { stripe: { fullyConfigured: boolean; halfConfigured: boolean }; sheetsConfigured: boolean };
}) {
  const meta = STATUS_META[item.status];

  // Live annotations for the two registry entries we can actually verify
  // from this deploy, read-only. Everything else renders registry truth.
  let liveNote: { ok: boolean; text: string } | null = null;
  if (item.id === "stripe-config" && health) {
    liveNote = health.stripe.halfConfigured
      ? { ok: false, text: "LIVE CHECK: half-configured RIGHT NOW — paid events are being dropped." }
      : health.stripe.fullyConfigured
        ? { ok: true, text: "Live check: Stripe fully configured in this deploy." }
        : { ok: false, text: "Live check: Stripe not configured — Pay Now degrades to call-to-pay." };
  }
  if (item.id === "sheets-tire-orders" && health) {
    liveNote = health.sheetsConfigured
      ? { ok: true, text: "Live check: GOOGLE_SHEETS_CRM_ID is set in this deploy." }
      : { ok: false, text: "Live check: Sheets env NOT set — order rows are not mirrored." };
  }

  return (
    <div className="bg-background/40 border border-border/30 rounded p-3 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-foreground">{item.title}</span>
        <span className={`px-1.5 py-0.5 text-[9px] font-bold border rounded ${meta.cls}`}>{meta.label}</span>
        <span className={`px-1.5 py-0.5 text-[9px] font-bold border rounded uppercase ${RISK_CLS[item.risk]}`}>{item.risk} risk</span>
        {item.ownerRequired && (
          <span className="px-1.5 py-0.5 text-[9px] font-bold border rounded bg-purple-500/10 text-purple-400 border-purple-500/20 inline-flex items-center gap-1">
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

function MessagePreviews() {
  const { data, isLoading } = trpc.nickActions.customerMessagePreviews.useQuery();

  return (
    <div className="space-y-4 mt-4">
      <div className="border border-blue-500/40 bg-blue-500/10 rounded p-3 text-xs text-blue-200 flex items-start gap-2">
        <MessageSquareText className="w-4 h-4 shrink-0 mt-0.5 text-blue-400" />
        <span>
          <strong>Preview only — customer messages are NOT being sent automatically.</strong>{" "}
          No send path exists in the codebase (it throws by design). Enabling real
          sends requires your approval of provider, cost, and this exact copy in a
          dedicated PR. Rendered below against a sample order.
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : !data ? (
        <p className="text-xs text-muted-foreground">Previews unavailable — check the server logs.</p>
      ) : (
        data.map((t) => (
          <Panel key={t.key} title={t.key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())} icon={<MessageSquareText className="w-4 h-4" />}>
            <div className="space-y-2 mt-2 text-xs">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-foreground/40 font-semibold">SMS ({t.sms.length} chars)</span>
                <p className="bg-background/50 border border-border/30 rounded p-2 mt-1 text-foreground/80 whitespace-pre-wrap">{t.sms}</p>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-foreground/40 font-semibold">Email — {t.emailSubject}</span>
                <p className="bg-background/50 border border-border/30 rounded p-2 mt-1 text-foreground/80 whitespace-pre-wrap">{t.emailBody}</p>
              </div>
            </div>
          </Panel>
        ))
      )}
    </div>
  );
}
