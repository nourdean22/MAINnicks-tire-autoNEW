"use client";

/**
 * TOOL RECEIPT — how a known chat tool's call reads in the conversation.
 *
 * The registry (`tool-result-registry.tsx`: labels, subtitles, rich bodies,
 * deep links, undo tokens) is the semantics and is untouched. This file is the
 * renderer only.
 *
 * 2026-10-01 (UI v2 · Tool Receipt grammar):
 *
 *   [glyph]  Action label                              next action →
 *            primary result / subtitle
 *            (rich body, when the registry has one)
 *            Developer detail ▸  (raw output — never shown by default)
 *
 * One hue per receipt, on the glyph only (the registry's colour), so a run of
 * tool calls reads as a list and not as a stack of coloured cards. State glyphs
 * are the same everywhere: ◌ running · ✓ complete · × failed.
 *
 * Data shape: the AI SDK represents tool outputs as
 *   { type: 'tool-<name>', state: 'output-available' | ..., output: unknown }
 * Unknown tool names fall back to the plain line rendered in chat-message-list.
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
 * Single-use undo affordance · only renders when the tool output carries
 * undoToken + undoExpiresAt. Countdown ticks until 30s expires or the operator taps.
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
      <span className="shrink-0 inline-flex items-center px-2 font-mono text-[11px] text-emerald-300/80">
        undone
      </span>
    );
  }

  const onClick = async () => {
    setState("pending");
    try {
      await undoMutation.mutateAsync({ token });
      setState("done");
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
      className={cn(
        "shrink-0 inline-flex min-h-[44px] items-center gap-1 rounded-control px-2 -my-1.5 font-mono text-[11px] transition-colors",
        state === "ready" && "text-amber-300/90 hover:bg-amber-500/10 hover:text-amber-200",
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

export function ToolResultCard({ toolName, state, output }: ToolResultCardProps) {
  const config = TOOL_CONFIG[toolName];
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
  const isRunning = !isDone && !isError;
  const subtitle = isDone && config.subtitle ? config.subtitle(output) : null;
  const richBody = isDone && config.renderRich ? config.renderRich(output) : null;

  return (
    <div
      className={cn(
        "relative mb-1 mt-2 rounded-surface border bg-content px-3 py-2.5 transition-colors duration-[var(--motion-state)]",
        isError ? "border-rose-500/30" : "border-edge-subtle",
        isRunning && "chat-tool-shimmer",
      )}
      data-state={state}
    >
      <div className="flex items-center gap-3">
        {/* State glyph — the only coloured pixel on a receipt. */}
        <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden>
          {isRunning ? (
            <Loader2 size={14} className="animate-spin text-amber-300" />
          ) : isError ? (
            <span className="font-mono text-[13px] leading-none text-rose-300">×</span>
          ) : (
            <Icon size={14} className={colors.icon} />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className={cn("text-[13.5px] font-medium leading-snug", isError ? "text-rose-300" : "text-fg")}>
            {isError ? "Tool failed" : isDone ? config.doneLabel : config.runningLabel}
          </p>
          {subtitle && <p className="mt-0.5 truncate text-[12.5px] text-fg-secondary">{subtitle}</p>}
        </div>

        {isDone && (() => {
          const o = output as { undoToken?: string; undoExpiresAt?: string } | null;
          if (!o?.undoToken || !o?.undoExpiresAt) return null;
          const domain: "tasks" | "goals" | "people" =
            toolName === "archiveGoal" ? "goals" : toolName === "person.create" ? "people" : "tasks";
          return <UndoChip token={o.undoToken} expiresAt={o.undoExpiresAt} domain={domain} />;
        })()}

        {isDone && (() => {
          const dynLink = config.linkFn?.(output) ?? null;
          const link = dynLink ?? config.link;
          if (!link) return null;
          return (
            <Link
              href={link.href}
              className="shrink-0 -my-1.5 inline-flex min-h-[44px] items-center gap-1 rounded-control px-2 text-[12px] font-medium text-fg-secondary transition-colors hover:text-fg"
            >
              {link.label}
              <ChevronRight size={12} aria-hidden />
            </Link>
          );
        })()}
      </div>

      {richBody && <div className="mt-2 pl-8">{richBody}</div>}

      {isDone && rawJson && (
        <div className="pl-8">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            aria-expanded={expanded}
            className="mt-1 inline-flex min-h-[44px] items-center rounded-micro font-mono text-[11px] text-fg-tertiary transition-colors hover:text-fg-secondary sm:min-h-6"
            title={expanded ? "Hide developer detail" : "Show the raw tool output"}
          >
            {expanded ? "Hide developer detail" : "Developer detail"}
          </button>
          {expanded && (
            <pre className="mt-1 max-h-[280px] overflow-y-auto overflow-x-auto whitespace-pre-wrap break-words rounded-micro bg-canvas p-2 font-mono text-[11px] leading-[1.45] text-fg-secondary">
              {rawJson.slice(0, 8000)}
              {rawJson.length > 8000 && `\n\n…(${rawJson.length - 8000} chars truncated)`}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
