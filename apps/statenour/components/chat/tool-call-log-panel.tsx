"use client";

/**
 * ToolCallLogPanel — "What tools did Nick use" sidebar (#6).
 *
 * Slides in from the right of the chat page when toggled. Shows every
 * tool call from the current conversation in chronological order with:
 *   - Tool name
 *   - State (pending / running / output-available / output-error)
 *   - Duration if available
 *   - Click to expand the raw input + output payload
 *
 * Debug gold. Also proves to Nour that Nick is ACTUALLY calling tools
 * when he says he is — no hallucinated tool usage.
 *
 * Data comes directly from the messages array passed by the chat page,
 * so no backend call needed. Updates live as new tool calls stream in.
 */

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  X,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  ChevronDown,
} from "lucide-react";

interface ToolCallEntry {
  id: string;
  toolName: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error" | string;
  input?: unknown;
  output?: unknown;
  error?: string;
  messageIndex: number;
}

// v10.0.313 · MessagePart loosened to a structural shape with optional
// fields · ToolCallLogPanelProps generic over a message type that
// matches ChatMessageLike (id + role + parts). This drops the
// `as unknown as` cast at the /chat call-site without forcing the
// caller to narrow its UIMessage[] manually.
interface MessagePart {
  type: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  text?: string;
  // Pass through unknown extra fields the AI SDK adds without
  // breaking the structural match.
  [key: string]: unknown;
}

interface MessageLike {
  id?: string;
  role: string;
  parts?: ReadonlyArray<{ type: string; [key: string]: unknown }>;
}

interface ToolCallLogPanelProps<M extends MessageLike> {
  open: boolean;
  onClose: () => void;
  messages: M[];
}

function extractToolCalls<M extends MessageLike>(messages: M[]): ToolCallEntry[] {
  const entries: ToolCallEntry[] = [];

  messages.forEach((msg, msgIndex) => {
    if (!msg.parts) return;
    for (const rawPart of msg.parts) {
      if (!rawPart.type?.startsWith("tool-")) continue;
      // Narrow the part down to the fields we read · MessageLike's
      // index signature makes them `unknown` so we cast at this
      // boundary to MessagePart's typed shape.
      const part = rawPart as unknown as MessagePart;
      const toolName = part.type.replace(/^tool-/, "");
      entries.push({
        id: part.toolCallId || `${msgIndex}-${toolName}-${entries.length}`,
        toolName,
        state: part.state || "unknown",
        input: part.input,
        output: part.output,
        error: part.errorText,
        messageIndex: msgIndex,
      });
    }
  });

  return entries;
}

export function ToolCallLogPanel<M extends MessageLike>({ open, onClose, messages }: ToolCallLogPanelProps<M>) {
  const toolCalls = useMemo(() => extractToolCalls(messages), [messages]);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[99] bg-black/40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 bottom-0 z-[100] w-80 md:w-96 bg-[var(--bg-void)] border-l border-[var(--border-default)] shadow-2xl flex flex-col animate-fadeSlideUp">
        <div className="shrink-0 px-4 py-3 border-b border-[var(--border-default)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wrench size={13} className="text-[var(--gold)]" />
            <span className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-[var(--gold)]">
              Tool Call Log
            </span>
            <span className="text-[9px] text-[var(--text-tertiary)] font-mono">
              {toolCalls.length} {toolCalls.length === 1 ? "call" : "calls"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {toolCalls.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-[11px] text-[var(--text-tertiary)] text-center">
              No tool calls yet in this conversation. Nick will call tools
              when he needs data you can&apos;t see in the hot context.
            </div>
          ) : (
            toolCalls.map((call) => {
              const isExpanded = expanded === call.id;
              return (
                <div
                  key={call.id}
                  className={cn(
                    "rounded-md border bg-[var(--bg-elevated)] transition-colors",
                    call.state === "output-error"
                      ? "border-red-500/30"
                      : call.state === "output-available"
                      ? "border-[var(--border-default)] hover:border-[var(--gold)]/30"
                      : "border-amber-500/30"
                  )}
                >
                  <button
                    onClick={() => setExpanded(isExpanded ? null : call.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
                  >
                    {isExpanded ? (
                      <ChevronDown size={10} className="text-[var(--text-tertiary)]" />
                    ) : (
                      <ChevronRight size={10} className="text-[var(--text-tertiary)]" />
                    )}
                    <ToolStateIcon state={call.state} />
                    <span className="text-[11px] font-mono text-[var(--text-primary)] flex-1 truncate">
                      {call.toolName}
                    </span>
                    <span className="text-[8px] text-[var(--text-tertiary)] uppercase shrink-0">
                      {call.state.replace("-", " ")}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="px-2.5 pb-2.5 space-y-2">
                      {call.input != null && (
                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-0.5">
                            Input
                          </p>
                          <pre className="text-[9px] font-mono text-[var(--text-secondary)] bg-[var(--bg-void)] border border-[var(--border-default)] rounded p-1.5 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">
                            {JSON.stringify(call.input, null, 2)}
                          </pre>
                        </div>
                      )}
                      {call.output != null && (
                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-0.5">
                            Output
                          </p>
                          <pre className="text-[9px] font-mono text-[var(--text-secondary)] bg-[var(--bg-void)] border border-[var(--border-default)] rounded p-1.5 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                            {typeof call.output === "string"
                              ? call.output
                              : JSON.stringify(call.output, null, 2)}
                          </pre>
                        </div>
                      )}
                      {call.error && (
                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-wider text-red-300 mb-0.5">
                            Error
                          </p>
                          <p className="text-[10px] text-red-300/80 font-mono">
                            {call.error}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

function ToolStateIcon({ state }: { state: string }) {
  if (state === "output-available") {
    return <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />;
  }
  if (state === "output-error") {
    return <XCircle size={11} className="text-red-400 shrink-0" />;
  }
  return <Loader2 size={11} className="text-amber-400 shrink-0 animate-spin" />;
}
