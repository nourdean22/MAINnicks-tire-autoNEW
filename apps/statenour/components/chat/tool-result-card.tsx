"use client";

/**
 * TOOL RESULT CARD — Rich inline rendering for known chat tools.
 *
 * Replaces the tiny 'create task' pill chip with a proper card when
 * the tool is one Nour actually uses as a core site action. The card
 * shows what happened, the affected record (when available), and a
 * deep link to the relevant page so he can jump straight there.
 *
 * Unknown tool names fall back to the existing pill chip rendered
 * inline in chat/page.tsx. Only the tools in TOOL_CONFIG get a card.
 *
 * Data shape: the AI SDK represents tool outputs as
 *   { type: 'tool-<name>', state: 'output-available' | ..., output: unknown }
 * The output shape is defined by the server-side tool — we probe a
 * handful of common shapes (task, taskId, title, id, result) and
 * fall back gracefully when the field isn't present.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { notifyDataChanged } from "@/lib/events/data-change";
import { ChevronRight, Loader2 } from "lucide-react";
import { TOOL_CONFIG, COLORS } from "@/components/chat/tool-result-registry";
export { isKnownToolName } from "@/components/chat/tool-result-registry";


/**
 * v10.0.529.97 · Wave 41 · single-use undo affordance.
 *
 * Renders only when the tool output carries `undoToken` + `undoExpiresAt`
 * AND the expiry hasn't passed. Countdown ticks every second · self-
 * removes when expired or after a successful undo. Tap fires POST
 * /api/undo/<token> · on success refreshes the relevant data domain.
 */
function UndoChip({
  token,
  expiresAt,
  domain,
}: {
  token: string;
  expiresAt: string;
  domain: "tasks" | "goals" | "people";
}) {
  const expiryMs = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [now, setNow] = useState(() => Date.now());
  const [state, setState] = useState<"ready" | "pending" | "done" | "failed">("ready");
  // Cross-domain residuals slice (2026-05-22) · migrated off
  // `authedFetch("/api/undo/<token>")` onto `trpc.task.undo`. The undo
  // is a single imperative POST on tap · modeled as a mutation.
  const undoMutation = trpc.task.undo.useMutation();

  useEffect(() => {
    if (state !== "ready") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state]);

  const secondsLeft = Math.max(0, Math.ceil((expiryMs - now) / 1000));
  if (secondsLeft <= 0 && state === "ready") return null;
  if (state === "done") {
    return (
      <span className="shrink-0 inline-flex items-center text-[10px] font-medium text-emerald-300/80 px-2">
        undone
      </span>
    );
  }

  const onClick = async () => {
    setState("pending");
    try {
      await undoMutation.mutateAsync({ token });
      setState("done");
      // Refresh the affected surface · same domain wiring Waves 30+ use.
      notifyDataChanged(domain, { source: "undo-chip", detail: token });
    } catch {
      setState("failed");
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state !== "ready"}
      // 44px min tap target per Wave 39 HIG · -my-1.5 keeps row height
      // unchanged · disabled-style applies during pending/failed.
      className={cn(
        "shrink-0 inline-flex items-center gap-1 text-[10px] font-medium min-h-[44px] px-2 -my-1.5 rounded-md transition-colors",
        state === "ready" && "text-amber-300/80 hover:text-amber-200 hover:bg-amber-500/10",
        state === "pending" && "text-amber-300/40",
        state === "failed" && "text-rose-400/70",
      )}
      aria-label={`Undo this action · ${secondsLeft}s remaining`}
    >
      {state === "ready" && `undo · ${secondsLeft}s`}
      {state === "pending" && "undoing…"}
      {state === "failed" && "undo failed"}
    </button>
  );
}

export interface ToolResultCardProps {
  toolName: string;
  state: string;
  output: unknown;
}


/**
 * Returns a rendered card if the tool is known, or null to let the
 * caller fall back to the existing pill chip.
 */
export function ToolResultCard({ toolName, state, output }: ToolResultCardProps) {
  const config = TOOL_CONFIG[toolName];

  // Hooks must be declared before any early return. Moving expanded +
  // rawJson above the `if (!config) return null` guard so hook order
  // stays stable across renders even for unknown tools.
  const [expanded, setExpanded] = useState(false);
  const isDone = state === "output-available";
  const rawJson = useMemo(() => {
    if (!isDone || output === undefined || output === null) return null;
    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return String(output);
    }
  }, [isDone, output]);

  if (!config) return null;

  const Icon = config.icon;
  const colors = COLORS[config.color];
  const isError = state === "output-error";
  const subtitle = isDone && config.subtitle ? config.subtitle(output) : null;
  // renderRich returns structured JSX — rendered below the subtitle
  // when the tool has one (e.g. getRevenueAging → bucket bars,
  // getBlindSpots → severity pills, getCustomerLTV → LTV bars).
  const richBody = isDone && config.renderRich ? config.renderRich(output) : null;

  return (
    <div
      className={cn(
        // Base layout — switch to block mode when we have a rich body
        // so the bars/pills wrap cleanly below the header row.
        "mt-2 mb-1 rounded-lg border-l-2 border border-zinc-800 transition-all relative overflow-hidden px-3 py-2",
        richBody ? "block" : "flex items-center gap-3",
        colors.border,
        colors.bg,
        !isDone && !isError && "chat-tool-shimmer",
        isDone && "opacity-100",
        isError && "border-l-red-500 bg-red-500/5"
      )}
      data-state={state}
    >
      <div className={cn("flex items-center gap-3", richBody && "w-full")}>
        {/* Icon — Loader2 spin while pending, real icon once done */}
        {isDone || isError ? (
          <Icon
            size={14}
            className={cn(colors.icon, "shrink-0", isError && "text-red-400")}
          />
        ) : (
          <Loader2 size={14} className={cn(colors.icon, "shrink-0 animate-spin")} />
        )}

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-[11px] font-[var(--font-display)] font-bold uppercase tracking-[0.18em]",
              isError ? "text-red-400" : colors.icon
            )}
          >
            {isError ? "Tool failed" : isDone ? config.doneLabel : config.runningLabel}
          </p>
          {subtitle && (
            <p className="text-[12px] text-[var(--text-secondary)] truncate mt-0.5">
              {subtitle}
            </p>
          )}
        </div>

        {/* v10.0.529.97 · Wave 41 · single-use undo affordance · only
            renders when tool output carries undoToken + undoExpiresAt.
            Sits between subtitle and the deep-link · countdown ticks
            until 30s expires or operator taps. */}
        {isDone && (() => {
          const o = output as { undoToken?: string; undoExpiresAt?: string } | null;
          if (!o?.undoToken || !o?.undoExpiresAt) return null;
          // Domain inferred from toolName · Wave 41 launches with 2
          // tools: snoozeTask (tasks) + archiveGoal (goals). Add support
          // for person.create (people). Default tasks for safety.
          const domain: "tasks" | "goals" | "people" =
            toolName === "archiveGoal"
              ? "goals"
              : toolName === "person.create"
              ? "people"
              : "tasks";
          return (
            <UndoChip token={o.undoToken} expiresAt={o.undoExpiresAt} domain={domain} />
          );
        })()}

        {/* v10.0.529.91 · Wave 35 · entity-aware link wins · falls back
            to static config.link when linkFn returns null. */}
        {isDone && (() => {
          const dynLink = config.linkFn?.(output) ?? null;
          const link = dynLink ?? config.link;
          if (!link) return null;
          return (
            <Link
              href={link.href}
              // v10.0.529.95 · Wave 39 · C3 · 44px min tap target. Pre-
              // Wave-39 the deep-link was 16-18px tall · first-tap miss
              // rate near 50% on iPhone · this is the PRIMARY navigation
              // affordance after Nick creates/updates an entity.
              className={cn(
                "shrink-0 flex items-center gap-1 text-[10px] font-medium min-h-[44px] px-2 -my-1.5 rounded-md",
                colors.link
              )}
            >
              {link.label}
              <ChevronRight size={10} />
            </Link>
          );
        })()}
      </div>

      {/* Rich body (bars, pills, mini-widgets) renders below the header row */}
      {richBody && <div className="mt-1">{richBody}</div>}

      {/* Apr 20 · Expand → raw JSON payload for power users.
          Only shows when output exists + tool is done. */}
      {isDone && rawJson && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            // v10.0.529.95 · Wave 39 · C4 · 44px min tap target. Was ~14px
            // tall · effectively untappable on mobile.
            className={cn(
              "mt-1 text-[9px] font-mono uppercase tracking-wider opacity-50 hover:opacity-100 transition-opacity inline-flex items-center min-h-[44px] px-2 rounded-md",
              colors.icon
            )}
            title={expanded ? "Hide raw output" : "Show raw tool output"}
          >
            {expanded ? "▾ hide raw" : "▸ raw output"}
          </button>
          {expanded && (
            <pre className="mt-1 p-2 rounded bg-black/40 border border-zinc-800/60 text-[10px] font-mono text-zinc-300 overflow-x-auto max-h-[280px] overflow-y-auto whitespace-pre-wrap break-words">
              {rawJson.slice(0, 8000)}
              {rawJson.length > 8000 && `\n\n…(${rawJson.length - 8000} chars truncated)`}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

/** Exported so chat/page.tsx can ask whether to use the card or the pill. */
