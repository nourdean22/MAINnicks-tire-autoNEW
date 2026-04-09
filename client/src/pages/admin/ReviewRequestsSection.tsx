/**
 * ReviewRequestsSection — admin panel for managing automated Google review SMS requests.
 * Shows stats, request list, settings, and backfill blast controls.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { StatCard } from "./shared";
import {
  Loader2, Star, Send, RefreshCw, CheckCircle2, XCircle,
  Clock, MousePointerClick, Settings, Zap, AlertTriangle,
  MessageSquare, ChevronDown, ChevronUp, Shield, Copy, Filter, Search,
} from "lucide-react";
import { GLOBAL_QUOTES, PROOF_CONFIG, type ProofQuote } from "@shared/proof";

type SettingsTab = "requests" | "settings" | "backfill" | "proofbank";

export default function ReviewRequestsSection() {
  const [tab, setTab] = useState<SettingsTab>("requests");
  const utils = trpc.useUtils();

  // Data queries
  const { data: stats, isLoading: statsLoading } = trpc.reviewRequests.stats.useQuery();
  const { data: requests, isLoading: requestsLoading } = trpc.reviewRequests.list.useQuery({ limit: 100 });
  const { data: settings, isLoading: settingsLoading } = trpc.reviewRequests.getSettings.useQuery();
  const { data: backfillPreview, isLoading: backfillLoading } = trpc.reviewRequests.backfillPreview.useQuery();

  // Mutations
  const updateSettings = trpc.reviewRequests.updateSettings.useMutation({
    onSuccess: () => {
      toast.success("Settings updated");
      utils.reviewRequests.getSettings.invalidate();
    },
    onError: (err) => toast.error(err.message),
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

  // Initialize form when settings load
  const initForm = () => {
    if (settings) {
      setFormEnabled(settings.enabled);
      setFormDelay(String(settings.delayMinutes));
      setFormMaxPerDay(String(settings.maxPerDay));
      setFormCooldown(String(settings.cooldownDays));
      setFormTemplate(settings.messageTemplate || "");
    }
  };

  const handleSaveSettings = () => {
    const data: Record<string, unknown> = {};
    if (formEnabled !== null) data.enabled = formEnabled;
    if (formDelay) data.delayMinutes = parseInt(formDelay);
    if (formMaxPerDay) data.maxPerDay = parseInt(formMaxPerDay);
    if (formCooldown) data.cooldownDays = parseInt(formCooldown);
    if (formTemplate !== undefined) data.messageTemplate = formTemplate || null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial update object doesn't match full mutation input
    updateSettings.mutate(data as any);
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
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="Total Requests"
          value={statsLoading ? "..." : stats?.total ?? 0}
          icon={<MessageSquare className="w-5 h-5" />}
        />
        <StatCard
          label="Sent"
          value={statsLoading ? "..." : stats?.sent ?? 0}
          icon={<Send className="w-5 h-5" />}
          color="text-amber-400"
        />
        <StatCard
          label="Clicked"
          value={statsLoading ? "..." : stats?.clicked ?? 0}
          icon={<MousePointerClick className="w-5 h-5" />}
          color="text-emerald-400"
        />
        <StatCard
          label="Click Rate"
          value={statsLoading ? "..." : `${stats?.clickRate ?? 0}%`}
          icon={<Star className="w-5 h-5" />}
          color="text-primary"
        />
        <StatCard
          label="Pending"
          value={statsLoading ? "..." : stats?.pending ?? 0}
          icon={<Clock className="w-5 h-5" />}
          color="text-blue-400"
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
            onClick={() => { setTab(t.id); if (t.id === "settings") initForm(); }}
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
              {requests?.length ?? 0} review requests
            </span>
            <button
              onClick={() => processQueue.mutate()}
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
                  {requests.map((req: any) => {
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
                          {req.scheduledAt ? new Date(req.scheduledAt).toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-3 text-[12px] text-foreground/50">
                          {req.sentAt ? new Date(req.sentAt).toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-3 text-[12px] text-foreground/50">
                          {req.clickedAt ? (
                            <span className="text-emerald-400">{new Date(req.clickedAt).toLocaleString()}</span>
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
                    const newVal = (formEnabled ?? settings?.enabled ?? 1) === 1 ? 0 : 1;
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
                  value={formDelay || settings?.delayMinutes || 120}
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
                  value={formMaxPerDay || settings?.maxPerDay || 20}
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
                  value={formCooldown || settings?.cooldownDays || 30}
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
                  value={backfillPreview?.count ?? 0}
                  icon={<Star className="w-5 h-5" />}
                  color="text-primary"
                />
                <StatCard
                  label="Preview (First 50)"
                  value={backfillPreview?.bookings?.length ?? 0}
                  icon={<MessageSquare className="w-5 h-5" />}
                />
              </div>

              {backfillPreview?.bookings && backfillPreview.bookings.length > 0 && (
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
                      {backfillPreview.bookings.map((b: any) => (
                        <tr key={b.id} className="border-b border-border/20">
                          <td className="px-4 py-2.5 text-foreground">{b.name}</td>
                          <td className="px-4 py-2.5 text-[12px] text-foreground/50">{b.phone}</td>
                          <td className="px-4 py-2.5 text-foreground/70 text-xs">{b.service}</td>
                          <td className="px-4 py-2.5 text-[12px] text-foreground/50">
                            {new Date(b.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(backfillPreview?.count ?? 0) > 0 ? (
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => backfillExecute.mutate()}
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
              ) : (
                <div className="text-center py-8 text-foreground/40">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
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
      {/* Stats */}
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
                  className="shrink-0 p-1.5 text-foreground/20 hover:text-primary hover:bg-primary/10 rounded transition-all opacity-0 group-hover:opacity-100"
                  title="Copy for GBP post"
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
