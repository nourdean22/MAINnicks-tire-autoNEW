"use client";

import dynamic from "next/dynamic";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { isKnownToolName } from "@/components/chat/tool-result-card";

/**
 * Renderers for the non-text `parts` that can appear on a chat
 * message: `file` attachments, `reasoning` thought traces, and any
 * `tool-*` invocation.
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · ~110 LOC of
 * three sibling renderers that lived inside a `msg.parts.map`
 * callback. Each renderer is now an independent named function so
 * the parent's map call reads as a single switch · tighter type
 * coverage on each branch · easier to unit-test in isolation.
 *
 * The heavy ToolResultCard (695 LOC) keeps the same dynamic-import
 * code-split so it only enters the bundle when the user actually
 * streams a tool call.
 */
const ToolResultCard = dynamic(
  () => import("@/components/chat/tool-result-card").then((m) => m.ToolResultCard),
  { ssr: false },
);

type FilePart = {
  type: "file";
  mediaType?: string;
  url?: string;
  filename?: string;
};

type ReasoningPart = {
  type: "reasoning";
  reasoning?: string;
  text?: string;
  content?: string;
};

type ToolPart = {
  type: string;
  state?: string;
  toolName?: string;
  output?: { dataUrl?: string; imageUrl?: string; [k: string]: unknown };
  args?: Record<string, unknown>;
};

/**
 * File attachment — images render as a clickable thumbnail (opens
 * full-size in new tab) · everything else renders as a download chip.
 */
export function FilePartRenderer({
  part,
  role,
}: {
  part: FilePart;
  role: string;
}) {
  if (!part.url) return null;
  const isImage = typeof part.mediaType === "string" && part.mediaType.startsWith("image/");
  return (
    <div
      className={cn(
        "mt-2 mb-1 flex",
        role === "user" ? "justify-end" : "justify-start",
      )}
    >
      {isImage ? (
        <a href={part.url} target="_blank" rel="noopener noreferrer" className="inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={part.url}
            alt={part.filename ?? "attachment"}
            className="rounded-lg max-w-full max-h-[280px] border border-[var(--border-default)] hover:opacity-90 transition-opacity"
          />
        </a>
      ) : (
        <a
          href={part.url}
          target="_blank"
          rel="noopener noreferrer"
          download={part.filename}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] transition-colors"
        >
          <Paperclip size={12} />
          <span>{part.filename ?? "file"}</span>
          {part.mediaType && (
            <span className="text-[10px] text-[var(--text-tertiary)]">{part.mediaType}</span>
          )}
        </a>
      )}
    </div>
  );
}

/**
 * Reasoning / thinking trace · collapsible details block.
 * Returns null when the part has no body text.
 */
export function ReasoningPartRenderer({ part }: { part: ReasoningPart }) {
  const reasoningText = part.reasoning || part.text || part.content || "";
  if (!reasoningText) return null;
  return (
    <details className="text-[11px] text-[var(--text-tertiary)] mt-1 border border-[var(--border)] rounded-lg p-2 bg-[var(--bg-secondary)]">
      <summary className="cursor-pointer select-none font-medium">thinking…</summary>
      <p className="whitespace-pre-wrap mt-2 opacity-80 text-[12px] leading-relaxed">{reasoningText}</p>
    </details>
  );
}

/**
 * Tool invocation · three render branches:
 *   1. Tool produced an image (output.dataUrl / output.imageUrl) ·
 *      render the thumbnail.
 *   2. Known tool name · render the rich ToolResultCard.
 *   3. Unknown tool · plain pill (gold when done · pulsing dim when
 *      still streaming).
 */
export function ToolPartRenderer({ part }: { part: ToolPart }) {
  const toolName = part.type.replace("tool-", "");
  const humanName = toolName.replace(/([A-Z])/g, " $1").trim();
  const imgSrc = part.state === "output-available" && (part.output?.dataUrl || part.output?.imageUrl);
  if (imgSrc) {
    return (
      <div className="mt-2 mb-1">
        <a href={imgSrc} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgSrc as string}
            alt={typeof part.output?.prompt === "string" ? part.output.prompt : "Generated image"}
            className="rounded-lg max-w-full max-h-[400px] border border-[var(--border)] cursor-pointer hover:opacity-90 transition-opacity"
            loading="lazy"
          />
        </a>
        <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
          Tap to view full size
          {part.output?.model ? ` | ${String(part.output.model)}` : ""}
          {part.output?.size ? ` | ${String(part.output.size)}` : ""}
        </p>
      </div>
    );
  }
  // Rich card for known tools, plain pill otherwise.
  if (isKnownToolName(toolName)) {
    return (
      <ToolResultCard
        toolName={toolName}
        state={part.state ?? "pending"}
        output={part.output}
      />
    );
  }
  return part.state === "output-available" ? (
    <span className="inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 mt-1 mr-1 text-[var(--gold)] bg-[var(--gold-ghost)]">
      {humanName}
    </span>
  ) : (
    <span className="text-[11px] text-[var(--text-tertiary)] animate-pulse">{humanName}...</span>
  );
}
