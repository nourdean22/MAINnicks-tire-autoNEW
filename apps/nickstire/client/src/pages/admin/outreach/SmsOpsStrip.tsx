/**
 * SMS Ops Strip — the one-glance control surface for the SMS Revenue Agent OS
 * (2026-07-29). Answers, in order: may the machine text? is the pipe up? what
 * is stuck? what did it refuse to do lately?
 *
 * Truth rules: a failed read renders UNKNOWN (amber), never a reassuring
 * zero. The pause toggle is two-tap (confirmDialog) — iOS PWA suppresses
 * window.confirm.
 */
import { trpc } from "@/lib/trpc";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { toast } from "sonner";
import { Loader2, OctagonPause, Play, ShieldAlert } from "lucide-react";

function Tile({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" | "muted" }) {
  const toneClass =
    tone === "bad" ? "text-red-400" : tone === "warn" ? "text-amber-300" : tone === "ok" ? "text-emerald-400" : "text-foreground/80";
  return (
    <div className="rounded border border-border/40 bg-background/40 px-2.5 py-1.5 min-w-[92px]">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-mono font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

export default function SmsOpsStrip() {
  const utils = trpc.useUtils();
  const { data, isLoading, isError } = trpc.smsOps.opsStatus.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: 1,
  });
  const { data: latency } = trpc.smsOps.latencyMetrics.useQuery(undefined, { staleTime: 120_000, retry: 1 });
  const setPause = trpc.smsOps.setPause.useMutation({
    onSuccess: (r) => {
      toast.success(r.paused ? "SMS PAUSED — automated customer sends now hold in the queue" : "SMS resumed — held queue drains on the next cycle");
      utils.smsOps.opsStatus.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const togglePause = async (next: boolean) => {
    const okay = await confirmDialog({
      title: next ? "Pause ALL automated customer SMS?" : "Resume automated customer SMS?",
      message: next
        ? "Marketing + follow-up texts will be HELD in the durable queue (not dropped). Confirmations and internal alerts keep flowing. Lift the pause to drain."
        : "Held messages will drain through the normal window machinery within ~1 minute.",
      confirmLabel: next ? "Pause SMS" : "Resume",
    });
    if (!okay) return;
    setPause.mutate({ paused: next });
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border/40 bg-card p-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading SMS ops status…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-card p-3 text-xs text-amber-300">
        SMS ops status UNKNOWN — the read failed. This is not "all clear".
      </div>
    );
  }

  const paused = data.pause.readable && data.pause.paused;
  const suppressed = data.suppressions7d.reduce((n, s) => n + s.count, 0);

  return (
    <section aria-label="SMS ops status" className={`rounded-lg border ${paused ? "border-red-500/50" : "border-border/40"} bg-card p-3`}>
      <div className="flex flex-wrap items-center gap-2">
        {/* Pause control — THE lever. Two-tap. */}
        <button
          onClick={() => togglePause(!paused)}
          disabled={setPause.isPending || !data.pause.readable}
          className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded active:scale-95 ${
            paused
              ? "bg-emerald-600/20 border border-emerald-500/50 text-emerald-300"
              : "bg-red-600/15 border border-red-500/40 text-red-300"
          } disabled:opacity-40`}
          aria-label={paused ? "Resume automated SMS" : "Pause all automated SMS"}
        >
          {setPause.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : paused ? <Play className="w-3.5 h-3.5" /> : <OctagonPause className="w-3.5 h-3.5" />}
          {paused ? "RESUME SMS" : "PAUSE SMS"}
        </button>
        {!data.pause.readable && (
          <span className="inline-flex items-center gap-1 text-[10px] text-amber-300">
            <ShieldAlert className="w-3 h-3" /> pause state UNKNOWN ({data.pause.reason ?? "unreadable"}) — marketing holds, follow-ups flow
          </span>
        )}

        <Tile
          label="Gateway"
          value={!data.gateway.configured ? "not set up" : data.gateway.reachable ? "ONLINE" : "OFFLINE"}
          tone={!data.gateway.configured ? "muted" : data.gateway.reachable ? "ok" : "bad"}
        />
        <Tile
          label="Queued"
          value={data.queue.readable ? String(data.queue.queued) : "?"}
          tone={!data.queue.readable ? "warn" : data.queue.queued > 25 ? "warn" : "muted"}
        />
        <Tile
          label="Oldest queued"
          value={
            !data.queue.readable
              ? "?"
              : data.queue.oldestQueuedAgeMinutes == null
                ? "—"
                : data.queue.oldestQueuedAgeMinutes >= 90
                  ? `${Math.round(data.queue.oldestQueuedAgeMinutes / 60)}h`
                  : `${data.queue.oldestQueuedAgeMinutes}m`
          }
          tone={!data.queue.readable ? "warn" : (data.queue.oldestQueuedAgeMinutes ?? 0) > 720 ? "bad" : "muted"}
        />
        <Tile
          label="24h volume"
          value={data.globalCap.readable ? `${data.globalCap.count}/${data.globalCap.cap}` : "?"}
          tone={!data.globalCap.readable ? "warn" : data.globalCap.count >= data.globalCap.cap ? "bad" : "muted"}
        />
        <Tile label="Fails 7d" value={data.deliveryFailures7d == null ? "?" : String(data.deliveryFailures7d)} tone={data.deliveryFailures7d == null ? "warn" : data.deliveryFailures7d > 0 ? "warn" : "muted"} />
        <Tile label="Drafts waiting" value={data.pendingDrafts == null ? "?" : String(data.pendingDrafts)} tone={data.pendingDrafts == null ? "warn" : data.pendingDrafts > 0 ? "warn" : "muted"} />
        <Tile label="AI held back 7d" value={String(suppressed)} tone="muted" />
        {latency?.leadFirstContact30d && (
          <Tile
            label="Lead→contact avg"
            value={latency.leadFirstContact30d.avgMinutes == null ? "—" : `${latency.leadFirstContact30d.avgMinutes}m`}
            tone={(latency.leadFirstContact30d.avgMinutes ?? 0) > 240 ? "warn" : "muted"}
          />
        )}
        {latency?.inboundResponse7d && (
          <Tile
            label="Inbound→reply avg"
            value={latency.inboundResponse7d.avgSeconds == null ? "—" : `${latency.inboundResponse7d.avgSeconds}s`}
            tone="muted"
          />
        )}
      </div>

      {/* Takeover / cap / opt-out counters — only rendered when non-zero (since boot) */}
      {(data.inMemory.blockedByTakeover > 0 || data.inMemory.blockedByGlobalCap > 0 || data.inMemory.blockedByPause > 0 || data.inMemory.optOutCheckSkipped > 0) && (
        <p className="text-[10px] text-muted-foreground mt-2">
          since boot: {data.inMemory.blockedByTakeover > 0 ? `${data.inMemory.blockedByTakeover} suppressed (human held thread) · ` : ""}
          {data.inMemory.blockedByPause > 0 ? `${data.inMemory.blockedByPause} held by pause · ` : ""}
          {data.inMemory.blockedByGlobalCap > 0 ? `${data.inMemory.blockedByGlobalCap} refused (global cap) · ` : ""}
          {data.inMemory.optOutCheckSkipped > 0 ? `${data.inMemory.optOutCheckSkipped} sends skipped the opt-out check (flagged)` : ""}
        </p>
      )}

      {/* Autonomy ladder — declared level + live rollout per automation */}
      <details className="mt-2">
        <summary className="text-[10px] uppercase tracking-wider text-muted-foreground cursor-pointer select-none">
          Autonomy ladder ({data.autonomy.length} automations)
        </summary>
        <div className="mt-1.5 grid gap-1">
          {data.autonomy.map((a) => (
            <div key={a.key} className="flex items-center gap-2 text-[10px]">
              <span className={`font-mono font-bold px-1.5 py-0.5 rounded border ${a.level >= 3 ? "border-amber-500/40 text-amber-300" : a.level === 2 ? "border-sky-500/40 text-sky-300" : "border-border/40 text-foreground/60"}`}>
                L{a.level}
              </span>
              <span className="font-mono text-foreground/80">{a.key}</span>
              <span className="text-muted-foreground">{a.sendClass.replace("customer_", "")}</span>
              {a.rolloutMode && <span className={`px-1 rounded ${a.rolloutMode === "live_send" || a.rolloutMode === "legacy_passthrough" ? "text-emerald-400" : "text-muted-foreground"}`}>{a.rolloutMode}</span>}
              {a.armedBy && <span className="text-muted-foreground/60 truncate max-w-[220px]">armed: {a.armedBy}</span>}
            </div>
          ))}
        </div>
      </details>

      {/* Suppression rollup */}
      {data.suppressions7d.length > 0 && (
        <details className="mt-1.5">
          <summary className="text-[10px] uppercase tracking-wider text-muted-foreground cursor-pointer select-none">
            What the AI held back (7d)
          </summary>
          <div className="mt-1.5 grid gap-0.5">
            {data.suppressions7d.map((s, i) => (
              <div key={i} className="text-[10px] font-mono text-foreground/70">
                {s.count}× {s.status}{s.statusReason ? ` — ${s.statusReason}` : ""}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
