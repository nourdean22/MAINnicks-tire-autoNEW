/**
 * Win-Back Campaigns Admin Section
 * Create, manage, and monitor automated SMS win-back sequences.
 */
import { useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";
import { StatCard, PageHeader, useUrlFilter, ErrorState, formatDate, formatDateTime } from "./shared";
// wave-181.x Outreach Phase 1 · confirmDialog on ACTIVATE + SEND
// PENDING + RESUME (each fires real SMS to potentially hundreds of
// customers · previously ungated). iOS-PWA-safe primitive.
import { confirmDialog } from "@/components/admin/ConfirmDialog";

// tRPC-inferred types — server router was fixed in same commit
// (drizzle $inferSelect on (c: any) leakages), so RouterOutputs
// resolves cleanly. campaignDetail returns null | { campaign, messages, stats }
// and we narrow to the non-null branch in the consumer before reading.
type PreviewRow = RouterOutputs["winback"]["preview"][number];
type CampaignDetailFull = NonNullable<RouterOutputs["winback"]["campaignDetail"]>;
type CampaignMessage = CampaignDetailFull["messages"][number];
type CampaignStepStat = CampaignDetailFull["stats"][number];
type RecentSend = RouterOutputs["winback"]["recentSends"][number];
type CampaignListItem = RouterOutputs["winback"]["campaigns"][number];
import {
  RotateCcw, Plus, Play, Pause, Eye, Send, CheckCircle2,
  XCircle, Clock, Users, AlertTriangle, ChevronRight, X,
  Loader2, MessageSquare, Zap
} from "lucide-react";

// 2026-05-23 · dropped "preview" — declared in the union + URL
// validator but no UI button set it and no render branch handled it.
// An old bookmark like ?wbView=preview silently fell back to list with
// the value lingering in URL state. Removed.
type View = "list" | "create" | "detail";

const SEGMENT_LABELS: Record<string, string> = {
  lapsed: "Lapsed (90-180d)",
  dormant: "Dormant (180-365d)",
  lost: "Lost (365d+)",
  vip: "VIP Customers",
  fleet: "Fleet/Commercial",
  recent: "Recent (30-90d)",
  tire_customer: "Tire Customers (180d+)",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  draft: { label: "Draft", color: "text-foreground/50", bgColor: "bg-foreground/5", icon: <Clock className="w-3.5 h-3.5" /> },
  active: { label: "Active", color: "text-emerald-400", bgColor: "bg-emerald-500/10", icon: <Play className="w-3.5 h-3.5" /> },
  paused: { label: "Paused", color: "text-amber-400", bgColor: "bg-amber-500/10", icon: <Pause className="w-3.5 h-3.5" /> },
  completed: { label: "Completed", color: "text-blue-400", bgColor: "bg-blue-500/10", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
};

function CreateCampaign({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState("");
  const [segment, setSegment] = useState<"lapsed" | "dormant" | "lost" | "vip" | "fleet" | "recent" | "tire_customer">("lapsed");
  const [creating, setCreating] = useState(false);

  const { data: segmentCounts } = trpc.winback.segmentCounts.useQuery();
  // 2026-05-23 · was bare. Caught by try/catch at the call site
  // (mutateAsync) which is fine for errors, but onSuccess was never
  // invalidating the campaigns list. Created campaign was invisible
  // from the list view until manual nav. Errors still bubble.
  const createMutationUtils = trpc.useUtils();
  const createMutation = trpc.winback.create.useMutation({
    onSuccess: () => createMutationUtils.winback.campaigns.invalidate(),
  });

  // wave-112 — was `as any`; now honest cast. customers.stats only
  // exposes a few of the win-back segment keys (lapsed, recent). For the
  // others (dormant, lost, vip, fleet) the lookup is undefined → 0.
  // Now we use winback.segmentCounts to show real counts.
  const stats = segmentCounts as Record<string, number> | undefined | null;
  const segmentCount = stats?.[segment] ?? 0;

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const result = await createMutation.mutateAsync({ name, targetSegment: segment });
      if (result.success && result.campaignId) {
        onCreated(result.campaignId);
      } else {
        // wave-112 — surface non-success path (was silent)
        toast.error("Campaign creation returned no campaignId");
      }
    } catch (e) {
      // wave-112 — was console.error only; operator now gets actionable feedback
      console.error("Failed to create campaign:", e);
      const msg = e instanceof Error ? e.message : "Unknown error creating campaign";
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-foreground tracking-tight">New win-back campaign</h3>
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
          <label className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-2">Target segment</label>
          {/* wave-133 — was grid-cols-4 fixed; many segments × ~79px wide
              at 375px = unusable touch targets. Mobile collapses to
              2 cols (~160px each), 4 cols only at sm+ (640px+). */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {/* wave-150 · "declined" removed — the 50/day declined-recovery cron now owns that pool (a winback campaign here would double-text it).
                "tire_customer" is revived with evidence-gated verification (requires last visit > 180d and prior tire service on invoices). */}
            {(["lapsed", "dormant", "lost", "vip", "fleet", "recent", "tire_customer"] as const).map(s => {
              const labels: Record<string, string> = {
                lapsed: "Lapsed (90-180d)", dormant: "Dormant (180-365d)", lost: "Lost (365d+)",
                vip: "VIP",
                fleet: "Fleet/Commercial", recent: "Recent (30-90d)",
                tire_customer: "Tire (180d+)",
              };
              const count = segmentCounts?.[s as keyof typeof segmentCounts] ?? "?";
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
                  <span className="font-bold text-[10px] tracking-wide text-foreground block leading-tight">
                    {labels[s] ?? s}
                  </span>
                  <span className="font-bold text-lg text-primary mt-1 block">{typeof count === "number" ? count : "?"}</span>
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
                <StepPreview step={1} delay="Immediately" desc="Re-engage: Your vehicle may be due, car problems get worse" />
                <StepPreview step={2} delay="Day 4" desc="Service reminder: Last service follow-up + free inspection" />
                <StepPreview step={3} delay="Day 10" desc="Urgency: Problems get expensive, free diagnostic this week" />
                <StepPreview step={4} delay="Day 21" desc="Final: We're here 7 days, drop off anytime" />
              </>
            )}
            {segment === "dormant" && (
              <>
                <StepPreview step={1} delay="Immediately" desc="6+ months: Free safety inspection for returning customers" />
                <StepPreview step={2} delay="Day 7" desc="Cost warning: $200 brake job → $800 rotor replacement" />
                <StepPreview step={3} delay="Day 14" desc="Final: No hard feelings, still here, 4.9★ 1700+ reviews" />
              </>
            )}
            {segment === "tire_customer" && (
              <>
                <StepPreview step={1} delay="Immediately" desc="6 months post-tire: Prompt free tire rotation" />
                <StepPreview step={2} delay="Day 7" desc="Follow-up check: Ensure even tire tread wear" />
              </>
            )}
            {segment === "lost" && (
              <>
                <StepPreview step={1} delay="Immediately" desc="Re-introduction: A lot has changed, come see what's new" />
                <StepPreview step={2} delay="Day 10" desc="Incentive: 10% off first service back" />
              </>
            )}
            {segment === "vip" && (
              <>
                <StepPreview step={1} delay="Immediately" desc="Personal: Nick checking in, you get priority service" />
                <StepPreview step={2} delay="Day 10" desc="Exclusive: Early access to seasonal deals" />
              </>
            )}
            {segment === "fleet" && (
              <>
                <StepPreview step={1} delay="Immediately" desc="Fleet services: 7 days, priority scheduling, fleet pricing" />
                <StepPreview step={2} delay="Day 7" desc="Downtime costs money: Same-day service for commercial" />
              </>
            )}
            {segment === "recent" && (
              <StepPreview step={1} delay="Immediately" desc="Thank you: Priority service, no appointment needed" />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <p className="text-foreground/40 text-xs">
            Campaign will target <span className="text-primary font-bold">{segmentCount ?? 0}</span> customers with personalized messages.
          </p>
          {/* 2026-05-23 · block create when segmentCount=0. The TODO at the
              top of this file flags that some segments lack a `customerStats`
              key and resolve to 0 — operator could otherwise ship a zero-
              target campaign that fires SMS at nobody. */}
          <button
            onClick={handleCreate}
            disabled={!name.trim() || creating || !segmentCount || segmentCount === 0}
            title={!segmentCount || segmentCount === 0 ? "No customers in this segment yet — pick another segment or wait for the lapsed cohort to grow" : undefined}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

function SafetyGateModal({
  campaign,
  messages,
  onConfirm,
  onClose,
  isPending
}: {
  campaign: CampaignListItem;
  messages: CampaignMessage[];
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [check1, setCheck1] = useState(false);
  const [check2, setCheck2] = useState(false);
  const [check3, setCheck3] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const { data: readiness, isLoading: readinessLoading } = trpc.winback.campaignReadiness.useQuery({
    targetSegment: campaign.targetSegment as any,
    customMessages: messages.map(m => ({ step: m.step, delayDays: m.delayDays, body: m.body })),
  });

  const canExecute = check1 && check2 && check3 && confirmText === "CONFIRM";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-card border border-border/40 rounded-xl p-6 shadow-2xl space-y-5 flex flex-col max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/10 pb-3">
          <h3 className="text-sm font-bold text-red-400 uppercase tracking-wider flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            Win-back Campaign Safety Gate
          </h3>
          <button onClick={onClose} className="text-foreground/40 hover:text-foreground/70 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {readinessLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            {/* Readiness Summary */}
            <div className="grid grid-cols-2 gap-3 p-3 bg-foreground/[0.02] border border-border/10 rounded-lg">
              <div>
                <span className="font-mono text-[9px] text-foreground/40 tracking-wider block">NET TARGET AUDIENCE</span>
                <span className="text-lg font-bold text-foreground tabular-nums">
                  {readiness?.netTargetCount ?? 0} Customers
                </span>
                <span className="text-[10px] text-foreground/45 block mt-0.5">Excludes opted-out numbers</span>
              </div>
              <div>
                <span className="font-mono text-[9px] text-foreground/40 tracking-wider block">PROJECTED CAMPAIGN VALUE</span>
                <span className="text-lg font-bold text-emerald-400 tabular-nums">
                  ${Math.round((readiness?.projectedValueCents ?? 0) / 100).toLocaleString()}
                </span>
                <span className="text-[10px] text-foreground/45 block mt-0.5">Based on 5% projected conversion</span>
              </div>
            </div>

            {/* Live Message Preview */}
            {readiness?.previewMessages && readiness.previewMessages.length > 0 && (
              <div className="bg-foreground/[0.01] border border-border/10 p-3 rounded-lg space-y-2">
                <span className="font-mono text-[9px] text-foreground/40 tracking-wider block">
                  LIVE MESSAGE PREVIEW (STEP 1 PERSONALIZED)
                </span>
                <p className="text-xs text-foreground/80 leading-relaxed bg-card/50 p-2.5 border border-border/5 rounded font-mono">
                  {readiness.previewMessages[0]?.body}
                </p>
              </div>
            )}

            {/* Safety Checklist */}
            <div className="space-y-2.5">
              <span className="font-mono text-[9px] text-foreground/40 tracking-wider block">SAFETY CHECKLIST</span>
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={check1}
                  onChange={(e) => setCheck1(e.target.checked)}
                  className="mt-0.5 accent-primary"
                />
                <span className="text-xs text-foreground/70">
                  I verify that the campaign message copy is accurate, professional, and free of double negatives or debug placeholders.
                </span>
              </label>
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={check2}
                  onChange={(e) => setCheck2(e.target.checked)}
                  className="mt-0.5 accent-primary"
                />
                <span className="text-xs text-foreground/70">
                  I confirm that this targets the correct customer segment (<span className="font-semibold text-primary">{campaign.targetSegment}</span>) and respects quiet hours.
                </span>
              </label>
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={check3}
                  onChange={(e) => setCheck3(e.target.checked)}
                  className="mt-0.5 accent-primary"
                />
                <span className="text-xs text-foreground/70">
                  I understand that activating this campaign will queue real outbound SMS sends to <span className="font-semibold text-foreground">{readiness?.netTargetCount ?? 0}</span> customers.
                </span>
              </label>
            </div>

            {/* Confirmation input */}
            <div className="space-y-2 border-t border-border/10 pt-3.5">
              <label className="font-mono text-[9px] text-foreground/40 tracking-wide block">
                TYPE "CONFIRM" TO UNLOCK EXECUTION
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type CONFIRM here"
                className="w-full bg-card border border-border/30 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-red-500/50 rounded uppercase tracking-wider"
              />
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 border-t border-border/10 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-border/20 text-xs font-bold tracking-wide hover:bg-foreground/5 transition-all text-foreground/70"
          >
            CANCEL
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canExecute || isPending}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-2 font-bold text-xs tracking-wide transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            ACTIVATE CAMPAIGN
          </button>
        </div>
      </div>
    </div>
  );
}

function CampaignDetail({ campaignId, onBack }: { campaignId: number; onBack: () => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.winback.campaignDetail.useQuery({ id: campaignId });
  const { data: preview } = trpc.winback.preview.useQuery({ campaignId });
  const { data: recentSends } = trpc.winback.recentSends.useQuery({ campaignId, limit: 20 });
  const [isSafetyGateOpen, setIsSafetyGateOpen] = useState(false);

  // 2026-05-23 · 4 mutations send actual SMS to customers. Silent
  // failure here = real money risk (operator believes campaign is
  // active, no SMS goes out). Added onSuccess toasts + onError so
  // any failure surfaces.
  const activateMutation = trpc.winback.activate.useMutation({
    onSuccess: () => {
      utils.winback.campaignDetail.invalidate({ id: campaignId });
      utils.winback.campaigns.invalidate();
      utils.winback.campaignStats.invalidate();
      toast.success("Campaign activated");
    },
    onError: (e) => toast.error(`Activate failed: ${e.message}`),
  });
  const pauseMutation = trpc.winback.pause.useMutation({
    onSuccess: () => {
      utils.winback.campaignDetail.invalidate({ id: campaignId });
      utils.winback.campaigns.invalidate();
      toast.success("Campaign paused");
    },
    onError: (e) => toast.error(`Pause failed: ${e.message}`),
  });
  const resumeMutation = trpc.winback.resume.useMutation({
    onSuccess: () => {
      utils.winback.campaignDetail.invalidate({ id: campaignId });
      utils.winback.campaigns.invalidate();
      toast.success("Campaign resumed");
    },
    onError: (e) => toast.error(`Resume failed: ${e.message}`),
  });
  const processMutation = trpc.winback.processPending.useMutation({
    onSuccess: (r) => {
      utils.winback.campaignDetail.invalidate({ id: campaignId });
      utils.winback.recentSends.invalidate({ campaignId });
      utils.winback.campaignStats.invalidate();
      const sent = (r as { sent?: number } | undefined)?.sent ?? 0;
      toast.success(`Queue processed — ${sent} SMS sent`);
    },
    onError: (e) => toast.error(`Process failed: ${e.message}`),
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
      {isSafetyGateOpen && (
        <SafetyGateModal
          campaign={campaign}
          messages={messages}
          isPending={activateMutation.isPending}
          onClose={() => setIsSafetyGateOpen(false)}
          onConfirm={() => {
            activateMutation.mutate({ campaignId }, {
              onSuccess: () => {
                setIsSafetyGateOpen(false);
              }
            });
          }}
        />
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-foreground/30 hover:text-foreground/60 transition-colors">
            <ChevronRight className="w-5 h-5 rotate-180" />
          </button>
          <div>
            <h3 className="text-[16px] font-semibold text-foreground tracking-tight">{campaign.name}</h3>
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
              onClick={() => setIsSafetyGateOpen(true)}
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
                onClick={async () => {
                  // wave-181.x Outreach Phase 1 · safety gate · "SEND
                  // PENDING" fires the next scheduled step to ALL
                  // customers currently in the sequence. Was ungated.
                  const pendingCount = campaign.pendingCount ?? campaign.targetCount ?? 0;
                  const ok = await confirmDialog({
                    title: `Send next step to ${pendingCount} customers?`,
                    message: `This fires the next scheduled SMS step to every customer currently in the active sequence (${pendingCount} pending). Real outbound · respects quiet hours + opt-out + daily cap. No undo.`,
                    confirmLabel: `Send to ${pendingCount}`,
                    cancelLabel: "Cancel",
                    tone: "danger",
                  });
                  if (!ok) return;
                  processMutation.mutate();
                }}
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
        {stats.map((s: CampaignStepStat) => (
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
          {messages.map((msg: CampaignMessage) => (
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
            {preview.map((p: PreviewRow, i: number) => (
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
                {recentSends.map((s: RecentSend) => (
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
                      {formatDateTime(s.scheduledAt)}
                    </td>
                    <td className="p-3 text-[10px] text-foreground/40 hidden md:table-cell">
                      {formatDateTime(s.sentAt)}
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
  // URL-persistent ?wbView=list|create|detail (default list).
  // 2026-05-23 · "preview" dropped from union — see comment on View type.
  const [view, setView] = useUrlFilter<View>(
    "wbView", "list",
    { validate: (v) => (["list", "create", "detail"].includes(v) ? (v as View) : null) },
  );
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);

  const { data: stats } = trpc.winback.campaignStats.useQuery();
  const { data: campaigns, isLoading, isError, refetch } = trpc.winback.campaigns.useQuery();

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
      <PageHeader
        title="Win-Back Campaigns"
        subtitle="Multi-step SMS sequences for lapsed customers · 30/60/90/180-day cohorts · campaign performance + recent sends"
        icon={<RotateCcw className="w-5 h-5" />}
      />
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
      ) : isError ? (
        <ErrorState message="Couldn't load win-back campaigns" onRetry={() => refetch()} />
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
          {campaigns.map((c: CampaignListItem) => {
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
                      {formatDate(c.createdAt)}
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
