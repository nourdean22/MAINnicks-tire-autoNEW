/**
 * Win-Back Campaigns Admin Section
 * Create, manage, and monitor automated SMS win-back sequences.
 */
import { useEffect, useRef, useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";
import { StatCard, PageHeader, useUrlFilter, ErrorState, formatDate, formatDateTime } from "../shared";
// wave-181.x Outreach Phase 1 · confirmDialog on ACTIVATE + SEND
// PENDING + RESUME (each fires real SMS to potentially hundreds of
// customers · previously ungated). iOS-PWA-safe primitive.
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useReviewStats } from "@/hooks/useReviewStats";
import { LAPSED_REGULAR_RULE } from "@shared/customerSegments";

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

type Segment = "lapsed_regulars" | "lapsed" | "dormant" | "lost" | "vip" | "fleet" | "recent" | "tire_customer";
type SegmentCounts = RouterOutputs["winback"]["segmentCounts"];

// Picker order: the Customers tab's shared rule first, since its "Open Win-Back" link lands here.
// Each rule says in words what buildSegmentFilter (server/routers/winback.ts) selects.
// wave-150 · "declined" stays out: the declined-recovery cron owns that pool.
const SEGMENTS: { id: Segment; label: string; rule: string }[] = [
  { id: "lapsed_regulars", label: "Lapsed regulars", rule: LAPSED_REGULAR_RULE },
  { id: "lapsed", label: "Lapsed (90-180d)", rule: "last visit 90 to 180 days ago, any number of visits" },
  { id: "dormant", label: "Dormant (180-365d)", rule: "last visit 180 to 365 days ago" },
  { id: "lost", label: "Lost (365d+)", rule: "last visit more than 365 days ago" },
  { id: "vip", label: "VIP", rule: "lifetime spend over $2,000" },
  { id: "fleet", label: "Fleet/Commercial", rule: "lifetime spend over $5,000" },
  { id: "recent", label: "Recent (30-90d)", rule: "last visit 30 to 90 days ago" },
  { id: "tire_customer", label: "Tire (180d+)", rule: "a tire job on record, last visit more than 180 days ago" },
];
const SEGMENT_LABELS: Record<string, string> = Object.fromEntries(SEGMENTS.map((s) => [s.id, s.label]));
const SEGMENT_RULES: Record<string, string> = Object.fromEntries(SEGMENTS.map((s) => [s.id, s.rule]));

/** How many people a sequence on `s` would text (the can-be-texted count); undefined = unknown. */
function reachOf(counts: SegmentCounts | undefined, s: Segment): number | undefined {
  if (!counts) return undefined;
  return s === "lapsed_regulars" ? counts.lapsed_regulars.contactable : counts[s];
}

function SegmentPicker({ value, onChange }: { value: Segment; onChange: (s: Segment) => void }) {
  const { data: counts, isLoading } = trpc.winback.segmentCounts.useQuery();
  // A failed read is unknown, never "?" or 0. Cached data survives a failed background refetch.
  const unknown = !counts && !isLoading;
  return (
    <div>
      <p id="wb-audience" className="text-[11px] text-foreground/50 font-medium mb-2">Audience</p>
      <div role="group" aria-labelledby="wb-audience" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {SEGMENTS.map((s) => {
          const countLine = !counts
            ? (isLoading ? "counting…" : "counts unknown")
            : s.id === "lapsed_regulars"
              ? `${counts.lapsed_regulars.qualifying} qualify · ${counts.lapsed_regulars.contactable} can be texted`
              : `${counts[s.id]} targets`;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={value === s.id}
              onClick={() => onChange(s.id)}
              className={`min-h-11 px-3 py-2 border text-left transition-colors ${s.id === "lapsed_regulars" ? "col-span-2" : ""} ${
                value === s.id ? "border-primary bg-primary/5" : "border-border/30 bg-card hover:border-border/50"
              }`}
            >
              <span className="block text-[13px] font-semibold text-foreground leading-tight">{s.label}</span>
              {s.id === "lapsed_regulars" && <span className="block text-[12px] text-foreground/60 mt-0.5">{s.rule}</span>}
              <span className={`block text-[12px] mt-1 tabular-nums ${unknown ? "text-amber-400" : "text-primary"}`}>{countLine}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-foreground/45 mt-2 leading-snug">
        {value === "lapsed_regulars" ? "The same rule the Customers tab counts." : `${SEGMENT_LABELS[value]}: ${SEGMENT_RULES[value]}.`}{" "}
        Targets match the rule and can be texted (not opted out).
      </p>
    </div>
  );
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  draft: { label: "Draft", color: "text-foreground/50", bgColor: "bg-foreground/5", icon: <Clock className="w-3.5 h-3.5" /> },
  active: { label: "Active", color: "text-emerald-400", bgColor: "bg-emerald-500/10", icon: <Play className="w-3.5 h-3.5" /> },
  paused: { label: "Paused", color: "text-amber-400", bgColor: "bg-amber-500/10", icon: <Pause className="w-3.5 h-3.5" /> },
  completed: { label: "Completed", color: "text-blue-400", bgColor: "bg-blue-500/10", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
};

function CreateCampaign({ segment, onSegmentChange, onClose, onCreated }: {
  segment: Segment;
  onSegmentChange: (s: Segment) => void;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  // A rejected create stays on screen in words beside the button; the form keeps its state.
  const [createError, setCreateError] = useState<string | null>(null);
  // Mirrors the live numbers the real step-3 SMS renders, so the operator
  // previewing a sequence sees exactly what the customer will receive.
  const { ratingDisplay: reviewRating, countDisplay: reviewCountDisplay } = useReviewStats();

  const { data: segmentCounts } = trpc.winback.segmentCounts.useQuery();
  // 2026-05-23 · was bare. Caught by try/catch at the call site
  // (mutateAsync) which is fine for errors, but onSuccess was never
  // invalidating the campaigns list. Created campaign was invisible
  // from the list view until manual nav. Errors still bubble.
  const createMutationUtils = trpc.useUtils();
  const createMutation = trpc.winback.create.useMutation({
    onSuccess: () => createMutationUtils.winback.campaigns.invalidate(),
  });

  // The can-be-texted count for the chosen audience; undefined while unknown.
  const reach = reachOf(segmentCounts, segment);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createMutation.mutateAsync({ name, targetSegment: segment });
      if (result.success && result.campaignId) {
        onCreated(result.campaignId);
      } else {
        // wave-112 — surface non-success path (was silent)
        setCreateError("the server returned no campaign id");
        toast.error("Campaign creation returned no campaignId");
      }
    } catch (e) {
      // wave-112 — was console.error only; operator now gets actionable feedback
      console.error("Failed to create campaign:", e);
      const msg = e instanceof Error ? e.message : "Unknown error creating campaign";
      setCreateError(msg);
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

        <SegmentPicker value={segment} onChange={onSegmentChange} />

        <div className="bg-card border border-border/30 p-4">
          <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-2">Auto-Generated Message Sequence</span>
          <div className="space-y-3">
            {/* Lapsed regulars get the lapsed sequence verbatim (server withLapsedRegulars). */}
            {(segment === "lapsed" || segment === "lapsed_regulars") && (
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
                <StepPreview step={3} delay="Day 14" desc={`Final: No hard feelings, still here, ${reviewRating}★ ${reviewCountDisplay} reviews`} />
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

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <p className="text-foreground/50 text-xs">
            {reach === undefined
              ? "Audience count unknown. A campaign can be created once the count loads."
              : <>This draft would go to <span className="text-primary font-bold">{reach}</span> people who can be texted. Nothing sends until you activate it.</>}
          </p>
          {/* 2026-05-23 · block create when the audience is 0 (a zero-target campaign
              texts nobody); an unknown count blocks too: unknown is not an audience. */}
          <button
            onClick={handleCreate}
            disabled={!name.trim() || creating || !reach}
            title={!reach ? "No one in this audience can be texted yet, or the count is unknown: pick another audience" : undefined}
            className="flex min-h-11 items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            CREATE CAMPAIGN
          </button>
        </div>
        {createError && (
          <p role="alert" className="text-[12px] text-red-400 leading-snug">
            {"Couldn't create the campaign: "}{createError}
          </p>
        )}
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
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Focus trap + Escape close + focus restore — same a11y contract every
  // other overlay gets via useFocusTrap. Modal only mounts while open.
  useFocusTrap(panelRef, true, { onEscape: onClose });

  // Lock body scroll while the modal is mounted (same pattern as SiteNavbar).
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const { data: readiness, isLoading: readinessLoading, isError: readinessError } = trpc.winback.campaignReadiness.useQuery({
    targetSegment: campaign.targetSegment as any,
    customMessages: messages.map(m => ({ step: m.step, delayDays: m.delayDays, body: m.body })),
  });

  /**
   * COMPARE WHAT THE OPERATOR SEES.
   *
   * The input below carried the CSS class `uppercase` until Admin UI v1 W1, which is
   * `text-transform` — purely VISUAL. `e.target.value` is still exactly what was
   * typed. So typing "confirm" DISPLAYS "CONFIRM" while confirmText stays
   * "confirm", `confirmText === "CONFIRM"` is false, and ACTIVATE CAMPAIGN sits
   * disabled with every checkbox green and the word CONFIRM visibly in the box.
   *
   * Reported live 2026-07-20: "it wont let me click activate", with a screenshot
   * showing all three checks ticked and CONFIRM in the field. The screen was
   * showing a value it was not holding, and there was nothing on it to reveal
   * the difference — the operator had no way to debug their own correct input.
   *
   * `.trim()` covers the other half: a phone keyboard's trailing space, or an
   * autocomplete that appends one, would have failed the same way just as
   * invisibly.
   *
   * The typed confirmation is still a real gate — it just now agrees with the
   * rendering. Weakening it to case-insensitive costs nothing: the whole point
   * is deliberate intent, and nobody types "confirm" by accident.
   */
  // Fail-closed: an errored/absent readiness lookup keeps the destructive
  // ACTIVATE locked — an unknown audience is not an audience of zero.
  const canExecute = check1 && check2 && check3 && confirmText.trim().toUpperCase() === "CONFIRM" && !readinessError && readiness != null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Win-back campaign safety gate"
        className="w-full max-w-xl bg-card border border-border/40 rounded-xl p-6 shadow-2xl space-y-5 flex flex-col max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/10 pb-3">
          <h3 className="text-sm font-bold text-red-400 flex items-center gap-2">
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
        ) : readinessError || !readiness ? (
          /* Truthful fail-closed: a failed readiness lookup must NOT render
             as "0 Customers" / "$0" tiles — unknown is not zero. canExecute
             is gated on this too, so ACTIVATE stays locked. */
          <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-400/30 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200 leading-relaxed">
              Audience unreadable: this is a failed lookup, NOT zero customers. Fix the connection before activating.
            </p>
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
                  I confirm that this targets the correct customer segment (<span className="font-semibold text-primary">{SEGMENT_LABELS[campaign.targetSegment] ?? campaign.targetSegment}</span>) and respects quiet hours.
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
                className="w-full bg-card border border-border/30 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-red-500/50 rounded"
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
  const { data, isLoading, error } = trpc.winback.campaignDetail.useQuery({ id: campaignId });
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
      toast.success(`Queue processed · ${sent} SMS sent`);
    },
    onError: (e) => toast.error(`Process failed: ${e.message}`),
  });

  // forensic-audit MEDIUM · was `if (isLoading || !data) <spinner>` with no
  // error branch, so a failed campaignDetail query (500 / network drop) left
  // the operator on an endless spinner. Surface the error + a way back.
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <p className="text-sm text-red-400">Failed to load campaign: {error.message}</p>
        <button onClick={onBack} className="px-3 py-1.5 border border-border bg-card rounded text-xs hover:bg-accent transition-colors">Back</button>
      </div>
    );
  }

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
                {SEGMENT_LABELS[campaign.targetSegment]} · {campaign.targetCount} targets
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
    { validate: (v: string) => (["list", "create", "detail"].includes(v) ? (v as View) : null) },
  );
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  // Held here so the list's picker and the create form share one choice.
  const [segment, setSegment] = useState<Segment>("lapsed_regulars");

  const { data: stats, isError: statsFailed } = trpc.winback.campaignStats.useQuery();
  // A failed read is unknown, not zero.
  const stat = (n: number | undefined) => (statsFailed ? "—" : n ?? 0);
  const { data: campaigns, isLoading, isError, refetch } = trpc.winback.campaigns.useQuery();

  function openDetail(id: number) {
    setSelectedCampaignId(id);
    setView("detail");
  }

  if (view === "create") {
    return (
      <CreateCampaign
        segment={segment}
        onSegmentChange={setSegment}
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
        subtitle="Multi-step text sequences for customers who stopped coming in. Nothing sends until you activate a campaign."
        icon={<RotateCcw className="w-5 h-5" />}
      />
      {/* Audience first: the Customers tab's "Open Win-Back" lands on the people it counted. */}
      <section className="bg-card border border-border/30 p-4 space-y-3">
        <SegmentPicker value={segment} onChange={setSegment} />
        <button
          type="button"
          onClick={() => setView("create")}
          className="flex min-h-11 items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Draft a sequence for this audience
        </button>
      </section>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard label="Total Campaigns" value={stat(stats?.totalCampaigns)} icon={<RotateCcw className="w-4 h-4" />} />
        <StatCard label="Active" value={stat(stats?.activeCampaigns)} icon={<Zap className="w-4 h-4" />} color="text-emerald-400" />
        <StatCard label="Messages Sent" value={stat(stats?.totalSent)} icon={<Send className="w-4 h-4" />} color="text-blue-400" />
        <StatCard label="Holdout" value={stat(stats?.totalHeldOut)} icon={<Clock className="w-4 h-4" />} />
        <StatCard label="Failed" value={stat(stats?.totalFailed)} icon={<XCircle className="w-4 h-4" />} color="text-red-400" />
        <StatCard label="Pending" value={stat(stats?.totalPending)} icon={<Clock className="w-4 h-4" />} color="text-amber-400" />
      </div>
      {statsFailed && (
        <p className="text-[12px] text-amber-400">{"Campaign stats couldn't load. The counts above are unknown, not zero."}</p>
      )}

      {/* The draft button moved up beside the audience picker it drafts for. */}
      <h3 className="font-bold text-sm text-foreground/60 tracking-wide">Campaigns</h3>

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
                  {/* The saved segment's rule in words, so an old 90-180 day draft is not read as the shared rule. */}
                  <p className="text-[12px] text-foreground/55 leading-snug">
                    {SEGMENT_LABELS[c.targetSegment] ?? c.targetSegment}: {SEGMENT_RULES[c.targetSegment] ?? "rule not on file"}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-foreground/40">
                    <span className="font-mono text-[10px] tracking-wider">{c.targetCount} targets</span>
                    <span className="font-mono text-[10px] tracking-wider">{c.sentCount} sent</span>
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
