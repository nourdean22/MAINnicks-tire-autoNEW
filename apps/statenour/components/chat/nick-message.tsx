/**
 * Nick's Message Renderer.
 *
 * Markdown-aware assistant message component. Handles:
 * - Stripping Venice GLM <think> blocks and action blocks
 * - Markdown rendering via Streamdown (block-memoized, streaming-aware)
 * - Extracting ```action``` JSON badges
 * - Contextual quick-action suggestions based on response content
 *
 * v11.1 · Swapped react-markdown for Streamdown (Tier-3 fluidity).
 * Streamdown parses markdown into a memoized block array and only
 * re-renders the CHANGED block on each token — for a 40-token reply
 * that's one-block rerender per token vs full-tree rerender × 40.
 * Net effect: streaming feels liquid instead of stuttery, especially
 * on long replies with code blocks or tables.
 *
 * Also turns on parseIncompleteMarkdown so partial "**bold" or "```"
 * tokens don't flicker half-rendered mid-stream.
 */

"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { Streamdown, type Components as StreamdownComponents } from "streamdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { alreadyHasGeneratedImage, looksLikeMarketingContent } from "@/lib/chat/marketing-detection";

import { trpc } from "@/lib/trpc/client";
import { InlineChart, parseChartSpec } from "@/components/chat/inline-chart";
import { EmailDraftCard, parseEmailDraft } from "@/components/chat/email-draft-card";
import { ImageWithUpscale } from "@/components/chat/image-with-upscale";
import { StitchPromptCard } from "@/components/chat/stitch-prompt-card";

// v10.0.49 · Helper for the rich-render <pre> intercept. Streamdown
// passes the inner <code> element's children as either a string, an
// array of nodes, or a nested element — we flatten back to text so
// the chart/email payload parser can see the JSON.
function extractCodeText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractCodeText).join("");
  if (React.isValidElement(node)) {
    const children = (node as React.ReactElement<{ children?: React.ReactNode }>).props.children;
    return extractCodeText(children);
  }
  return "";
}

// v11.0 W7 · Shared markdown-renderer prop shape. React-markdown
// calls each override with an inconsistent prop set (children, href,
// src, alt, className, checked, ordered, node…) depending on the
// element kind. Using a loose Record keeps the 23 override sites
// type-safe without fighting react-markdown's internal types.
type MDProps = {
  children?: React.ReactNode;
  href?: string;
  src?: string;
  alt?: string;
  className?: string;
  checked?: boolean;
  ordered?: boolean;
  node?: unknown;
};

interface QuickAction {
  label: string;
  prompt: string;
}

export interface MessageTiming {
  sentAt: number;
  firstTokenAt?: number;
  endedAt?: number;
  /** Optional override for a custom label, e.g. 'regenerated' */
  label?: string;
}

interface NickMessageProps {
  text: string;
  onQuickAction?: (text: string) => void;
  /** When true, a pulsing gold cursor appears at the end of the text (#1). */
  streaming?: boolean;
  /** Optional timing data for the speed ribbon (#3). */
  timing?: MessageTiming;
  /** Whether to render the timing ribbon when timing is provided. */
  showTiming?: boolean;
  /** Message ID for feedback tracking */
  messageId?: string;
  /**
   * v10.0.517 · conversationId for the fresh-stream fallback on the
   * reasoning-trace route. When useChat's SDK-minted msg.id doesn't
   * match the DB cuid yet (timing window between stream-end and
   * persist write), the by-message route falls back to "latest
   * assistant in this conversation."
   */
  conversationId?: string;
  /** v6 · model that generated this reply (e.g. "venice-uncensored",
   *  "qwen3-vl:235b-instruct"). Renders as a tiny corner badge so
   *  Nour can see at a glance which model handled which turn. */
  model?: string | null;
}

export function NickMessage({
  text,
  onQuickAction,
  streaming = false,
  timing,
  showTiming = false,
  messageId,
  conversationId,
  model,
}: NickMessageProps) {
  // v10.0.116 audit fix · memoize on text. During a streaming reply
  // this component re-renders on every token; the regex chain ran
  // hundreds of times against ever-growing text. quickActions array
  // identity also changes on every render which forces child re-mounts.
  const { clean, actions, quickActions, parsedStitchPrompt } = useMemo(() => {
    const cleaned = text
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<\/?think>/gi, "")
      .replace(/```action\s*\n[\s\S]*?\n```/g, "")
      .replace(/\[ACTION:\s*\{[\s\S]*?\}\]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const acts: string[] = [];
    const re = /```action\s*\n([\s\S]*?)\n```/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      try {
        const p = JSON.parse(m[1]);
        if (p.type) acts.push(p.type.replace(".", " · "));
      } catch {}
    }

    let stitchPrompt = null;
    try {
      if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
        const parsed = JSON.parse(cleaned);
        if (parsed && typeof parsed === "object" && parsed.oneLinePurpose && parsed.designSystem && parsed.finalPromptMarkdown) {
          stitchPrompt = parsed;
        }
      }
    } catch {}

    return {
      clean: cleaned,
      actions: acts,
      quickActions: detectQuickActions(cleaned),
      parsedStitchPrompt: stitchPrompt,
    };
  }, [text]);

  return (
    <div>
      {/* v11.1 fluidity:
          · min-h-[24px] pre-allocates one line of height so the first
            token arrives with no layout jump (the message pill expands
            into existing space rather than pushing history down).
          · nick-prose--streaming flips text-rendering to optimizeSpeed
            only DURING streaming → smoother fill, crisp final paint. */}
      <div
        className={cn(
          "nick-prose min-h-[24px]",
          streaming && "nick-prose--streaming",
        )}
      >
        {parsedStitchPrompt ? (
          <StitchPromptCard data={parsedStitchPrompt} />
        ) : (
          <Streamdown
            remarkPlugins={[remarkGfm]}
            parseIncompleteMarkdown={true}
            mode={streaming ? "streaming" : "static"}
            /* v11.1 · `components` cast below is intentional. Streamdown
               types each override strictly by HTML element — MDProps is
               our shared loose shape that's runtime-compatible but not
               structurally identical. Cast via unknown so TypeScript
               doesn't require rewriting all 23 override signatures. */
            components={{

            // Headings
            h1: ({ children }: MDProps) => <p className="text-[var(--gold)] font-semibold text-[13.5px] mt-3 mb-1">{children}</p>,
            h2: ({ children }: MDProps) => <p className="text-[var(--gold)] font-semibold text-[13.5px] mt-3 mb-1">{children}</p>,
            h3: ({ children }: MDProps) => <p className="text-[var(--text-primary)] font-semibold text-[13px] mt-2 mb-0.5">{children}</p>,
            h4: ({ children }: MDProps) => <p className="text-[var(--text-primary)] font-medium text-[12px] mt-2 mb-0.5">{children}</p>,
            // Text
            p: ({ children }: MDProps) => <p className="mb-1.5 leading-relaxed">{children}</p>,
            strong: ({ children }: MDProps) => <strong className="text-[var(--gold)] font-semibold">{children}</strong>,
            em: ({ children }: MDProps) => <em className="text-[var(--text-primary)] not-italic">{children}</em>,
            del: ({ children }: MDProps) => <del className="text-[var(--text-tertiary)] line-through">{children}</del>,
            // Links
            a: ({ href, children }: MDProps) => (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--gold)] underline underline-offset-2 hover:text-[var(--gold)]/80 transition-colors">
                {children}
              </a>
            ),
            // Images — Apr 27 · BROKEN-IMAGE GUARD + Apr 28 · UPSCALE OVERLAY.
            // The AI sometimes hallucinates `![Generated Image](/api/
            // images/{fakeId})` markdown instead of actually invoking
            // the generateImage tool. The browser shows a silent broken-
            // image icon — we catch with onError and replace with an
            // honest error chip.
            //
            // v6 · BATCH 2 · Apr 28 — added upscale (2x/4x) overlay
            // buttons on hover. Click POSTs to /api/images/upscale and
            // swaps the src in-place when the new image returns. Cost
            // tracked via AiGeneration so the cost dashboard sees the
            // spend in real time.
            img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
              const { src, alt } = props;
              const srcStr = typeof src === "string" ? src : "";
              // Only render upscale overlay for our own image URLs
              // (i.e. /api/images/{id}). External images get no overlay.
              const idMatch = srcStr.match(/\/api\/images\/([a-zA-Z0-9_-]+)/);
              const imageId = idMatch?.[1];
              return (
                <ImageWithUpscale srcStr={srcStr} alt={alt || "Generated image"} imageId={imageId} />
              );
            },
            // Code — react-markdown v9 deprecated the `inline` prop and
            // now relies on the parent to wrap fenced blocks in <pre>.
            // Inline code has NO className; fenced blocks have a
            // "language-X" className. We render inline-only here and
            // let the `pre` override handle the block case. Previously
            // we wrapped everything in <pre><code> which produced a
            // <pre> inside a <p> → hydration crash on any message
            // containing backticks.
            code: ({ className, children }: MDProps) => {
              const isBlock = !!className && className.startsWith("language-");
              if (isBlock) {
                // Block-level: react-markdown wraps us in <pre> already.
                // Rich-render code blocks (language-chart, language-
                // email-draft) are intercepted at the <pre> layer below
                // so we can render block-level / SVG components without
                // the invalid <pre><div>...</div> nesting.
                return (
                  <code className={cn(className, "text-[11px] font-mono text-[var(--text-secondary)] leading-relaxed")}>
                    {children}
                  </code>
                );
              }
              return (
                <code className="bg-[var(--bg-raised)] border border-[var(--border-default)] rounded px-1.5 py-0.5 text-[11px] font-mono text-[var(--text-primary)]">
                  {children}
                </code>
              );
            },
            // Pre — override for fenced code blocks. react-markdown
            // calls this with the <code> child inside.
            //
            // v10.0.49 · Rich-render interception. When the child <code>
            // has className `language-chart` or `language-email-draft`,
            // we parse the raw text and render the corresponding React
            // component directly, BYPASSING the <pre>. This avoids the
            // hydration error from putting <div>/<svg> inside <pre>.
            // Malformed payloads fall through to the plain <pre> path.
            pre: ({ children }: MDProps) => {
              if (React.isValidElement(children)) {
                const childProps = (children as React.ReactElement<{
                  className?: string;
                  children?: React.ReactNode;
                }>).props;
                const cls = childProps.className;
                if (cls === "language-chart" || cls === "language-email-draft") {
                  const raw = extractCodeText(childProps.children).trim();
                  if (cls === "language-chart") {
                    const spec = parseChartSpec(raw);
                    if (spec) return <InlineChart spec={spec} />;
                  } else {
                    const draft = parseEmailDraft(raw);
                    if (draft) return <EmailDraftCard draft={draft} />;
                  }
                  // fall through to plain <pre> on parse failure
                }
              }
              return (
                <pre className="bg-[var(--bg-void)] border border-[var(--border-default)] rounded-lg p-3 my-2 overflow-x-auto">
                  {children}
                </pre>
              );
            },
            // Lists
            ul: ({ children }: MDProps) => <ul className="space-y-0.5 my-1">{children}</ul>,
            ol: ({ children }: MDProps) => <ol className="space-y-0.5 my-1 list-decimal list-inside">{children}</ol>,
            li: ({ children, ordered }: MDProps) => (
              <li className="pl-2 relative text-[var(--text-secondary)]">
                {!ordered && <span className="absolute left-0 text-[var(--text-tertiary)]">·</span>}
                <span className="pl-2">{children}</span>
              </li>
            ),
            // Tables
            table: ({ children }: MDProps) => (
              <div className="overflow-x-auto my-2">
                <table className="w-full text-[11px] border-collapse">{children}</table>
              </div>
            ),
            thead: ({ children }: MDProps) => <thead className="border-b border-[var(--border-default)]">{children}</thead>,
            tbody: ({ children }: MDProps) => <tbody>{children}</tbody>,
            tr: ({ children }: MDProps) => <tr className="border-b border-[var(--border-default)]/30">{children}</tr>,
            th: ({ children }: MDProps) => <th className="text-left py-1.5 px-2 text-[var(--gold)] font-semibold text-[10px] uppercase tracking-wider">{children}</th>,
            td: ({ children }: MDProps) => <td className="py-1 px-2 text-[var(--text-secondary)]">{children}</td>,
            // Blockquote
            blockquote: ({ children }: MDProps) => (
              <blockquote className="border-l-2 border-[var(--gold)]/30 pl-3 my-2 text-[var(--text-tertiary)] italic">{children}</blockquote>
            ),
            // Horizontal rule
            hr: () => <hr className="border-[var(--border-default)] my-3" />,
            // Task list items (GFM)
            input: ({ checked }: MDProps) => (
              <span className={cn("inline-block w-3.5 h-3.5 rounded border mr-1.5 align-text-bottom", checked ? "bg-emerald-500/20 border-emerald-500/40" : "border-[var(--border-default)]")}>
                {checked && <span className="text-emerald-400 text-[9px] flex items-center justify-center">✓</span>}
              </span>
            ),
          } as unknown as StreamdownComponents}
        >
          {clean}
        </Streamdown>
      )}
      </div>
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {actions.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/8 border border-emerald-500/15 rounded-full px-2 py-0.5">
              <span className="w-1 h-1 rounded-full bg-emerald-400" />{a}
            </span>
          ))}
        </div>
      )}
      {streaming && (
        <span
          className="inline-block w-[6px] h-[13px] ml-0.5 -mb-0.5 bg-[var(--gold)] rounded-sm align-baseline"
          style={{ animation: "pulse 1.2s ease-in-out infinite" }}
          aria-hidden="true"
        />
      )}
      {quickActions.length > 0 && onQuickAction && (
        <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2 border-t border-[var(--glass-border)]">
          {quickActions.map((qa) => (
            // v10.0.48 — `key={qa.label}` instead of `key={i}`.
            // detectQuickActions re-runs on every streaming token and
            // can shift the action set mid-stream. Stable label key
            // forces remount when action identity changes, preventing
            // a stale closure on the click handler.
            <button
              key={qa.label}
              onClick={() => onQuickAction(qa.prompt)}
              className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--gold)]/30 hover:text-[var(--gold)] transition-all"
            >
              {qa.label}
            </button>
          ))}

        </div>
      )}

      {/* v10.0.515 · #7 reasoning-trace · "why this answer" lazy panel.
          Mounts only on non-streaming, settled assistant messages so
          we never hit the API mid-stream. Gracefully no-ops if no
          messageId (legacy/optimistic rows). v10.0.517 · passes
          conversationId so the by-message route can fall back to
          latest-assistant when the SDK-minted msg.id doesn't match
          the DB cuid yet (fresh-stream timing). */}


      {showTiming && timing && timing.endedAt && (
        <div className="flex items-center gap-2 mt-1.5 pt-1 border-t border-[var(--border-default)]/30 text-[8px] font-mono text-[var(--text-tertiary)] tabular-nums">
          {timing.firstTokenAt && (
            <span title="Time to first token">
              first {((timing.firstTokenAt - timing.sentAt) / 1000).toFixed(2)}s
            </span>
          )}
          {timing.firstTokenAt && (
            <>
              <span className="opacity-50">·</span>
              <span title="Stream duration">
                stream {((timing.endedAt - timing.firstTokenAt) / 1000).toFixed(2)}s
              </span>
            </>
          )}
          <span className="opacity-50">·</span>
          <span title="End-to-end latency">
            total {((timing.endedAt - timing.sentAt) / 1000).toFixed(2)}s
          </span>
          {timing.label && (
            <>
              <span className="opacity-50">·</span>
              <span className="text-[var(--gold)]/60">{timing.label}</span>
            </>
          )}
          {model && (
            <>
              <span className="opacity-50">·</span>
              {/* v6 · Model badge — at-a-glance which model handled this turn.
                   Tooltip shows full model id; visible label is shortened. */}
              <span title={`Model: ${model}`} className="text-[var(--text-secondary)]/70">
                {prettyModelLabel(model)}
              </span>
            </>
          )}
        </div>
      )}

      {/* v6 · Model badge (when no timing ribbon — mid-stream messages
           or older history without timing data). Always shows on assistant
           replies that have a model field, separately from the timing row. */}
      {!showTiming && model && (
        <div className="flex items-center gap-1 mt-1 text-[8px] font-mono text-[var(--text-tertiary)]/60 tabular-nums">
          <span title={`Model: ${model}`}>{prettyModelLabel(model)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * v6 · Shorten model identifiers for the badge. Tooltip retains the full
 * id. Examples:
 *   "venice-uncensored" → "venice"
 *   "olafangensan-glm-4.7-flash-heretic" → "venice-glm4.7"
 *   "qwen3-vl:235b-instruct" → "ollama-qwen3-vl"
 *   "deepseek-v4-flash" → "ollama-deepseek-v4"
 *   "gpt-4o-mini" → "openai-4o-mini"
 *   "claude-sonnet-4-6" → "anthropic-sonnet"
 *   "venice-image" / "recraft-v4" / "nano-banana-2" → image-model name as-is
 */
function prettyModelLabel(model: string): string {
  const m = model.toLowerCase();
  if (m === "venice-image") return "venice-image";
  if (m.startsWith("recraft") || m.startsWith("nano-banana") || m.startsWith("z-image") || m.startsWith("flux")) return m;
  if (m.includes("venice") || m.includes("heretic") || m.includes("glm-4")) return "venice-glm";
  if (m.includes("qwen3-vl")) return "ollama-qwen3-vl";
  if (m.includes("qwen3")) return "ollama-qwen3";
  if (m.includes("deepseek")) return "ollama-deepseek";
  if (m.includes("kimi")) return "ollama-kimi";
  if (m.includes("glm-5") || m.includes("glm5")) return "ollama-glm5";
  if (m.startsWith("gpt-")) return `openai-${m.replace(/^gpt-/, "")}`;
  if (m.includes("claude")) return `anthropic-${m.match(/-([a-z]+)/)?.[1] ?? "claude"}`;
  // Fall back to model id truncated
  return m.length > 22 ? `${m.slice(0, 22)}…` : m;
}

// Detect contextual quick-action buttons based on Nick's response content
function detectQuickActions(text: string): QuickAction[] {
  const actions: QuickAction[] = [];
  const lower = text.toLowerCase();

  // Apr 27 v2 · Marketing-content detection — when Nick just wrote a
  // social caption, ad copy, post draft, headline, etc. surface a
  // one-tap "Generate image" so Nour doesn't have to type "now make
  // the picture" (which then hits the synth path anyway). Skip if the
  // message ALREADY contains an image (avoid double-gen on a turn that
  // already had visual output).
  const alreadyHasImage = alreadyHasGeneratedImage(text);
  if (!alreadyHasImage && looksLikeMarketingContent(text)) {
    actions.push({
      label: "Generate image for this",
      prompt: "now generate the picture",
    });
  }

  if (lower.includes("revenue") || lower.includes("$")) {
    actions.push({ label: "Revenue breakdown", prompt: "Break down today's revenue by service type" });
  }
  if (lower.includes("lead") || lower.includes("estimate")) {
    actions.push({ label: "Open lead queue", prompt: "Show me leads that haven't been contacted in 24+ hours" });
  }
  if (lower.includes("drift") || lower.includes("habit")) {
    actions.push({ label: "What should I do next?", prompt: "What's the single most important thing I should do right now?" });
  }
  if (lower.includes("task") || lower.includes("todo") || lower.includes("action item")) {
    actions.push({ label: "Create task", prompt: "Create a task for the most important action item you just mentioned" });
  }
  if (lower.includes("decision") || lower.includes("choose") || lower.includes("should i")) {
    actions.push({ label: "Log this decision", prompt: "Log this decision in my decision journal with the reasoning" });
  }


  return actions.slice(0, 3);
}

// Marketing-content heuristic moved to lib/chat/marketing-detection.ts
// so the chat page can use the same detector for auto-firing image gen.
// Imported at the top of this file as `looksLikeMarketingContent`.
