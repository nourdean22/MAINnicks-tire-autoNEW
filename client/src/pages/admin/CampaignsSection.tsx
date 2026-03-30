/**
 * SMS Campaigns Admin Section
 * Create, manage, and track targeted SMS campaigns.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { StatCard } from "./shared";
import {
  Plus, Send, Clock, CheckCircle2, AlertCircle, Eye, X,
  Loader2, MessageSquare, Users, TrendingUp, ChevronRight,
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
  const [creating, setCreating] = useState(false);

  const { data: campaigns, refetch: refetchCampaigns } = trpc.campaigns.list.useQuery();
  const { data: stats } = trpc.campaigns.stats.useQuery();
  const previewQuery = trpc.campaigns.preview.useQuery(
    { template: selectedTemplate, segment: selectedSegment, customMessage: customMessage || undefined },
    { enabled: false }
  );
  const createMutation = trpc.campaigns.create.useMutation();
  const sendMutation = trpc.campaigns.send.useMutation();

  async function handlePreview() {
    setPreviewLoading(true);
    try {
      const result = await previewQuery.refetch();
      if (result.data) setPreview(result.data);
    } catch (e) {
      console.error("Failed to load preview:", e);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleCreateAndSend() {
    if (!campaignName.trim()) {
      alert("Please enter a campaign name");
      return;
    }

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
          alert(`Campaign created and sending to ${createResult.targetCount} customers!`);
          setCampaignName("");
          setCustomMessage("");
          setPreview([]);
          await refetchCampaigns();
          setView("list");
        }
      }
    } catch (e) {
      console.error("Failed to create/send campaign:", e);
      alert("Error creating campaign. Check console.");
    } finally {
      setCreating(false);
    }
  }

  if (view === "create" || view === "preview") {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg text-foreground tracking-wider">
            {view === "preview" ? "CAMPAIGN PREVIEW" : "CREATE SMS CAMPAIGN"}
          </h3>
          <button
            onClick={() => {
              setView("list");
              setCampaignName("");
              setCustomMessage("");
              setPreview([]);
            }}
            className="text-foreground/30 hover:text-foreground/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {view === "create" ? (
          <div className="space-y-6">
            {/* Campaign Name */}
            <div>
              <label className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-2">
                CAMPAIGN NAME
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
              <label className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-3">
                TEMPLATE
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
              <label className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-3">
                TARGET SEGMENT
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
              <label className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-2">
                CUSTOM MESSAGE (OPTIONAL)
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

            {/* Preview Button */}
            <button
              onClick={handlePreview}
              disabled={previewLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-card/50 border border-border/30 text-foreground rounded hover:bg-card transition-colors disabled:opacity-50"
            >
              {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
              Preview Messages
            </button>

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
                <Eye className="w-4 h-4" />
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
                disabled={creating}
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

  // List View
  return (
    <div className="space-y-6">
      {/* Header & Create Button */}
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-lg text-foreground tracking-wider">SMS CAMPAIGNS</h3>
        <button
          onClick={() => setView("create")}
          className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/15 transition-colors text-sm font-mono"
        >
          <Plus className="w-4 h-4" />
          New Campaign
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Total Campaigns"
          value={stats?.totalCampaigns ?? 0}
          icon={<MessageSquare className="w-5 h-5" />}
        />
        <StatCard
          label="Active"
          value={stats?.activeCampaigns ?? 0}
          icon={<Clock className="w-5 h-5" />}
        />
        <StatCard
          label="Sent"
          value={stats?.totalSent ?? 0}
          icon={<CheckCircle2 className="w-5 h-5" />}
        />
        <StatCard
          label="Failed"
          value={stats?.totalFailed ?? 0}
          icon={<AlertCircle className="w-5 h-5" />}
        />
      </div>

      {/* Campaigns List */}
      <div className="space-y-3">
        {campaigns && campaigns.length > 0 ? (
          campaigns.map(campaign => (
            <CampaignRow key={campaign.id} campaign={campaign} />
          ))
        ) : (
          <div className="text-center py-8 text-foreground/50 font-mono text-sm">
            No campaigns yet. Create one to get started.
          </div>
        )}
      </div>
    </div>
  );
}

function CampaignRow({ campaign }: { campaign: any }) {
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
          <div className="text-foreground/30">Created {new Date(campaign.createdAt).toLocaleDateString()}</div>
        </div>
      )}
    </div>
  );
}

export default CampaignsSection;
