"use client";

/**
 * PageNick — universal "Ask Nick about this page" component.
 *
 * Drop-in for any mastery page that has data. Shows a compact button
 * row: "Ask Nick" + quick preset questions. Click → streams Nick's
 * analysis of the current page state into an expandable card below
 * the button.
 *
 * Each page passes:
 *   - page: string        — route identifier (body, financial, loops, etc.)
 *   - data: unknown       — whatever structured data the page is showing
 *   - presets?: string[]  — quick question buttons (optional)
 *   - className?: string
 *
 * The component handles:
 *   - Streaming text display with progressive rendering
 *   - Loading / error / empty states
 *   - Haptic feedback on send, success, error
 *   - Auto-scroll into view
 *   - Copy response to clipboard
 *   - Open follow-up in full /chat with the same context
 *
 * Uses the shared /api/ai/page-insight endpoint which routes through
 * the canonical provider.ts chain (Venice-uncensored for fast task).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Brain,
  Send,
  X,
  Copy,
  MessageSquare,
  Loader2,
  Sparkles,
} from "lucide-react";
import { haptic } from "@/lib/ui/haptic";

export interface PageNickProps {
  page: string;
  /**
   * Whatever structured data the page is showing. OPTIONAL — if omitted,
   * the server-side /api/ai/page-insight route falls back to
   * buildPageData(page) which pulls a compact summary from the DB. Pages
   * that already hold their state in React should pass it for richer,
   * more up-to-date analysis.
   */
  data?: unknown;
  /** Optional one-line focus that biases the analysis */
  focus?: string;
  /** Preset questions shown as pills for one-tap access */
  presets?: string[];
  /** Optional custom placeholder for the input */
  placeholder?: string;
  /**
   * Kick off the analysis automatically on mount. Mirrors the old
   * AiInsight.autoLoad behavior — used by pages like /mastery where
   * the insight is the headline value-prop.
   */
  autoLoad?: boolean;
  className?: string;
}

export function PageNick({
  page,
  data,
  focus,
  presets,
  placeholder,
  autoLoad = false,
  className,
}: PageNickProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [response, setResponse] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const ask = useCallback(
    async (overrideQuestion?: string) => {
      const q = overrideQuestion ?? question.trim();
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setOpen(true);
      setStreaming(true);
      setResponse("");
      setError(null);
      haptic.tap();

      try {
        // scattered-components REST→tRPC slice (2026-05-22) · this is a
        // streaming text response (`result.toTextStreamResponse()`) —
        // per the tRPC migration plan streaming endpoints stay REST
        // (tRPC v11 has no first-class streaming transport). The only
        // change is dropping `authedFetch` for a plain `fetch`:
        // `credentials: "include"` carries the NextAuth cookie, and the
        // `AbortController` signal needs the raw fetch anyway.
        const res = await fetch("/api/ai/page-insight", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            page,
            focus,
            data,
            question: q || undefined,
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          accumulated += chunk;
          // Strip any <think> blocks that leak through (belt + suspenders)
          const visible = accumulated
            .replace(/<think>[\s\S]*?<\/think>/gi, "")
            .replace(/<\/?think>/gi, "")
            .trimStart();
          setResponse(visible);
        }

        haptic.success();
        if (!q && !overrideQuestion) setQuestion("");
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        haptic.error();
        setError(err instanceof Error ? err.message : "ask failed");
      } finally {
        setStreaming(false);
      }
    },
    [page, data, focus, question]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  const copy = useCallback(async () => {
    if (!response) return;
    try {
      await navigator.clipboard.writeText(response);
      haptic.success();
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      haptic.error();
    }
  }, [response]);

  const openInChat = useCallback(() => {
    const seed = question || `Analyze my ${page} page`;
    // lint-baseline 2026-08-13 · client-side nav instead of a full reload;
    // the chat deep-link prefill hook reads ?q= via useSearchParams, so
    // soft navigation carries the seed identically.
    router.push(`/chat?q=${encodeURIComponent(seed)}`);
  }, [page, question, router]);

  const dismiss = useCallback(() => {
    setOpen(false);
    setResponse("");
    setError(null);
    setQuestion("");
  }, []);

  // Auto-load once on mount if requested. Tracked via ref so React
  // strict-mode re-mounts don't fire two requests in a row.
  const autoLoadFiredRef = useRef(false);
  useEffect(() => {
    if (autoLoad && !autoLoadFiredRef.current) {
      autoLoadFiredRef.current = true;
      ask();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]/40 p-2.5 space-y-2",
        className
      )}
    >
      {/* Trigger row */}
      <div className="flex items-center gap-1.5">
        <Brain size={12} className="text-[var(--gold)] shrink-0" />
        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--gold)] shrink-0">
          Ask Nick
        </span>
        <div className="flex-1" />
        {!open && (
          <button
            onClick={() => {
              setOpen(true);
              haptic.tap();
            }}
            className="flex items-center gap-1 px-2 h-6 rounded-md border border-[var(--gold)]/30 bg-[var(--gold)]/5 text-[10px] font-bold text-[var(--gold)] hover:bg-[var(--gold)]/15 transition-colors"
          >
            <Sparkles size={10} />
            ANALYZE
          </button>
        )}
      </div>

      {/* Open state: input + presets */}
      {open && !response && !streaming && (
        <>
          <div className="flex items-center gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") ask();
              }}
              placeholder={placeholder || `Ask about this ${page}...`}
              className="flex-1 h-8 px-2.5 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-default)] text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--gold)]/40"
            />
            <button
              onClick={() => ask()}
              disabled={!question.trim() && !presets?.length}
              className="flex items-center justify-center w-8 h-8 rounded-md bg-[var(--gold)] text-black hover:bg-[var(--gold)]/90 transition-colors disabled:opacity-40"
              aria-label="Send"
            >
              <Send size={12} />
            </button>
            <button
              onClick={dismiss}
              className="flex items-center justify-center w-8 h-8 rounded-md text-[var(--text-tertiary)] hover:text-red-400 transition-colors"
              aria-label="Close"
            >
              <X size={12} />
            </button>
          </div>

          {/* Preset question pills */}
          {presets && presets.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {presets.map((p, i) => (
                <button
                  key={i}
                  onClick={() => ask(p)}
                  className="text-[9px] px-2 py-0.5 rounded-full border border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--gold)]/30 hover:text-[var(--gold)] transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Streaming / response state */}
      {(streaming || response || error) && (
        <div className="rounded-md border border-[var(--gold)]/20 bg-[var(--bg-void)]/60 p-2.5 space-y-2 animate-fade-in-scale">
          {streaming && !response && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
              <Loader2 size={11} className="animate-spin text-[var(--gold)]" />
              Nick is analyzing…
            </div>
          )}

          {response && (
            <div className="text-[11px] leading-[1.55] text-[var(--text-primary)] whitespace-pre-wrap">
              {response}
              {streaming && (
                <span
                  className="inline-block w-[5px] h-[11px] ml-0.5 bg-[var(--gold)] align-baseline"
                  style={{ animation: "pulse 1.2s ease-in-out infinite" }}
                />
              )}
            </div>
          )}

          {error && (
            <p className="text-[11px] text-red-300">
              Analysis failed: {error}
            </p>
          )}

          {/* Actions */}
          {!streaming && (response || error) && (
            <div className="flex items-center gap-1.5 pt-1 border-t border-[var(--border-default)]/40">
              {streaming ? (
                <button
                  onClick={stop}
                  className="text-[9px] px-2 h-6 rounded-md border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 font-bold uppercase tracking-wider"
                >
                  STOP
                </button>
              ) : (
                <>
                  <button
                    onClick={openInChat}
                    className="flex items-center gap-1 text-[9px] px-2 h-6 rounded-md border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/30 font-bold uppercase tracking-wider"
                  >
                    <MessageSquare size={10} />
                    OPEN IN CHAT
                  </button>
                  {response && (
                    <button
                      onClick={copy}
                      className="flex items-center gap-1 text-[9px] px-2 h-6 rounded-md border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/30 font-bold uppercase tracking-wider"
                    >
                      <Copy size={10} />
                      {copied ? "COPIED" : "COPY"}
                    </button>
                  )}
                  <button
                    onClick={() => ask(question || undefined)}
                    className="flex items-center gap-1 text-[9px] px-2 h-6 rounded-md border border-[var(--gold)]/30 bg-[var(--gold)]/5 text-[var(--gold)] hover:bg-[var(--gold)]/15 font-bold uppercase tracking-wider ml-auto"
                  >
                    <Sparkles size={10} />
                    AGAIN
                  </button>
                  <button
                    onClick={dismiss}
                    className="flex items-center justify-center w-6 h-6 text-[var(--text-tertiary)] hover:text-red-400"
                    aria-label="Dismiss"
                  >
                    <X size={10} />
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
