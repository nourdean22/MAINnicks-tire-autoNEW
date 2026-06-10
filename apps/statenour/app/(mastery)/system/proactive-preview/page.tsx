"use client";

import { useEffect, useState, useCallback } from "react";
import { Panel } from "@/components/panel";
import { PageHeader } from "@/components/layout/ui";
import { toast } from "sonner";

interface PushSourceItem {
  id?: string;
  category:
    | "journal"
    | "body"
    | "task"
    | "goal"
    | "concern"
    | "anticipated_question"
    | "previous_push"
    | "system_context"
    | "unknown";
  title: string;
  summary: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  href?: string;
}

interface PushPreviewItem {
  kind: "preview";
  slot: "morning" | "afternoon" | "evening";
  nowIso: string;
  timezone: string;
  dryRun: true;
  wouldSend: boolean;
  wouldSkip: boolean;
  reason: string;
  messageText?: string;
  messagePreviewSafe?: string;
  dedupKey?: string;
  dedupBlocked: boolean;
  quietHoursBlocked: boolean;
  rateLimitBlocked: boolean;
  sourceFunction: string;
  riskFlags: string[];
  nextSafeStep: string;
  sources: PushSourceItem[];
}

interface PreviewResponse {
  dryRun: true;
  generatedAt: string;
  previews: PushPreviewItem[];
  warning: string;
  noSendGuarantee: true;
}

const RISK_DESCRIPTIONS: Record<string, string> = {
  preview_only: "Preview environment constraint is enforced.",
  live_send_disabled: "Live delivery to operator's Telegram is safely offline.",
  already_sent_today: "A push was already recorded for this slot today (idempotency block).",
  empty_message: "No message content could be dynamically generated.",
  body_data_missing: "No body tracking log was found for today (sleep/energy).",
  quiet_hours_overnight: "Simulated hour lies within the 12am - 5am ET quiet hours block.",
  noisy_or_generic: "Push fell back to generic nudge due to missing high-signal context.",
  context_missing: "Source database lanes (anticipated questions, open concerns) are empty.",
};

const CRITERIA = [
  { id: "preview_2d", label: "2 days of proactive previews reviewed manually in logs/console" },
  { id: "dedup_verified", label: "Duplicate/idempotency keys verified against BrainMemory" },
  { id: "quiet_hours", label: "Overnight quiet hours (12am-5am ET) suppress sends automatically" },
  { id: "quality_approved", label: "Message templates conform to Greene/Karpathy quality standards" },
  { id: "kill_switch", label: "Global kill switch registered under System crons" },
  { id: "claude_audit", label: "Security audit is complete and green" },
  { id: "owner_signoff", label: "Owner approval granted for live transition" },
];

export default function ProactivePreviewPage() {
  const [slot, setSlot] = useState<string>("all");
  const [mockTime, setMockTime] = useState<string>("");
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});

  const fetchPreviews = useCallback(async () => {
    setLoading(true);
    try {
      let url = `/api/system/proactive-preview?slot=${slot}`;
      if (mockTime) {
        // Convert datetime-local value (YYYY-MM-DDTHH:MM) to ISO string
        const parsedDate = new Date(mockTime);
        if (!isNaN(parsedDate.getTime())) {
          url += `&now=${encodeURIComponent(parsedDate.toISOString())}`;
        }
      }
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }
      const json = (await res.json()) as { ok: boolean; data?: PreviewResponse; error?: string };
      if (json.ok && json.data) {
        setData(json.data);
      } else {
        throw new Error(json.error || "Failed to load preview data");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load proactive preview");
    } finally {
      setLoading(false);
    }
  }, [slot, mockTime]);

  useEffect(() => {
    void fetchPreviews();
  }, [fetchPreviews]);

  const toggleCheck = (id: string) => {
    setChecklist((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleResetTime = () => {
    setMockTime("");
    toast.success("Time reset to local live clock");
  };

  const activePreviews = data?.previews ?? [];

  return (
    <main className="min-h-[100dvh] bg-[var(--bg-base)] text-white">
      <div className="mx-auto max-w-5xl space-y-6 px-3 py-4 sm:px-4 sm:py-6">
        <PageHeader
          parentHref="/system"
          parentLabel="system"
          eyebrow="SYSTEM OS · COMMAND DECK"
          title="Proactive Push Previews"
          description="Inspect candidate proactive alerts, anticipated prompt slot previews, dedup status, and risk telemetry."
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={() => void fetchPreviews()}
                disabled={loading}
                className="rounded-lg border border-[var(--border-hover)] bg-[var(--bg-raised)]/5 px-4 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-raised)]/10 disabled:opacity-50"
              >
                {loading ? "Simulating..." : "Reload Preview"}
              </button>
            </div>
          }
        />

        {/* Status Strip */}
        <Panel className="flex flex-col gap-4 border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold tracking-wide text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              DRY-RUN ONLY
            </span>
            <span className="inline-flex items-center rounded bg-sky-500/10 px-2 py-0.5 text-xs font-semibold tracking-wide text-sky-400">
              NO-SEND GUARANTEE
            </span>
            <span className="text-xs text-[var(--text-tertiary)] font-mono">
              Timezone: New York (ET)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-mono text-[var(--text-secondary)]">Mock Time (ET):</label>
            <input
              type="datetime-local"
              value={mockTime}
              onChange={(e) => setMockTime(e.target.value)}
              className="rounded border border-white/10 bg-transparent px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-[var(--gold)]/60"
            />
            {mockTime && (
              <button
                onClick={handleResetTime}
                className="rounded bg-white/5 hover:bg-white/10 px-2 py-1 text-[10px] font-mono text-zinc-300"
              >
                Clear
              </button>
            )}
          </div>
        </Panel>

        {/* Filter Controls */}
        <div className="flex items-center gap-2">
          {["all", "auto", "morning", "afternoon", "evening"].map((s) => (
            <button
              key={s}
              onClick={() => setSlot(s)}
              className={`rounded-full px-3 py-1 text-xs transition ${
                slot === s
                  ? "bg-white/10 text-white font-medium"
                  : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Preview Cards Grid */}
        <div className="grid gap-4 md:grid-cols-3">
          {activePreviews.map((preview) => {
            const wouldSend = preview.wouldSend;
            return (
              <Panel
                key={preview.slot}
                className={`relative flex flex-col justify-between border ${
                  wouldSend
                    ? "border-emerald-500/20 bg-emerald-500/[0.01]"
                    : "border-zinc-800 bg-[var(--bg-raised)]/[0.01]"
                } p-5`}
              >
                <div className="space-y-4">
                  <header className="flex items-center justify-between">
                    <h3 className="font-mono text-sm uppercase tracking-wider text-white">
                      {preview.slot} slot
                    </h3>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                        wouldSend
                          ? "bg-emerald-400/10 text-emerald-400"
                          : "bg-amber-400/10 text-amber-300"
                      }`}
                    >
                      {wouldSend ? "would send" : "would skip"}
                    </span>
                  </header>

                  <div className="space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500 block font-mono">
                      Reason
                    </span>
                    <p className="text-xs text-[var(--text-secondary)]">{preview.reason}</p>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500 block font-mono">
                      Message Draft
                    </span>
                    {preview.messageText ? (
                      <div className="rounded border border-white/5 bg-black/25 p-3 font-sans text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap">
                        {preview.messageText}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-500 italic">No message drafted (slot skipped/empty)</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500 block font-mono">
                      Risk Flags
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {preview.riskFlags.map((flag) => (
                        <span
                          key={flag}
                          className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-mono text-zinc-400 border border-zinc-700/40"
                        >
                          {flag}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Why / Source Attribution */}
                  <div className="space-y-2 border-t border-white/5 pt-3">
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500 block font-mono">
                      Why / Source Attribution
                    </span>
                    {preview.sources && preview.sources.length > 0 ? (
                      <div className="space-y-3">
                        {preview.sources.map((src, idx) => {
                          const confColors =
                            src.confidence === "high"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : src.confidence === "medium"
                              ? "bg-sky-500/10 text-sky-400 border-sky-500/20"
                              : "bg-amber-400/10 text-amber-300 border-amber-500/20";
                          return (
                            <div key={idx} className="rounded bg-white/[0.01] border border-white/5 p-2 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-mono text-zinc-400 border border-zinc-700/40 uppercase">
                                  {src.category}
                                </span>
                                <span className={`rounded border px-1.5 py-0.5 text-[9px] font-mono uppercase ${confColors}`}>
                                  {src.confidence} confidence
                                </span>
                              </div>
                              <h4 className="text-xs font-semibold text-white">{src.title}</h4>
                              <p className="text-xs text-zinc-300">{src.summary}</p>
                              <p className="text-[10px] text-zinc-500 italic">Reason: {src.reason}</p>
                              {src.href && (
                                <a
                                  href={src.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-block text-[10px] text-[var(--gold)] hover:underline font-mono"
                                >
                                  View Source →
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-500 italic">No direct source found. Preview is based on scheduled system context.</p>
                    )}
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-white/5 space-y-2 text-[10px] font-mono text-zinc-500">
                  <div>
                    <span className="text-zinc-600 block">DEDUP KEY:</span>
                    {preview.dedupKey ?? "—"}
                  </div>
                  <div>
                    <span className="text-zinc-600 block">SOURCE FN:</span>
                    {preview.sourceFunction}
                  </div>
                  <div>
                    <span className="text-zinc-600 block">NEXT SAFE STEP:</span>
                    <span className="text-zinc-400">{preview.nextSafeStep}</span>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>

        {/* Details Row: Risk Matrix & Live checklist */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Risk Matrix panel */}
          <Panel className="p-5 space-y-4">
            <h3 className="text-sm font-semibold tracking-wide text-white font-mono uppercase">
              Proactive Alert Risk Matrix
            </h3>
            <div className="space-y-3">
              {Object.entries(RISK_DESCRIPTIONS).map(([flag, desc]) => {
                const isActive = activePreviews.some((p) => p.riskFlags.includes(flag));
                return (
                  <div key={flag} className="flex items-start gap-3 text-xs leading-normal">
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold border ${
                        isActive
                          ? "bg-amber-400/10 text-amber-300 border-amber-500/20"
                          : "bg-zinc-900 text-zinc-600 border-zinc-800"
                      }`}
                    >
                      {flag}
                    </span>
                    <p className={isActive ? "text-zinc-300" : "text-zinc-600"}>{desc}</p>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* Go Live Checklist */}
          <Panel className="p-5 space-y-4">
            <h3 className="text-sm font-semibold tracking-wide text-white font-mono uppercase">
              Live-Go Readiness Criteria
            </h3>
            <p className="text-xs text-[var(--text-tertiary)]">
              Before proactive alerts are wired to fire automatically outside dry-run, the following safety boxes must be checked:
            </p>
            <div className="space-y-3">
              {CRITERIA.map((item) => (
                <label
                  key={item.id}
                  className="flex items-start gap-3 text-xs text-zinc-300 cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={!!checklist[item.id]}
                    onChange={() => toggleCheck(item.id)}
                    className="mt-0.5 h-4 w-4 rounded border-white/10 bg-transparent text-[var(--gold)] focus:ring-0 focus:ring-offset-0"
                  />
                  <span className={checklist[item.id] ? "text-white line-through opacity-60" : ""}>
                    {item.label}
                  </span>
                </label>
              ))}
            </div>
          </Panel>
        </div>

        {/* QA Diagnostics & Command Block */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* REST QA links */}
          <Panel className="p-5 space-y-3">
            <h3 className="text-sm font-semibold tracking-wide text-white font-mono uppercase">
              Manual QA Endpoint Routes
            </h3>
            <p className="text-xs text-[var(--text-tertiary)]">
              Query the JSON endpoint directly to inspect raw diagnostics payload:
            </p>
            <ul className="space-y-2 font-mono text-xs text-[var(--gold)]">
              <li>
                <a
                  href="/api/system/proactive-preview?slot=all"
                  target="_blank"
                  className="hover:underline"
                >
                  GET /api/system/proactive-preview?slot=all
                </a>
              </li>
              <li>
                <a
                  href="/api/system/proactive-preview?slot=auto"
                  target="_blank"
                  className="hover:underline"
                >
                  GET /api/system/proactive-preview?slot=auto
                </a>
              </li>
              <li>
                <a
                  href={`/api/system/proactive-preview?slot=morning&now=${new Date().toISOString()}`}
                  target="_blank"
                  className="hover:underline"
                >
                  GET /api/system/proactive-preview?slot=morning&now=...
                </a>
              </li>
            </ul>
          </Panel>

          {/* Slash commands */}
          <Panel className="p-5 space-y-3">
            <h3 className="text-sm font-semibold tracking-wide text-white font-mono uppercase">
              Slash Command Integration
            </h3>
            <p className="text-xs text-[var(--text-tertiary)]">
              Run previews inside the console or chat panel:
            </p>
            <ul className="space-y-2 font-mono text-xs text-zinc-300">
              <li>
                <code className="text-white bg-zinc-800 px-1.5 py-0.5 rounded">/preview-pushes all</code>
                <span className="text-zinc-500 ml-2">Show preview of all slots</span>
              </li>
              <li>
                <code className="text-white bg-zinc-800 px-1.5 py-0.5 rounded">/pushes morning</code>
                <span className="text-zinc-500 ml-2">Show morning question slot only</span>
              </li>
              <li>
                <code className="text-white bg-zinc-800 px-1.5 py-0.5 rounded">/pushes auto</code>
                <span className="text-zinc-500 ml-2">Show current hour slot only</span>
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </main>
  );
}
