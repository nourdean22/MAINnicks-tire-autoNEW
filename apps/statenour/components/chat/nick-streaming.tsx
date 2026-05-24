"use client";

/**
 * NICK STREAMING — Apr 27 rebuild · state-aware activity indicator.
 *
 * Old version was a generic "Nick is thinking…" line with three
 * bouncing dots. Worked, but felt like every other AI chatbot. New
 * version reports REALITY with cinematic detail:
 *
 *   - Default thinking → soft dot pulse · gold
 *   - In-flight tool   → tool name + tinted ring · sky
 *   - Stalled / deep   → warm ember pulse · amber, "thinking deeper"
 *   - Multiple tools   → counts how many are pending
 *
 * No fake activity messages. Status text is derived from the actual
 * useChat message parts. The visual differentiation comes from
 * tone + pulse rhythm, not theater.
 *
 * Mobile-readable: 12.5px text on the status line, 16×16 ring so
 * the activity is visible without zoom.
 */

import { cn } from "@/lib/utils";

interface NickStreamingProps {
  /** The latest message object from useChat (may be user or assistant). */
  lastMessage: { role: string; parts?: Array<{ type: string; state?: string }> } | undefined;
  /** Apr 20 — stall-detection status from useStallDetection.
   *  When "warn" or "stalled", the streaming indicator reframes
   *  itself from "thinking" to "thinking deeper" + shows how many
   *  tools are still pending. Anxiety → engagement info. */
  stallStatus?: "idle" | "healthy" | "warn" | "stalled";
}

// ── Humanize tool type to a readable label ──
function humanizeTool(type: string): string {
  const raw = type.replace("tool-", "");
  return raw.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim().toLowerCase();
}

export function NickStreaming({ lastMessage, stallStatus }: NickStreamingProps) {
  // Look for any in-progress tool call in the latest assistant message
  const inProgressTool = lastMessage?.role === "assistant"
    ? lastMessage.parts?.find(p => p.type.startsWith("tool-") && p.state !== "output-available")
    : null;

  // Count ALL pending tools — stall reframe shows this so Nour sees
  // "thinking deeper — 3 tools pending" instead of "seems stuck".
  const pendingTools =
    lastMessage?.role === "assistant"
      ? (lastMessage.parts || []).filter(
          (p) => p.type.startsWith("tool-") && p.state !== "output-available"
        ).length
      : 0;

  const isStalled = stallStatus === "warn" || stallStatus === "stalled";

  // Three modes of being. Each gets its own tone + pulse rhythm.
  type Mode = "thinking" | "tool" | "deep";
  const mode: Mode = inProgressTool ? "tool" : isStalled ? "deep" : "thinking";

  const statusText =
    mode === "tool"
      ? humanizeTool(inProgressTool!.type)
      : mode === "deep"
        ? pendingTools > 0
          ? `thinking deeper · ${pendingTools} tool${pendingTools > 1 ? "s" : ""} pending`
          : "thinking deeper…"
        : "thinking…";

  // Tone palette per mode. Variables resolve through globals.css so
  // the dark/light theme adapts naturally if we ever ship a light mode.
  const tone =
    mode === "tool"
      ? {
          ring: "border-sky-400/40",
          dot: "bg-sky-400",
          text: "text-sky-300",
          glow: "rgba(56,189,248,0.35)",
        }
      : mode === "deep"
        ? {
            ring: "border-amber-400/50",
            dot: "bg-amber-400",
            text: "text-amber-300",
            glow: "rgba(251,191,36,0.45)",
          }
        : {
            ring: "border-[var(--gold)]/30",
            dot: "bg-[var(--gold)]",
            text: "text-[var(--text-tertiary)]",
            glow: "rgba(212,175,55,0.30)",
          };

  return (
    // 2026-05-24 · Wave X · a11y · pre-fix the streaming indicator
    // had no role/aria-live · screen-reader operators on iPhone PWA
    // never heard "Nick is thinking" or "3 tools pending." The
    // mode-tinted pulse + status text changes were silent. Now: the
    // parent gets role="status" + aria-live="polite" so VoiceOver
    // announces state changes without preempting other speech.
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex items-center gap-2.5 py-2 px-1">
      {/* Cinematic ring + pulse · mode-tinted */}
      <div className="relative shrink-0 w-4 h-4 flex items-center justify-center">
        {/* Outer breathing ring — slower in deep mode (genuine work
            takes time), faster in tool mode (active fetch). */}
        <div
          className={cn(
            "absolute inset-0 rounded-full border",
            tone.ring,
            mode === "deep" ? "nick-ring-slow" : "nick-ring-fast",
          )}
        />
        <div
          className={cn(
            "w-1.5 h-1.5 rounded-full nick-orb-streaming",
            tone.dot,
          )}
          style={{
            // Inline glow so the dot reads even on dark surfaces
            boxShadow: `0 0 8px 1px ${tone.glow}`,
          }}
        />
      </div>

      {/* Status text — italic, tabular numbers so the tool count
          doesn't shimmy when it ticks down. */}
      <div className="relative flex-1 min-w-0">
        <span
          className={cn(
            "text-[12.5px] sm:text-[11px] italic tracking-wide tabular-nums",
            tone.text,
          )}
        >
          Nick is {statusText}
        </span>
      </div>

      {/* Three bouncing dots, staggered. Mode-tinted. Tighter spacing
          on mobile, looser on desktop. */}
      <div className="flex gap-0.5 shrink-0">
        {[0, 150, 300].map((d) => (
          <div
            key={d}
            className={cn("w-1 h-1 rounded-full animate-pulse", tone.dot)}
            style={{ animationDelay: `${d}ms`, animationDuration: mode === "deep" ? "1.6s" : "1.0s" }}
          />
        ))}
      </div>
    </div>
  );
}
