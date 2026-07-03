/**
 * SMS Campaigns Admin Section
 * Create, manage, and track targeted SMS campaigns.
 */
import { useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";
import { StatCard, formatDate, PageHeader } from "../shared";
// wave-181.x Outreach Phase 1 · safety gate on bulk campaign send.
// confirmDialog is iOS-PWA-safe (window.confirm is suppressed in
// standalone mode per nickstire-ios-pwa-primitives skill).
import { confirmDialog } from "@/components/admin/ConfirmDialog";

type Campaign = NonNullable<RouterOutputs["campaigns"]["list"]>[number];
import {
  Plus, Send, Clock, CheckCircle2, AlertCircle, Eye, X,
  Loader2, MessageSquare, Users, TrendingUp,
} from "lucide-react";

type View = "list" | "create" | "preview";
type Template = "maintenance" | "seasonal" | "special_offer" | "winback";
type Segment = "recent" | "lapsed" | "all";

const TEMPLATE_CONFIG: Record<Template, { label: string; description: string; icon: React.ReactNode }> = {
  maintenance: {
    label: "Maintenance Reminder",
    description: "Remind customers about vehicle maintenance",
    icon: <MessageSquare className="w-4 h-4" />,
  },
  seasonal: {
    label: "Seasonal",
    description: "Seasonal service reminders (winter, spring, etc.)",
    icon: <TrendingUp className="w-4 h-4" />,
  },
  special_offer: {
    label: "Special Offer",
    description: "Promote exclusive deals and discounts",
    icon: <Users className="w-4 h-4" />,
  },
  winback: {
    label: "Winback",
    description: "Re-engage lapsed customers",
    icon: <Send className="w-4 h-4" />,
  },
};

const SEGMENT_CONFIG: Record<Segment, { label: string; description: string }> = {
  recent: {
    label: "Recent Customers",
    description: "Active in the last 90 days",
  },
  lapsed: {
    label: "Lapsed Customers",
    description: "Haven't visited in 91-365 days",
  },
  all: {
    label: "All Customers",
    description: "Every customer in the database",
  },
};

export default function CampaignsSection() {
  const [view, setView] = useState<View>("list");
  const [selectedTemplate, setSelectedTemplate] = useState<Template>("maintenance");
  const [selectedSegment, setSelectedSegment] = useState<Segment>("recent");
  const [campaignName, setCampaignName] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<Array<{ customer: string; phone: string; message: string }>>([]);
  // forensic-audit CRITICAL · true segment size (preview only returns 5 samples).
  const [previewCount, setPreviewCount] = useState(0);
  const [creating, setCreating] = useState(false);

  const { data: campaigns, refetch: refetchCampaigns } = trpc.campaigns.list.useQuery();
  const { data: stats } = trpc.campaigns.stats.useQuery();
  const previewQuery = trpc.campaigns.preview.useQuery(
    { template: selectedTemplate, segment: selectedSegment, customMessage: customMessage || undefined },
    { enabled: false }
  );
  // 2026-05-23 · added onSuccess invalidation. Previously, if create
  // succeeded but the immediately-following send threw, the new draft
  // never appeared in the list (refetchCampaigns was only called after
  // sendResult.success). Invalidate at the source so the list is right.
  const utilsForCampaigns = trpc.useUtils();
  const createMutation = trpc.campaigns.create.useMutation({
    onSuccess: () => utilsForCampaigns.campaigns.list.invalidate(),
  });
  const sendMutation = trpc.campaigns.send.useMutation({
    onSuccess: () => utilsForCampaigns.campaigns.list.invalidate(),
  });

  async function handlePreview() {
    setPreviewLoading(true);
    try {
      const result = await previewQuery.refetch();
      if (result.data) {
        setPreview(result.data.samples);
        setPreviewCount(result.data.targetCount);
      }
    } catch (e) {
      // wave-112 — was console.error only (silent failure); now actionable
      console.error("Failed to load preview:", e);
      const msg = e instanceof Error ? e.message : "Unknown error loading preview";
      toast.error(`Preview failed: ${msg}`);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleCreateAndSend() {
    if (!campaignName.trim()) {
      // wave-111 — was native alert(); brand-consistent toast across admin
      toast.error("Please enter a campaign name");
      return;
    }

    // wave-181.x Outreach Phase 1 bug-fix · per code-explorer agent audit:
    // before this gate, clicking "Send Campaign" on the preview screen
    // fired create+send IMMEDIATELY with no second confirmation.
    // The campaign sends to the entire segment (could be the full DB).
    // confirmDialog is iOS-PWA-safe vs window.confirm (suppressed in
    // standalone mode per wave-139). Includes target-count + segment
    // name + a clear "real outbound SMS" warning.
    const targetCount = previewCount;
    const ok = await confirmDialog({
      title: `Send to ${targetCount} customers?`,
      message: `This will fire a REAL outbound SMS campaign to ${targetCount} customers in the "${selectedSegment}" segment from the F25e shop gateway (216-862-0005). Each customer counts toward their daily SMS cap. Opt-outs are filtered automatically. There is no undo.`,
      confirmLabel: `Send to ${targetCount}`,
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!ok) return;

    setCreating(true);
    try {
      const createResult = await createMutation.mutateAsync({
        name: campaignName,
        template: selectedTemplate,
        segment: selectedSegment,
        customMessage: customMessage || undefined,
      });

      if (createResult.success && createResult.campaignId) {
        // Immediately send the campaign
        const sendResult = await sendMutation.mutateAsync({
          campaignId: createResult.campaignId,
        });

        if (sendResult.success) {
          // wave-111 — was native alert(); now sonner toast (brand-consistent)
          toast.success(`Campaign sent to ${createResult.targetCount} customers`);
          setCampaignName("");
          setCustomMessage("");
          setPreview([]);
          await refetchCampaigns();
          setView("list");
        } else {
          toast.error(sendResult.error ?? "Send failed");
        }
      }
    } catch (e) {
      // wave-112 — surface the actual error message instead of "check console"
      // (which is unhelpful on mobile where console isn't accessible).
      console.error("Failed to create/send campaign:", e);
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error(`Campaign error: ${msg}`);
    } finally {
      setCreating(false);
    }
  }

  if (view === "create" || view === "preview") {
    return (
      <div className="space-y-6">
        {/* Header — wave-132 sentence case, refined typography */}
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-foreground tracking-tight">
            {view === "preview" ? "Review and send" : "New campaign"}
          </h3>
          <button
            onClick={() => {
              setView("list");
              setCampaignName("");
              setCustomMessage("");
              setPreview([]);
            }}
            className="inline-flex items-center justify-center w-8 h-8 -mr-1 text-foreground/45 hover:text-foreground hover:bg-foreground/5 rounded-md transition-colors"
            aria-label="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {view === "create" ? (
          <div className="space-y-6">
            {/* Campaign Name */}
            <div>
              <label className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-2">
                Campaign name
              </label>
              <input
                type="text"
                value={campaignName}
                onChange={e => setCampaignName(e.target.value)}
                placeholder="e.g., Spring Maintenance Reminder"
                className="w-full bg-card border border-border/30 px-4 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
              />
            </div>

            {/* Template Selection */}
            <div>
              <label className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-3">
                Template
              </label>
              <div className="grid grid-cols-2 gap-3">
                {(Object.keys(TEMPLATE_CONFIG) as Template[]).map(tmpl => (
                  <button
                    key={tmpl}
                    onClick={() => {
                      setSelectedTemplate(tmpl);
                      setPreview([]);
                    }}
                    className={`text-left p-3 border rounded transition-all ${
                      selectedTemplate === tmpl
                        ? "border-primary/50 bg-primary/5"
                        : "border-border/30 bg-card/50 hover:border-border/50"
                    }`}
                  >
                    <div className="flex items-start gap-2 mb-1">
                      {TEMPLATE_CONFIG[tmpl].icon}
                      <span className="font-mono text-xs font-semibold">{TEMPLATE_CONFIG[tmpl].label}</span>
                    </div>
                    <p className="text-xs text-foreground/50">{TEMPLATE_CONFIG[tmpl].description}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Segment Selection */}
            <div>
              <label className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-3">
                Target segment
              </label>
              <div className="grid grid-cols-3 gap-3">
                {(Object.keys(SEGMENT_CONFIG) as Segment[]).map(seg => (
                  <button
                    key={seg}
                    onClick={() => {
                      setSelectedSegment(seg);
                      setPreview([]);
                    }}
                    className={`text-left p-3 border rounded transition-all ${
                      selectedSegment === seg
                        ? "border-primary/50 bg-primary/5"
                        : "border-border/30 bg-card/50 hover:border-border/50"
                    }`}
                  >
                    <div className="font-mono text-xs font-semibold mb-1">{SEGMENT_CONFIG[seg].label}</div>
                    <p className="text-xs text-foreground/50">{SEGMENT_CONFIG[seg].description}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Message (Optional) */}
            <div>
              <label className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-2">
                Custom message <span className="normal-case tracking-normal text-foreground/30">(optional)</span>
              </label>
              <textarea
                value={customMessage}
                onChange={e => setCustomMessage(e.target.value)}
                placeholder="Leave blank to use template. Use {firstName} to personalize. Max 160 chars."
                maxLength={160}
                rows={3}
                className="w-full bg-card border border-border/30 px-4 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 resize-none"
              />
              <div className="text-xs text-foreground/40 mt-1">{customMessage.length}/160</div>
            </div>

            {/* 2026-05-23 · removed standalone "Preview Messages" button.
                It called handlePreview but stayed on the editor view —
                the preview content is only rendered when view==="preview",
                so the standalone click did invisible work. The action-row
                "Preview" below already calls handlePreview AND advances
                the view. One button, no duplicate. */}

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setView("list")}
                className="flex-1 px-4 py-2.5 bg-card/50 border border-border/30 text-foreground rounded hover:bg-card transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handlePreview().then(() => setView("preview"))}
                disabled={previewLoading || !campaignName.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/15 transition-colors disabled:opacity-50"
              >
                {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                Preview
              </button>
            </div>
          </div>
        ) : (
          /* Preview View */
          <div className="space-y-4">
            {/* Sample Messages */}
            <div className="space-y-3">
              <p className="font-mono text-xs text-foreground/50">
                Showing {preview.length} sample messages from {SEGMENT_CONFIG[selectedSegment].label}
              </p>

              {preview.map((item, idx) => (
                <div key={idx} className="bg-card/50 border border-border/30 p-4 rounded">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="font-semibold text-sm">{item.customer}</div>
                      <div className="text-xs text-foreground/50">{item.phone}</div>
                    </div>
                    <MessageSquare className="w-4 h-4 text-primary/50" />
                  </div>
                  <p className="text-sm text-foreground/80 leading-relaxed">{item.message}</p>
                </div>
              ))}
            </div>

            {/* Campaign Confirmation */}
            <div className="bg-primary/5 border border-primary/30 p-4 rounded space-y-2">
              <div className="font-mono text-xs font-semibold text-primary">READY TO SEND</div>
              <p className="text-sm text-foreground/70">
                Campaign will be sent to <strong>{campaignName}</strong> targeting{" "}
                <strong>{SEGMENT_CONFIG[selectedSegment].label}</strong>.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setView("create")}
                className="flex-1 px-4 py-2.5 bg-card/50 border border-border/30 text-foreground rounded hover:bg-card transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleCreateAndSend}
                disabled={creating || preview.length === 0}
                title={preview.length === 0 ? "No customers in this segment — nothing to send" : undefined}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded hover:bg-emerald-500/15 transition-colors disabled:opacity-50"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send Campaign
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // List View — wave-132 minimalist refresh
  return (
    <div className="space-y-6">
      {/* Header & Create Button — canonical PageHeader (matches sibling outreach tabs) */}
      <PageHeader
        title="Campaigns"
        subtitle="Schedule + send bulk SMS · routes through F25e shop gateway (216-862-0005)"
        icon={<MessageSquare className="w-5 h-5" />}
        actions={
          <button
            onClick={() => setView("create")}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-primary text-primary-foreground rounded-md text-[13px] font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New campaign</span>
          </button>
        }
      />

      {/* Stats Grid — 2×2 on mobile, 4×1 on lg */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total" value={stats?.totalCampaigns ?? 0} icon={<MessageSquare className="w-4 h-4" />} />
        <StatCard label="Active" value={stats?.activeCampaigns ?? 0} icon={<Clock className="w-4 h-4" />} color={stats?.activeCampaigns ? "text-amber-400" : "text-foreground"} />
        <StatCard label="Sent" value={stats?.totalSent ?? 0} icon={<CheckCircle2 className="w-4 h-4" />} color="text-emerald-400" />
        <StatCard label="Failed" value={stats?.totalFailed ?? 0} icon={<AlertCircle className="w-4 h-4" />} color={stats?.totalFailed ? "text-red-400" : "text-foreground/50"} />
      </div>

      {/* Campaigns List */}
      <div className="space-y-2">
        {campaigns && campaigns.length > 0 ? (
          campaigns.map((campaign: Campaign) => (
            <CampaignRow key={campaign.id} campaign={campaign} />
          ))
        ) : (
          <div className="bg-card border border-border/30 py-12 px-6 text-center">
            <MessageSquare className="w-8 h-8 text-foreground/15 mx-auto mb-3" />
            <h4 className="text-foreground/70 font-medium tracking-tight">No campaigns yet</h4>
            <p className="text-foreground/40 text-[13px] mt-1 max-w-sm mx-auto">
              Schedule your first SMS broadcast to a customer segment — maintenance reminder, special offer, or win-back.
            </p>
            <button
              onClick={() => setView("create")}
              className="mt-5 inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-[13px] font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Create first campaign
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CampaignRow({ campaign }: { campaign: Campaign }) {
  const { data: detail } = trpc.campaigns.getById.useQuery({ id: campaign.id });

  const statusConfig: Record<string, { color: string; icon: React.ReactNode }> = {
    draft: { color: "text-foreground/50", icon: <Clock className="w-4 h-4" /> },
    active: { color: "text-amber-400", icon: <Loader2 className="w-4 h-4 animate-spin" /> },
    completed: { color: "text-emerald-400", icon: <CheckCircle2 className="w-4 h-4" /> },
  };

  const config = statusConfig[campaign.status] || statusConfig.draft;
  const sentPercent = campaign.targetCount > 0 ? Math.round((campaign.sentCount / campaign.targetCount) * 100) : 0;

  return (
    <div className="bg-card/50 border border-border/30 p-4 rounded hover:border-border/50 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-semibold text-sm">{campaign.name}</h4>
            <span className={`font-mono text-xs px-2 py-1 rounded bg-foreground/5 ${config.color}`}>
              {campaign.status.toUpperCase()}
            </span>
          </div>
          <p className="text-xs text-foreground/50">
            Template: {TEMPLATE_CONFIG[campaign.template as Template].label} • Segment:{" "}
            {SEGMENT_CONFIG[campaign.segment as Segment].label}
          </p>
        </div>
        <div className={config.color}>{config.icon}</div>
      </div>

      {/* Progress Bar */}
      <div className="mt-3 space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-foreground/50">
            {campaign.sentCount}/{campaign.targetCount}
          </span>
          <span className="text-foreground/50">{sentPercent}%</span>
        </div>
        <div className="h-2 bg-foreground/10 rounded overflow-hidden">
          <div
            className="h-full bg-primary/50 transition-all"
            style={{ width: `${sentPercent}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      {detail && (
        <div className="mt-3 flex gap-4 text-xs text-foreground/60">
          <div>Failed: {detail.stats?.failed ?? 0}</div>
          <div>Pending: {detail.stats?.pending ?? 0}</div>
          <div className="text-foreground/30">Created {formatDate(campaign.createdAt)}</div>
        </div>
      )}
    </div>
  );
}
