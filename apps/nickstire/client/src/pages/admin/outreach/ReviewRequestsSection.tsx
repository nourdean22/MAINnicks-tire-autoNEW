/**
 * ReviewRequestsSection — admin panel for managing automated Google review SMS requests.
 * Shows stats, request list, settings, and backfill blast controls.
 */
import { useState, useMemo, useEffect } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";
import { StatCard, PageHeader, useUrlFilter, FilterChips, formatDate, formatDateTime } from "../shared";
// wave-181.x Outreach Phase 1 · confirmDialog gate on backfill blast +
// process queue (both fire real outbound SMS to dozens-to-hundreds of
// customers · previously ungated).
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import {
  Loader2, Star, Send, RefreshCw, CheckCircle2, XCircle,
  Clock, MousePointerClick, Settings, Zap, AlertTriangle,
  MessageSquare, ChevronDown, ChevronUp, Shield, Copy, Filter, Search,
} from "lucide-react";
import { GLOBAL_QUOTES, PROOF_CONFIG, type ProofQuote } from "@shared/proof";

type SettingsTab = "requests" | "settings" | "backfill" | "proofbank";
type ReviewRequest = RouterOutputs["reviewRequests"]["list"][number];
type BackfillBooking = RouterOutputs["reviewRequests"]["backfillPreview"]["bookings"][number];

export default function ReviewRequestsSection() {
  // URL-persistent ?reviewTab=requests|settings|backfill|proofbank (default requests)
  const [tab, setTab] = useUrlFilter<SettingsTab>(
    "reviewTab", "requests",
    { validate: (v: string) => (["requests", "settings", "backfill", "proofbank"].includes(v) ? (v as SettingsTab) : null) },
  );
  const utils = trpc.useUtils();

  // Data queries
  const { data: stats, isLoading: statsLoading, isError: statsError } = trpc.reviewRequests.stats.useQuery();
  const {
    data: requests,
    isLoading: requestsLoading,
    isError: requestsError,
    error: requestsErrorObj,
  } = trpc.reviewRequests.list.useQuery({ limit: 100 });

  /**
   * ROS-083 · this page's numbers gate a REAL outbound SMS run, so an
   * unreadable list is the one state that must never render as a calm zero.
   * `unknown` is tested BEFORE `!requests` because the query keeps its last
   * good data while isError is true — a `!requests` guard never fires on a
   * failed refetch, which is the common case.
   */
  const requestsUnknown = requestsError;
  const statsUnknown = statsError;
  const {
    data: settings,
    isLoading: settingsLoading,
    isError: settingsError,
    error: settingsErrorObj,
  } = trpc.reviewRequests.getSettings.useQuery();

  /**
   * ROS-084 · a settings FORM cannot use the em-dash idiom — an em dash on a
   * toggle means nothing, and a blank number input still submits. So the form is
   * DISABLED instead, Save included.
   *
   * The reason is a silent overwrite, not a display lie. The server used to
   * invent { enabled: 1, delayMinutes: 1440, maxPerDay: 20, cooldownDays: 30 }
   * on an unreadable database; the useEffect below seeds the form from whatever
   * `settings` resolves to; and Save posts the form. So a shop with the
   * programme deliberately OFF and a cap of 5 could have one tap during a blip
   * write ON and 20 over its real stored settings — losing the operator's own
   * decision to a literal in db.ts. Disabling the controls is what makes that
   * impossible rather than merely unlikely.
   *
   * ★ DATA-SHAPED, NOT ERROR-SHAPED, and that distinction is the whole guard.
   * `isError` alone leaves a hole on the operator's actual device: react-query
   * v5 defaults to networkMode "online", so an offline PWA PAUSES the query —
   * status pending, fetchStatus paused, therefore isLoading FALSE (it is
   * isPending && isFetching), isError FALSE, data undefined. The form would
   * render, the toggle would compute `(null ?? undefined) === 1` and paint
   * itself OFF, and one tap would fire updateSettings({ enabled: 1 }) — turning
   * the programme ON from a control that was showing OFF, on the exact device
   * and connection this admin is used from.
   */
  const settingsUnknown = settingsError || (!settingsLoading && !settings);
  const {
    data: backfillPreview,
    isLoading: backfillLoading,
    isError: backfillError,
    error: backfillErrorObj,
  } = trpc.reviewRequests.backfillPreview.useQuery();

  /**
   * ROS-084 follow-up · the Backfill tab is a preview plus ONE dangerous button,
   * so it needs a different treatment from both the stat cards and the settings
   * form. The false-green being fixed is the emerald CheckCircle2 reading "All
   * eligible customers have already been contacted" — a positive claim about
   * every customer served in the past year, rendered from a database nobody read.
   *
   * DATA-shaped, not error-shaped, for the reason established on the settings
   * query above: react-query v5 PAUSES a query on an offline device, which leaves
   * isLoading and isError both false with data undefined.
   */
  const backfillUnknown = backfillError || (!backfillLoading && !backfillPreview);

  // Mutations
  const updateSettings = trpc.reviewRequests.updateSettings.useMutation({
    onSuccess: () => {
      toast.success("Settings updated");
      utils.reviewRequests.getSettings.invalidate();
    },
    // 2026-05-23 · optimistic setFormEnabled at the click site means a
    // failed save left the toggle in the WRONG state visually (UI said
    // "enabled" while DB stayed disabled). Rollback to server truth on
    // error so the toggle reflects reality.
    onError: (err) => {
      toast.error(err.message);
      setFormEnabled(settings?.enabled ?? null);
    },
  });

  const processQueue = trpc.reviewRequests.processQueue.useMutation({
    onSuccess: (result) => {
      toast.success(`Queue processed: ${result.sent} sent, ${result.failed} failed`);
      utils.reviewRequests.list.invalidate();
      utils.reviewRequests.stats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const resend = trpc.reviewRequests.resend.useMutation({
    onSuccess: () => {
      toast.success("Review request re-queued");
      utils.reviewRequests.list.invalidate();
      utils.reviewRequests.stats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const backfillExecute = trpc.reviewRequests.backfillExecute.useMutation({
    onSuccess: (result) => {
      toast.success(`Backfill complete: ${result.scheduled} scheduled, ${result.skipped} skipped`);
      utils.reviewRequests.list.invalidate();
      utils.reviewRequests.stats.invalidate();
      utils.reviewRequests.backfillPreview.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  // Settings form state
  const [formEnabled, setFormEnabled] = useState<number | null>(null);
  const [formDelay, setFormDelay] = useState<string>("");
  const [formMaxPerDay, setFormMaxPerDay] = useState<string>("");
  const [formCooldown, setFormCooldown] = useState<string>("");
  const [formTemplate, setFormTemplate] = useState<string>("");
  const [showTemplate, setShowTemplate] = useState(false);

  // wave-152 — was an imperative initForm() called only on Settings tab
  // click. If the operator deep-linked into ?reviewTab=settings (the URL
  // is persistent), the form stayed empty-string and handleSaveSettings
  // sent NaN to the server via parseInt(""). Now: useEffect runs the
  // moment `settings` resolves regardless of tab, so the form is always
  // populated before submit. The deep-link path works correctly.
  useEffect(() => {
    if (settings) {
      setFormEnabled(settings.enabled);
      setFormDelay(String(settings.delayMinutes));
      setFormMaxPerDay(String(settings.maxPerDay));
      setFormCooldown(String(settings.cooldownDays));
      setFormTemplate(settings.messageTemplate || "");
    }
  }, [settings]);

  const handleSaveSettings = () => {
    // wave-112 — was Record<string, unknown> + `as any` cast; now typed
    // to match the actual zod schema on server/routers/reviewRequests.ts
    // L177-183. If a server-side rename happens, TS will catch it here
    // instead of silently dropping the field on the wire.
    const data: {
      enabled?: number;
      delayMinutes?: number;
      maxPerDay?: number;
      cooldownDays?: number;
      messageTemplate?: string | null;
    } = {};
    if (formEnabled !== null) data.enabled = formEnabled;
    if (formDelay) data.delayMinutes = parseInt(formDelay);
    if (formMaxPerDay) data.maxPerDay = parseInt(formMaxPerDay);
    if (formCooldown) data.cooldownDays = parseInt(formCooldown);
    if (formTemplate !== undefined) data.messageTemplate = formTemplate || null;
    updateSettings.mutate(data);
  };

  const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    pending: { label: "Pending", color: "text-blue-400", icon: <Clock className="w-3.5 h-3.5" /> },
    sent: { label: "Sent", color: "text-amber-400", icon: <Send className="w-3.5 h-3.5" /> },
    clicked: { label: "Clicked", color: "text-emerald-400", icon: <MousePointerClick className="w-3.5 h-3.5" /> },
    failed: { label: "Failed", color: "text-red-400", icon: <XCircle className="w-3.5 h-3.5" /> },
    skipped: { label: "Skipped", color: "text-foreground/40", icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Review Requests"
        subtitle="SMS review-asks fired post-service · proof bank · backfill controls. Review velocity = compounding social proof."
        icon={<Star className="w-5 h-5" />}
      />
      {statsUnknown && (
        <div className="border border-amber-500/40 bg-amber-500/10 p-4 text-[13px] text-amber-400">
          <strong>Review request stats could not be read.</strong> The tiles below are unknown — NOT zero. Nothing here means no request is pending and nothing has failed.
        </div>
      )}
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="Total Requests"
          value={statsUnknown ? "—" : statsLoading ? "..." : stats?.total ?? 0}
          icon={<MessageSquare className="w-5 h-5" />}
        />
        <StatCard
          label="Sent"
          value={statsUnknown ? "—" : statsLoading ? "..." : stats?.sent ?? 0}
          icon={<Send className="w-5 h-5" />}
          color="text-amber-400"
        />
        <StatCard
          label="Clicked"
          value={statsUnknown ? "—" : statsLoading ? "..." : stats?.clicked ?? 0}
          icon={<MousePointerClick className="w-5 h-5" />}
          color={statsUnknown ? "text-amber-400" : "text-emerald-400"}
        />
        <StatCard
          label="Click Rate"
          value={statsUnknown ? "—" : statsLoading ? "..." : `${stats?.clickRate ?? 0}%`}
          icon={<Star className="w-5 h-5" />}
          color={statsUnknown ? "text-amber-400" : "text-primary"}
        />
        <StatCard
          label="Pending"
          value={statsUnknown ? "—" : statsLoading ? "..." : stats?.pending ?? 0}
          icon={<Clock className="w-5 h-5" />}
          color={statsUnknown ? "text-amber-400" : "text-blue-400"}
        />
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-border/30 pb-0">
        {([
          { id: "requests" as const, label: "Review Requests", icon: <MessageSquare className="w-4 h-4" /> },
          { id: "settings" as const, label: "Settings", icon: <Settings className="w-4 h-4" /> },
          { id: "backfill" as const, label: "Backfill Blast", icon: <Zap className="w-4 h-4" /> },
          { id: "proofbank" as const, label: "Proof Bank", icon: <Shield className="w-4 h-4" /> },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-[12px] tracking-wide transition-colors border-b-2 -mb-[1px] ${
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-foreground/50 hover:text-foreground/80"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Requests Tab */}
      {tab === "requests" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-foreground/50 tracking-wide">
              {requestsUnknown ? "Review requests could not be read" : `${requests?.length ?? 0} review requests`}
            </span>
            <button
              onClick={async () => {
                // wave-181.x Outreach Phase 1 · safety gate · was firing
                // a real outbound SMS run with no confirmation.
                // review_requests.status enum = pending/sent/clicked/failed/skipped (no "scheduled");
                // the due column is scheduledAt. Mirror server-side getPendingReviewRequests().
                //
                // ROS-083 · the `?? 0` used to turn an unreadable list into
                // "~0 due now" INSIDE the dialog that authorises a real SMS
                // batch — the single most expensive false-green on this page,
                // because it is the number the operator reads before deciding
                // it is safe to click. The button stays enabled on purpose:
                // the server is the authority on what is actually due, and
                // disabling it would hide a queue that may be real. What
                // changes is that the dialog now says it does not know.
                const due = requestsUnknown
                  ? null
                  : requests?.filter((r: ReviewRequest) => r.status === "pending" && new Date(r.scheduledAt) <= new Date()).length ?? 0;
                const ok = await confirmDialog({
                  title: `Process the review-request queue?`,
                  message: due === null
                    ? `This runs ALL scheduled review requests that are due. The queue could NOT be read just now, so how many are due is UNKNOWN — it is not zero, and it may be a full batch. Each fires a real outbound SMS via F25e. Sends respect quiet-hours + opt-out + daily rate limit.`
                    : `This runs ALL scheduled review requests that are due (currently ~${due} due now). Each fires a real outbound SMS via F25e. Sends respect quiet-hours + opt-out + daily rate limit.`,
                  confirmLabel: "Process queue",
                  cancelLabel: "Cancel",
                  tone: "danger",
                });
                if (!ok) return;
                processQueue.mutate();
              }}
              disabled={processQueue.isPending}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-[12px] tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {processQueue.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Process Queue
            </button>
          </div>

          {requestsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : requestsUnknown ? (
            <div className="border border-amber-500/40 bg-amber-500/10 p-4 text-[13px] text-amber-400">
              <strong>The review-request queue could not be read.</strong> This is unknown — NOT empty. Nothing here means no customer is waiting on a review text. {requestsErrorObj?.message}
            </div>
          ) : !requests?.length ? (
            <div className="text-center py-12 text-foreground/40">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-[13px]">No review requests yet</p>
              <p className="text-[12px] mt-1">Requests are automatically created when bookings are marked as completed</p>
            </div>
          ) : (
            <div className="border border-border/30 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-card/50 border-b border-border/30">
                    <th className="text-left px-4 py-3 text-[10px] text-foreground/50 tracking-wide">Customer</th>
                    <th className="text-left px-4 py-3 text-[10px] text-foreground/50 tracking-wide">Service</th>
                    <th className="text-left px-4 py-3 text-[10px] text-foreground/50 tracking-wide">Status</th>
                    <th className="text-left px-4 py-3 text-[10px] text-foreground/50 tracking-wide">Scheduled</th>
                    <th className="text-left px-4 py-3 text-[10px] text-foreground/50 tracking-wide">Sent</th>
                    <th className="text-left px-4 py-3 text-[10px] text-foreground/50 tracking-wide">Clicked</th>
                    <th className="text-right px-4 py-3 text-[10px] text-foreground/50 tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req: ReviewRequest) => {
                    const sc = statusConfig[req.status] || statusConfig.pending;
                    return (
                      <tr key={req.id} className="border-b border-border/20 hover:bg-card/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{req.customerName}</div>
                          <div className="text-[12px] text-foreground/40">{req.phone}</div>
                        </td>
                        <td className="px-4 py-3 text-foreground/70 text-xs">{req.service || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 ${sc.color}`}>
                            {sc.icon}
                            <span className="text-[12px] tracking-wider">{sc.label}</span>
                          </span>
                          {req.errorMessage && (
                            <div className="text-red-400/70 text-[10px] mt-0.5 truncate max-w-[200px]" title={req.errorMessage}>
                              {req.errorMessage}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[12px] text-foreground/50">
                          {formatDateTime(req.scheduledAt)}
                        </td>
                        <td className="px-4 py-3 text-[12px] text-foreground/50">
                          {formatDateTime(req.sentAt)}
                        </td>
                        <td className="px-4 py-3 text-[12px] text-foreground/50">
                          {req.clickedAt ? (
                            <span className="text-emerald-400">{formatDateTime(req.clickedAt)}</span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {req.status === "failed" && (
                            <button
                              onClick={() => resend.mutate({ id: req.id })}
                              disabled={resend.isPending}
                              className="text-primary hover:text-primary/80 text-[12px] tracking-wider"
                            >
                              Resend
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {tab === "settings" && (
        <div className="space-y-6 max-w-xl">
          {settingsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : settingsUnknown ? (
            <div className="border border-amber-500/40 bg-amber-500/10 p-4 text-[13px] text-amber-400 space-y-2">
              <p>
                <strong>Review settings have not been read.</strong> They are unknown — the form is hidden rather than
                showing defaults, because saving invented values would overwrite your real stored settings, including
                whether review texts are enabled at all. Nothing here is changed until this reads again.
              </p>
              {/* The two shapes mean OPPOSITE things about the shop and must not
                  be collapsed. An error means the server could not read the row,
                  and the send loop reads the same row — so nothing is going out.
                  A paused query means THIS DEVICE is offline while the shop's
                  automation carries on exactly as configured. Telling the
                  operator "nothing is being sent" in the second case would be a
                  new false statement in place of the one being removed. */}
              <p className="text-amber-400/80">
                {settingsError
                  ? `The server could not read them, so the send loop cannot either — no review texts are going out while this persists. ${settingsErrorObj?.message ?? ""}`
                  : "This device has not reached the server. The shop's automation is unaffected and is still running on its stored settings."}
              </p>
            </div>
          ) : (
            <>
              {/* Enable/Disable Toggle */}
              <div className="flex items-center justify-between p-4 bg-card border border-border/30">
                <div>
                  <div className="font-bold text-foreground tracking-wider text-sm uppercase">Auto Review Requests</div>
                  <div className="text-[12px] text-foreground/50 mt-1">Automatically send review request SMS after service completion</div>
                </div>
                <button
                  onClick={() => {
                    const newVal = (formEnabled ?? settings?.enabled) === 1 ? 0 : 1;
                    setFormEnabled(newVal);
                    updateSettings.mutate({ enabled: newVal });
                  }}
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    (formEnabled ?? settings?.enabled) === 1 ? "bg-emerald-500" : "bg-foreground/20"
                  }`}
                >
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    (formEnabled ?? settings?.enabled) === 1 ? "translate-x-6" : "translate-x-0.5"
                  }`} />
                </button>
              </div>

              {/* Delay */}
              <div className="space-y-2">
                <label className="text-[12px] text-foreground/50 tracking-wide">
                  Delay After Completion (minutes)
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={formDelay !== "" ? formDelay : settings ? String(settings.delayMinutes) : ""}
                  onChange={(e) => setFormDelay(e.target.value)}
                  min={0}
                  max={10080}
                  className="w-full bg-card border border-border/30 px-4 py-2.5 text-foreground text-[13px] focus:outline-none focus:border-primary"
                />
                <p className="font-mono text-[10px] text-foreground/40">
                  How long to wait after marking a booking as "completed" before sending the review request. Default: 120 minutes (2 hours).
                </p>
              </div>

              {/* Max Per Day */}
              <div className="space-y-2">
                <label className="text-[12px] text-foreground/50 tracking-wide">
                  Maximum Requests Per Day
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={formMaxPerDay !== "" ? formMaxPerDay : settings ? String(settings.maxPerDay) : ""}
                  onChange={(e) => setFormMaxPerDay(e.target.value)}
                  min={1}
                  max={100}
                  className="w-full bg-card border border-border/30 px-4 py-2.5 text-foreground text-[13px] focus:outline-none focus:border-primary"
                />
                <p className="font-mono text-[10px] text-foreground/40">
                  Daily cap to avoid Twilio rate limits and keep messaging natural. Default: 20.
                </p>
              </div>

              {/* Cooldown Days */}
              <div className="space-y-2">
                <label className="text-[12px] text-foreground/50 tracking-wide">
                  Cooldown Period (days)
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={formCooldown !== "" ? formCooldown : settings ? String(settings.cooldownDays) : ""}
                  onChange={(e) => setFormCooldown(e.target.value)}
                  min={1}
                  max={365}
                  className="w-full bg-card border border-border/30 px-4 py-2.5 text-foreground text-[13px] focus:outline-none focus:border-primary"
                />
                <p className="font-mono text-[10px] text-foreground/40">
                  Minimum days between review requests to the same phone number. Prevents annoying repeat customers. Default: 30 days.
                </p>
              </div>

              {/* Custom Message Template */}
              <div className="space-y-2">
                <button
                  onClick={() => setShowTemplate(!showTemplate)}
                  className="flex items-center gap-2 text-[12px] text-foreground/50 tracking-wide hover:text-foreground/80"
                >
                  {showTemplate ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  Custom Message Template (Optional)
                </button>
                {showTemplate && (
                  <>
                    <textarea
                      value={formTemplate || settings?.messageTemplate || ""}
                      onChange={(e) => setFormTemplate(e.target.value)}
                      rows={4}
                      placeholder="Hi {firstName}, thanks for trusting us with your {service}! If you have 30 seconds, a Google review helps other Cleveland drivers find honest repair: {reviewUrl}"
                      className="w-full bg-card border border-border/30 px-4 py-2.5 text-foreground text-[13px] focus:outline-none focus:border-primary resize-none"
                    />
                    <p className="font-mono text-[10px] text-foreground/40">
                      Available placeholders: {"{firstName}"}, {"{service}"}, {"{reviewUrl}"}. Leave blank to use the default template.
                    </p>
                  </>
                )}
              </div>

              {/* Save Button */}
              <button
                onClick={handleSaveSettings}
                disabled={updateSettings.isPending}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 text-[12px] tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {updateSettings.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Save Settings
              </button>
            </>
          )}
        </div>
      )}

      {/* Backfill Blast Tab */}
      {tab === "backfill" && (
        <div className="space-y-6">
          <div className="bg-card border border-border/30 p-6">
            <div className="flex items-start gap-4">
              <div className="bg-primary/10 p-3">
                <Zap className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-foreground tracking-wider text-lg uppercase">
                  Backfill Review Requests
                </h3>
                <p className="text-foreground/60 text-sm mt-2 leading-relaxed">
                  Send review request texts to all customers from the past year who completed service but were never asked for a review.
                  Messages are staggered (2 minutes apart) to avoid Twilio rate limits and feel natural.
                </p>
                <p className="text-foreground/40 text-xs mt-2">
                  Customers who already received a review request (within the cooldown period) will be automatically skipped.
                </p>
              </div>
            </div>
          </div>

          {backfillLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <StatCard
                  label="Eligible Customers"
                  value={backfillUnknown ? "—" : backfillPreview?.count ?? 0}
                  icon={<Star className="w-5 h-5" />}
                  color={backfillUnknown ? "text-amber-400" : "text-primary"}
                />
                <StatCard
                  label="Preview (First 50)"
                  value={backfillUnknown ? "—" : backfillPreview?.bookings?.length ?? 0}
                  icon={<MessageSquare className="w-5 h-5" />}
                />
              </div>

              {/* `!backfillUnknown &&` for the same reason as the button below:
                  react-query retains data on a failed refetch, so without it a
                  STALE list of named customers renders directly under em-dash
                  tiles and an amber banner saying the count is unknown. */}
              {!backfillUnknown && backfillPreview?.bookings && backfillPreview.bookings.length > 0 && (
                <div className="border border-border/30 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-card/50 border-b border-border/30">
                        <th className="text-left px-4 py-3 text-[10px] text-foreground/50 tracking-wide">Customer</th>
                        <th className="text-left px-4 py-3 text-[10px] text-foreground/50 tracking-wide">Phone</th>
                        <th className="text-left px-4 py-3 text-[10px] text-foreground/50 tracking-wide">Service</th>
                        <th className="text-left px-4 py-3 text-[10px] text-foreground/50 tracking-wide">Completed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backfillPreview.bookings.map((b: BackfillBooking) => (
                        <tr key={b.id} className="border-b border-border/20">
                          <td className="px-4 py-2.5 text-foreground">{b.name}</td>
                          <td className="px-4 py-2.5 text-[12px] text-foreground/50">{b.phone}</td>
                          <td className="px-4 py-2.5 text-foreground/70 text-xs">{b.service}</td>
                          <td className="px-4 py-2.5 text-[12px] text-foreground/50">
                            {formatDate(b.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* `!backfillUnknown &&` is load-bearing, not defensive. react-query
                  RETAINS data on a failed refetch and this page refetches on
                  window focus, so testing the count first would see a STALE
                  `count: 12` while the read was failing and render "Send to 12
                  Customers" — putting a real SMS batch behind a number nobody
                  could confirm. Ask whether the count is knowable before
                  trusting it. */}
              {!backfillUnknown && (backfillPreview?.count ?? 0) > 0 ? (
                <div className="flex items-center gap-4">
                  <button
                    onClick={async () => {
                      // wave-181.x Outreach Phase 1 · safety gate per code-
                      // explorer agent audit · was firing real outbound SMS
                      // to all past-service customers with no confirmation.
                      const count = backfillPreview?.count ?? 0;
                      const ok = await confirmDialog({
                        title: `Send review request to ${count} customers?`,
                        message: `This will schedule a REAL outbound review-request SMS to ${count} customers who completed service in the past year and were never asked. Sends respect the 8AM-8PM quiet hours + per-day rate limit + TCPA opt-out filter. No undo.`,
                        confirmLabel: `Send to ${count}`,
                        cancelLabel: "Cancel",
                        tone: "danger",
                      });
                      if (!ok) return;
                      backfillExecute.mutate();
                    }}
                    disabled={backfillExecute.isPending}
                    className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 font-bold text-sm tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {backfillExecute.isPending ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Zap className="w-5 h-5" />
                    )}
                    Send to {backfillPreview?.count} Customers
                  </button>
                  {backfillExecute.isPending && (
                    <span className="text-[12px] text-foreground/40">Scheduling review requests...</span>
                  )}
                </div>
              ) : backfillUnknown ? (
                <div className="border border-amber-500/40 bg-amber-500/10 p-4 text-[13px] text-amber-400 space-y-2">
                  <p>
                    <strong>Backfill eligibility could not be read.</strong> How many past customers were never asked for a
                    review is unknown — not zero.
                  </p>
                  {/* Said outright, because hiding a button can imply the same
                      thing the green checkmark used to say. The button is absent
                      because there is no count to authorise, NOT because the work
                      is done — and a "Send to — customers" control would ask the
                      operator to approve a batch of unknown size, which is worse
                      than showing nothing. */}
                  <p className="text-amber-400/80">
                    The send button is hidden because there is no count to authorise, not because everyone has been
                    contacted.
                  </p>
                  {/* The two shapes are split for the same reason as the settings
                      banner above, and getting this wrong here would have been
                      the exact failure this whole change exists to prevent: an
                      unconditional "nothing is scheduled" is FALSE when only the
                      DEVICE is offline. The server is fine in that case —
                      booking.ts:578 is still firing scheduleReviewRequest on
                      every completion and the queue is still sending. Denying
                      the removed claim about the shop's HISTORY ("everyone has
                      been contacted") must not be done with a new claim about
                      its PRESENT that the code cannot support. */}
                  <p className="text-amber-400/80">
                    {backfillError
                      ? `The server could not read it, so the backfill list cannot be built — nothing can be sent from this tab while this persists. ${backfillErrorObj?.message ?? ""}`
                      : "This device has not reached the server. The shop's automation is unaffected and is still running on its stored settings."}
                  </p>
                </div>
              ) : (
                <div className="text-center py-8 text-foreground/40">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  {/* A COUNTED zero is real information and keeps its green tick.
                      This branch is now only reached when the read succeeded. */}
                  <p className="text-[13px]">All eligible customers have already been contacted</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Proof Bank Tab */}
      {tab === "proofbank" && <ProofBankPanel />}
    </div>
  );
}

// ─── PROOF BANK PANEL ──────────────────────────────────
function ProofBankPanel() {
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [objectionFilter, setObjectionFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Live Google review performance (read-only) — surfaces the REAL social-proof
  // numbers (rating, count, latest review) above the curated quote bank. Reuses
  // the existing public reviews.google query (also used by SiteHealthSection +
  // the public site); no new backend, no mutation, no customer contact.
  const { data: googleData, isLoading: googleLoading } = trpc.reviews.google.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
  });

  // Aggregate all proof quotes from the config
  const allQuotes = useMemo(() => {
    const quotes: (ProofQuote & { configService: string })[] = [];

    // Global quotes
    GLOBAL_QUOTES.forEach(q => quotes.push({ ...q, configService: "global" }));

    // Service-specific quotes
    Object.entries(PROOF_CONFIG).forEach(([slug, cfg]) => {
      cfg.featuredQuotes.forEach(q => quotes.push({ ...q, configService: slug }));
      Object.values(cfg.objectionQuotes).forEach(group => {
        if (group) group.forEach(q => quotes.push({ ...q, configService: slug }));
      });
    });

    // Deduplicate by author+text
    const seen = new Set<string>();
    return quotes.filter(q => {
      const key = `${q.author}:${q.text.slice(0, 50)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, []);

  // Available services and objections for filter dropdowns
  const services = useMemo(() => {
    const s = new Set(allQuotes.map(q => q.configService));
    return ["all", ...Array.from(s).sort()];
  }, [allQuotes]);

  const objections = useMemo(() => {
    const o = new Set(allQuotes.filter(q => q.objection).map(q => q.objection!));
    return ["all", ...Array.from(o).sort()];
  }, [allQuotes]);

  // Filter
  const filtered = useMemo(() => {
    let result = allQuotes;
    if (serviceFilter !== "all") {
      result = result.filter(q => q.configService === serviceFilter);
    }
    if (objectionFilter !== "all") {
      result = result.filter(q => q.objection === objectionFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r =>
        r.text.toLowerCase().includes(q) ||
        r.author.toLowerCase().includes(q) ||
        r.service.toLowerCase().includes(q)
      );
    }
    return result;
  }, [allQuotes, serviceFilter, objectionFilter, searchQuery]);

  const copyForGBP = (quote: ProofQuote) => {
    const text = `"${quote.text}"\n— ${quote.author}${quote.badge ? ` (${quote.badge})` : ""}`;
    navigator.clipboard.writeText(text);
    toast.success("Copied for GBP post");
  };

  // Stats
  const objectionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allQuotes.forEach(q => {
      if (q.objection) counts[q.objection] = (counts[q.objection] || 0) + 1;
    });
    return counts;
  }, [allQuotes]);

  return (
    <div className="space-y-6">
      {/* Live Google Reviews — real social proof (read-only · trpc.reviews.google) */}
      <div className="stat-card !p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase flex items-center gap-2">
            <Star className="w-3.5 h-3.5 text-amber-400" /> Live Google Reviews
          </h3>
          <span className="text-[10px] text-muted-foreground">real-time social proof</span>
        </div>
        {googleLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading review data…
          </div>
        ) : !googleData ? (
          <p className="text-sm text-muted-foreground">
            Live Google review data is unavailable right now. The curated quote bank below is always available.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Avg Rating" value={`${(googleData.rating ?? 0).toFixed(1)}★`} icon={<Star className="w-4 h-4" />} color="text-amber-400" />
              <StatCard label="Total Reviews" value={googleData.totalReviews ?? 0} icon={<MessageSquare className="w-4 h-4" />} color="text-primary" />
              <StatCard label="Recent Pulled" value={googleData.reviews?.length ?? 0} icon={<Shield className="w-4 h-4" />} />
            </div>
            {googleData.reviews?.[0] && (
              <div className="mt-4 border-t border-border/20 pt-3">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Latest review</div>
                <p className="text-sm text-foreground/80 italic">
                  "{googleData.reviews[0].text.length > 220 ? `${googleData.reviews[0].text.slice(0, 220)}…` : googleData.reviews[0].text}"
                </p>
                <div className="text-[11px] text-muted-foreground mt-1">
                  — {googleData.reviews[0].authorName} · {"★".repeat(Math.max(0, Math.min(5, Math.round(googleData.reviews[0].rating))))} · {googleData.reviews[0].relativeTime}
                </div>
              </div>
            )}
            <p className="text-[11px] text-primary/80 mt-3">
              Next move: turn every completed job into a review ask — the Review Requests tab grows this number.
            </p>
          </>
        )}
      </div>

      {/* Curated quote bank — objection-handling proof for GBP / sales use */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Quotes" value={allQuotes.length} icon={<Star className="w-4 h-4" />} />
        <StatCard label="Services Covered" value={Object.keys(PROOF_CONFIG).length} icon={<Shield className="w-4 h-4" />} color="text-blue-400" />
        <StatCard label="Objections Covered" value={Object.keys(objectionCounts).length} icon={<MessageSquare className="w-4 h-4" />} color="text-emerald-400" />
        <StatCard label="Global Quotes" value={GLOBAL_QUOTES.length} icon={<Star className="w-4 h-4" />} color="text-primary" />
      </div>

      {/* Objection Coverage Bar */}
      <div className="stat-card !p-5">
        <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-3">Objection Coverage</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Object.entries(objectionCounts).sort((a, b) => b[1] - a[1]).map(([obj, count]) => (
            <button
              key={obj}
              onClick={() => setObjectionFilter(objectionFilter === obj ? "all" : obj)}
              className={`p-2.5 rounded text-center border transition-all ${
                objectionFilter === obj
                  ? "border-primary/40 bg-primary/10"
                  : "border-border/30 hover:border-primary/20"
              }`}
            >
              <div className="text-lg font-bold text-foreground">{count}</div>
              <div className="text-[10px] text-muted-foreground capitalize">{obj}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search quotes..."
            className="w-full bg-background border border-border/30 pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
          />
        </div>
        <select
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
          className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50"
        >
          {services.map(s => (
            <option key={s} value={s}>{s === "all" ? "All Services" : s.charAt(0).toUpperCase() + s.slice(1).replace("-", " ")}</option>
          ))}
        </select>
        <select
          value={objectionFilter}
          onChange={(e) => setObjectionFilter(e.target.value)}
          className="bg-background border border-border/30 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50"
        >
          {objections.map(o => (
            <option key={o} value={o}>{o === "all" ? "All Objections" : o.charAt(0).toUpperCase() + o.slice(1)}</option>
          ))}
        </select>
        <span className="text-[11px] text-muted-foreground">{filtered.length} quotes</span>
      </div>

      {/* Active Filter Chips — auto-hides when nothing's active */}
      <FilterChips
        chips={[
          { label: "Search", value: searchQuery, default: "", onClear: () => setSearchQuery("") },
          { label: "Service", value: serviceFilter, default: "all", onClear: () => setServiceFilter("all") },
          { label: "Objection", value: objectionFilter, default: "all", onClear: () => setObjectionFilter("all") },
        ]}
        onClearAll={() => {
          setSearchQuery("");
          setServiceFilter("all");
          setObjectionFilter("all");
        }}
      />

      {/* Quote Cards */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="stat-card !p-8 text-center">
            <Search className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No quotes match your filters</p>
          </div>
        ) : (
          filtered.map((quote, i) => (
            <div key={i} className="stat-card !p-4 hover:!border-primary/30 transition-all group">
              <div className="flex items-start gap-3">
                <Star className="w-4 h-4 text-primary/40 shrink-0 mt-1" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground leading-relaxed italic">"{quote.text}"</p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-[12px] font-medium text-foreground/70">— {quote.author}</span>
                    {quote.badge && (
                      <span className="text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                        {quote.badge}
                      </span>
                    )}
                    <span className="text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 capitalize">
                      {quote.configService}
                    </span>
                    {quote.objection && (
                      <span className="text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 capitalize">
                        {quote.objection}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => copyForGBP(quote)}
                  // wave-119 — was hover-only invisible on phone (opacity-0
                  // group-hover) + only `title` (not `aria-label` so iOS
                  // VoiceOver missed it). Now: always-visible on mobile,
                  // p-2.5 for ~28px touch target, aria-label exposed.
                  className="shrink-0 p-2.5 text-foreground/40 hover:text-primary hover:bg-primary/10 rounded transition-all opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  title="Copy for GBP post"
                  aria-label="Copy review for GBP post"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
