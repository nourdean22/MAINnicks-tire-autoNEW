"use client";

/**
 * ErrorCard — teaches instead of just warning.
 *
 * Item #24 from the excellence marathon. Replaces generic "Something
 * went wrong" toasts with a card that shows: what failed, why, what
 * to do about it, and a "Diagnose" button that asks Nick to explain.
 *
 * Built on top of the recordError system — every ErrorCard instance
 * can be pointed at a specific audit_event via errorId to pull the
 * full context when the user clicks Diagnose.
 *
 * Usage:
 *   <ErrorCard
 *     title="Chat failed"
 *     message="AI returned a 429"
 *     domain="chat:stream"
 *     onRetry={() => retry()}
 *     onDiagnose={() => askNick("Why did the chat just fail?")}
 *   />
 */

import { AlertTriangle, RotateCcw, Brain, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ErrorCardProps {
  title: string;
  message: string;
  /** Which recordError domain the failure came from. */
  domain?: string;
  /** Optional remediation hint — shown as a blue "what to do" line. */
  remediation?: string;
  onRetry?: () => void;
  onDiagnose?: () => void;
  onDismiss?: () => void;
  className?: string;
}

const DOMAIN_HINTS: Record<string, string> = {
  "chat:stream": "AI provider or the network dropped mid-stream. Retry usually works — if not, the control bar's Provider pill lets you force OpenAI.",
  "chat:request": "The chat request couldn't even start. Check provider status (dot in chat header) and API key env vars.",
  "chat:db-write": "Neon Postgres write failed. Chat keeps working but history won't persist this turn. Check the Prisma connection.",
  "chat:prompt-build": "The system prompt builder threw. Usually a brain engine regression — check the audit log for which engine.",
  "chat:image-gen": "AI image API returned an error. Try rephrasing the image prompt or check rate limits.",
  "chat:post-process": "A background task (journal / people / actions) failed. Chat response is fine, but side effects are degraded.",
  "ai:provider": "AI provider init failed. Either no API key is set or the provider is temporarily unreachable.",
  "ai:embedding": "Embedding API call failed. Semantic search falls back to keyword mode automatically.",
  "ai:tool-exec": "A tool call executed but threw. Check the tool's implementation — params may be wrong.",
  "cron:job": "A scheduled job failed. The system/audit page shows the full run history.",
};

export function ErrorCard({
  title,
  message,
  domain,
  remediation,
  onRetry,
  onDiagnose,
  onDismiss,
  className,
}: ErrorCardProps) {
  const hint = remediation || (domain ? DOMAIN_HINTS[domain] : undefined);

  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2 animate-fade-in-scale shadow-[0_0_15px_rgba(239,68,68,0.08)] transition-all duration-300 ease-out hover:shadow-[0_0_20px_rgba(239,68,68,0.15)] hover:border-red-500/40",
        className
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-red-300">{title}</p>
          <p className="text-[10px] text-red-300/80 mt-0.5 break-words">{message}</p>
          {domain && (
            <p className="text-[9px] text-red-300/50 mt-1 font-mono">{domain}</p>
          )}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="shrink-0 text-red-300/60 hover:text-red-300 transition-colors"
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {hint && (
        <div className="flex items-start gap-2 pt-1.5 border-t border-red-500/20">
          <Brain size={10} className="text-blue-300 mt-0.5 shrink-0" />
          <p className="text-[10px] text-blue-200/80 leading-[1.45]">{hint}</p>
        </div>
      )}

      {(onRetry || onDiagnose) && (
        <div className="flex items-center gap-1.5 pt-1">
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1 px-2 h-6 rounded-md border border-red-500/30 bg-red-500/10 text-[9px] font-bold text-red-300 hover:bg-red-500/20 hover:border-red-500/50 hover:shadow-[0_0_10px_rgba(239,68,68,0.2)] transition-all duration-200 ease-out"
            >
              <RotateCcw size={10} />
              RETRY
            </button>
          )}
          {onDiagnose && (
            <button
              onClick={onDiagnose}
              className="flex items-center gap-1 px-2 h-6 rounded-md border border-[var(--gold)]/30 bg-[var(--gold)]/10 text-[9px] font-bold text-[var(--gold)] hover:bg-[var(--gold)]/20 hover:border-[var(--gold)]/50 hover:shadow-[0_0_10px_rgba(253,185,19,0.2)] transition-all duration-200 ease-out"
            >
              <Brain size={10} />
              DIAGNOSE WITH NICK
            </button>
          )}
        </div>
      )}
    </div>
  );
}
