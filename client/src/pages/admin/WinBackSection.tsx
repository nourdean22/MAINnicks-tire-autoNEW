/**
 * Win-Back Campaigns Admin Section
 * Create, manage, and monitor automated SMS win-back sequences.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { StatCard } from "./shared";
import {
  RotateCcw, Plus, Play, Pause, Eye, Send, CheckCircle2,
  XCircle, Clock, Users, AlertTriangle, ChevronRight, X,
  Loader2, MessageSquare, Zap
} from "lucide-react";

type View = "list" | "create" | "detail" | "preview";

const SEGMENT_LABELS: Record<string, string> = {
  lapsed: "Lapsed Customers",
  unknown: "Unknown Segment",
  recent: "Recent Customers",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  draft: { label: "Draft", color: "text-foreground/50", bgColor: "bg-foreground/5", icon: <Clock className="w-3.5 h-3.5" /> },
  active: { label: "Active", color: "text-emerald-400", bgColor: "bg-emerald-500/10", icon: <Play className="w-3.5 h-3.5" /> },
  paused: { label: "Paused", color: "text-amber-400", bgColor: "bg-amber-500/10", icon: <Pause className="w-3.5 h-3.5" /> },
  completed: { label: "Completed", color: "text-blue-400", bgColor: "bg-blue-500/10", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
};

function CreateCampaign({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState("");
  const [segment, setSegment] = useState<"lapsed" | "unknown" | "recent">("lapsed");
  const [creating, setCreating] = useState(false);

  const { data: customerStats } = trpc.customers.stats.useQuery();
  const createMutation = trpc.winback.create.useMutation();

  const segmentCount = segment === "lapsed" ? customerStats?.lapsed
    : segment === "unknown" ? customerStats?.unknown
    : customerStats?.recent;

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const result = await createMutation.mutateAsync({ name, targetSegment: segment });
      if (result.success && result.campaignId) {
        onCreated(result.campaignId);
      }
    } catch (e) {
      console.error("Failed to create campaign:", e);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-lg text-foreground tracking-wider">CREATE WIN-BACK CAMPAIGN</h3>
        <button onClick={onClose} className="text-foreground/30 hover:text-foreground/60 transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-2">Campaign Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g., March 2026 Lapsed Customer Win-Back"
            className="w-full bg-card border border-border/30 px-4 py-2.5 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
          />
        </div>

        <div>
          <label className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-2">Target Segment</label>
          <div className="grid grid-cols-3 gap-3">
            {(["lapsed", "unknown", "recent"] as const).map(s => {
              const count = s === "lapsed" ? customerStats?.lapsed
                : s === "unknown" ? customerStats?.unknown
                : customerStats?.recent;
              return (
                <button
                  key={s}
                  onClick={() => setSegment(s)}
                  className={`p-4 border text-left transition-colors ${
                    segment === s
                      ? "border-primary bg-primary/5"
                      : "border-border/30 bg-card hover:border-border/50"
                  }`}
                >
                  <span className="font-bold text-xs tracking-wide text-foreground block">
                    {s === "lapsed" ? "Lapsed" : s === "unknown" ? "Unknown" : "Recent"}
                  </span>
                  <span className="font-bold text-2xl text-primary mt-1 block">{count ?? 0}</span>
                  <span className="font-mono text-[10px] text-foreground/40 tracking-wider">CUSTOMERS</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-card border border-border/30 p-4">
          <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-2">Auto-Generated Message Sequence</span>
          <div className="space-y-3">
            {segment === "lapsed" && (
              <>
                <StepPreview step={1} delay="Immediately" desc="Re-engagement: Remind them their vehicle may be due for maintenance" />
                <StepPreview step={2} delay="Day 5" desc="Value offer: Free check engine light diagnostics for returning customers" />
                <StepPreview step={3} delay="Day 12" desc="Safety check: Encourage them to ensure their vehicle is running safely" />
              </>
            )}
            {segment === "unknown" && (
              <>
                <StepPreview step={1} delay="Immediately" desc="Check-in: Let them know we have their vehicle on file" />
                <StepPreview step={2} delay="Day 7" desc="Seasonal: Spring vehicle checkup reminder" />
              </>
            )}
            {segment === "recent" && (
              <StepPreview step={1} delay="Immediately" desc="Loyalty: Thank them and share current specials" />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <p className="text-foreground/40 text-xs">
            Campaign will target <span className="text-primary font-bold">{segmentCount ?? 0}</span> customers with personalized messages.
          </p>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            CREATE CAMPAIGN
          </button>
        </div>
      </div>
    </div>
  );
}

function StepPreview({ step, delay, desc }: { step: number; delay: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-6 h-6 bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <span className="font-mono text-[10px] text-primary font-bold">{step}</span>
      </div>
      <div>
        <span className="font-mono text-[10px] text-primary tracking-wider">{delay}</span>
        <p className="text-sm text-foreground/60 mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

function CampaignDetail({ campaignId, onBack }: { campaignId: number; onBack: () => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.winback.campaignDetail.useQuery({ id: campaignId });
  const { data: preview } = trpc.winback.preview.useQuery({ campaignId });
  const { data: recentSends } = trpc.winback.recentSends.useQuery({ campaignId, limit: 20 });

  const activateMutation = trpc.winback.activate.useMutation({
    onSuccess: () => {
      utils.winback.campaignDetail.invalidate({ id: campaignId });
      utils.winback.campaigns.invalidate();
      utils.winback.campaignStats.invalidate();
    },
  });
  const pauseMutation = trpc.winback.pause.useMutation({
    onSuccess: () => {
      utils.winback.campaignDetail.invalidate({ id: campaignId });
      utils.winback.campaigns.invalidate();
    },
  });
  const resumeMutation = trpc.winback.resume.useMutation({
    onSuccess: () => {
      utils.winback.campaignDetail.invalidate({ id: campaignId });
      utils.winback.campaigns.invalidate();
    },
  });
  const processMutation = trpc.winback.processPending.useMutation({
    onSuccess: () => {
      utils.winback.campaignDetail.invalidate({ id: campaignId });
      utils.winback.recentSends.invalidate({ campaignId });
      utils.winback.campaignStats.invalidate();
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const { campaign, messages, stats } = data;
  const statusCfg = STATUS_CONFIG[campaign.status] || STATUS_CONFIG.draft;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-foreground/30 hover:text-foreground/60 transition-colors">
            <ChevronRight className="w-5 h-5 rotate-180" />
          </button>
          <div>
            <h3 className="font-bold text-lg text-foreground tracking-wider">{campaign.name}</h3>
            <div className="flex items-center gap-3 mt-1">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] tracking-wider ${statusCfg.color} ${statusCfg.bgColor}`}>
                {statusCfg.icon} {statusCfg.label.toUpperCase()}
              </span>
              <span className="font-mono text-[10px] text-foreground/40 tracking-wider">
                {SEGMENT_LABELS[campaign.targetSegment]} — {campaign.targetCount} targets
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {campaign.status === "draft" && (
            <button
              onClick={() => activateMutation.mutate({ campaignId })}
              disabled={activateMutation.isPending}
              className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 font-bold text-xs tracking-wide hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {activateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              ACTIVATE
            </button>
          )}
          {campaign.status === "active" && (
            <>
              <button
                onClick={() => processMutation.mutate()}
                disabled={processMutation.isPending}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {processMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                SEND PENDING
              </button>
              <button
                onClick={() => pauseMutation.mutate({ campaignId })}
                disabled={pauseMutation.isPending}
                className="flex items-center gap-2 bg-card border border-border/30 text-foreground/60 px-4 py-2 font-bold text-xs tracking-wide hover:text-foreground transition-colors disabled:opacity-50"
              >
                <Pause className="w-3.5 h-3.5" />
                PAUSE
              </button>
            </>
          )}
          {campaign.status === "paused" && (
            <button
              onClick={() => resumeMutation.mutate({ campaignId })}
              disabled={resumeMutation.isPending}
              className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 font-bold text-xs tracking-wide hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              RESUME
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Target Customers" value={campaign.targetCount} icon={<Users className="w-4 h-4" />} />
        <StatCard label="Messages Sent" value={campaign.sentCount} icon={<Send className="w-4 h-4" />} color="text-emerald-400" />
        {stats.map((s: any) => (
          <StatCard
            key={s.step}
            label={`Step ${s.step} Sent`}
            value={s.sent ?? 0}
            icon={<MessageSquare className="w-4 h-4" />}
            color="text-blue-400"
          />
        ))}
      </div>

      {/* Message Steps */}
      <div>
        <h4 className="font-mono text-[10px] text-foreground/40 tracking-wide mb-3">MESSAGE SEQUENCE</h4>
        <div className="space-y-3">
          {messages.map((msg: any) => (
            <div key={msg.id} className="bg-card border border-border/30 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-primary/10 flex items-center justify-center">
                    <span className="font-mono text-[10px] text-primary font-bold">{msg.step}</span>
                  </div>
                  <span className="font-bold text-xs text-foreground tracking-wider">STEP {msg.step}</span>
                </div>
                <span className="font-mono text-[10px] text-foreground/40 tracking-wider">
                  {msg.delayDays === 0 ? "IMMEDIATELY" : `DAY ${msg.delayDays}`}
                </span>
              </div>
              <p className="text-sm text-foreground/70 leading-relaxed">{msg.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Preview */}
      {preview && preview.length > 0 && (
        <div>
          <h4 className="font-mono text-[10px] text-foreground/40 tracking-wide mb-3">SAMPLE PREVIEWS (FIRST 5 CUSTOMERS)</h4>
          <div className="space-y-2">
            {preview.map((p: any, i: number) => (
              <div key={i} className="bg-card border border-border/30 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-foreground font-medium">{p.customer}</span>
                  <span className="font-mono text-[10px] text-foreground/40">{p.phone}</span>
                </div>
                <p className="text-xs text-foreground/50 leading-relaxed">{p.messages[0]?.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Sends */}
      {recentSends && recentSends.length > 0 && (
        <div>
          <h4 className="font-mono text-[10px] text-foreground/40 tracking-wide mb-3">RECENT SENDS</h4>
          <div className="bg-card border border-border/30 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/20">
                  <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide">Phone</th>
                  <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide">Step</th>
                  <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide">Status</th>
                  <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide hidden sm:table-cell">Scheduled</th>
                  <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide hidden md:table-cell">Sent</th>
                </tr>
              </thead>
              <tbody>
                {recentSends.map((s: any) => (
                  <tr key={s.id} className="border-b border-border/10">
                    <td className="p-3 text-[12px] text-foreground/60">{s.phone}</td>
                    <td className="p-3 text-[12px] text-foreground/60">{s.step}</td>
                    <td className="p-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] tracking-wider ${
                        s.status === "sent" ? "text-emerald-400 bg-emerald-500/10"
                          : s.status === "failed" ? "text-red-400 bg-red-500/10"
                          : "text-foreground/50 bg-foreground/5"
                      }`}>
                        {s.status === "sent" ? <CheckCircle2 className="w-3 h-3" /> : s.status === "failed" ? <XCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {s.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-3 text-[10px] text-foreground/40 hidden sm:table-cell">
                      {s.scheduledAt ? new Date(s.scheduledAt).toLocaleString() : "—"}
                    </td>
                    <td className="p-3 text-[10px] text-foreground/40 hidden md:table-cell">
                      {s.sentAt ? new Date(s.sentAt).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WinBackSection() {
  const [view, setView] = useState<View>("list");
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);

  const { data: stats } = trpc.winback.campaignStats.useQuery();
  const { data: campaigns, isLoading } = trpc.winback.campaigns.useQuery();

  function openDetail(id: number) {
    setSelectedCampaignId(id);
    setView("detail");
  }

  if (view === "create") {
    return (
      <CreateCampaign
        onClose={() => setView("list")}
        onCreated={(id) => {
          setSelectedCampaignId(id);
          setView("detail");
        }}
      />
    );
  }

  if (view === "detail" && selectedCampaignId) {
    return <CampaignDetail campaignId={selectedCampaignId} onBack={() => setView("list")} />;
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total Campaigns" value={stats?.totalCampaigns ?? 0} icon={<RotateCcw className="w-4 h-4" />} />
        <StatCard label="Active" value={stats?.activeCampaigns ?? 0} icon={<Zap className="w-4 h-4" />} color="text-emerald-400" />
        <StatCard label="Messages Sent" value={stats?.totalSent ?? 0} icon={<Send className="w-4 h-4" />} color="text-blue-400" />
        <StatCard label="Failed" value={stats?.totalFailed ?? 0} icon={<XCircle className="w-4 h-4" />} color="text-red-400" />
        <StatCard label="Pending" value={stats?.totalPending ?? 0} icon={<Clock className="w-4 h-4" />} color="text-amber-400" />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm text-foreground/60 tracking-wide">Campaigns</h3>
        <button
          onClick={() => setView("create")}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          NEW CAMPAIGN
        </button>
      </div>

      {/* Campaign List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : !campaigns || campaigns.length === 0 ? (
        <div className="bg-card border border-border/30 p-12 text-center">
          <RotateCcw className="w-10 h-10 text-foreground/20 mx-auto mb-4" />
          <h4 className="font-bold text-foreground/60 tracking-[-0.01em] mb-2">NO CAMPAIGNS YET</h4>
          <p className="text-foreground/40 text-sm max-w-md mx-auto">
            Create a win-back campaign to re-engage lapsed customers with automated SMS sequences.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c: any) => {
            const statusCfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.draft;
            return (
              <button
                key={c.id}
                onClick={() => openDetail(c.id)}
                className="w-full bg-card border border-border/30 p-4 flex items-center gap-4 hover:border-border/50 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-bold text-sm text-foreground tracking-wider">{c.name}</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] tracking-wider ${statusCfg.color} ${statusCfg.bgColor}`}>
                      {statusCfg.icon} {statusCfg.label.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-foreground/40">
                    <span className="font-mono text-[10px] tracking-wider">{SEGMENT_LABELS[c.targetSegment]}</span>
                    <span className="font-mono text-[10px] tracking-wider">{c.targetCount} TARGETS</span>
                    <span className="font-mono text-[10px] tracking-wider">{c.sentCount} SENT</span>
                    <span className="font-mono text-[10px] tracking-wider hidden sm:inline">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-foreground/20 shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
