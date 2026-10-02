"use client";

import { useState } from "react";
import { BrainCircuit, Upload, Loader2, Check, ChevronDown } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { notifyDataChanged } from "@/lib/events/data-change";

/**
 * UI wave (audit 2026-07-15) · collapsed by default. This write-only
 * paste zone used to sit expanded ABOVE the intelligence panels,
 * dominating the column; it now renders last and folds open on demand.
 * Also joined the cross-surface data-change bus — it was the only
 * capture path that didn't notify, so home/brain surfaces never
 * refreshed after a NotebookLM inject.
 */
export function NotebookLMContextZone() {
  const [markdown, setMarkdown] = useState("");
  const [status, setStatus] = useState<"idle" | "ingesting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const utils = trpc.useUtils();

  const captureMutation = trpc.brain.captureThought.useMutation({
    onSuccess: () => {
      setStatus("success");
      setMarkdown("");
      void utils.journal.feed.invalidate();
      notifyDataChanged("journal", { source: "notebooklm-zone", detail: "context-injected" });

      setTimeout(() => {
        setStatus("idle");
      }, 3000);
    },
    onError: (err) => {
      setStatus("error");
      setErrorMsg(err.message);
    }
  });

  const handleIngest = () => {
    if (!markdown.trim()) return;
    setStatus("ingesting");

    // Prefix to guide the AI pipeline that this is a NotebookLM brief
    const payload = `[NotebookLM Research Brief]\n\n${markdown}`;

    captureMutation.mutate({
      text: payload,
      entryTypeHint: "insight"
    });
  };

  return (
    <details className="group rounded-surface border border-edge-subtle bg-content">
      <summary className="flex items-center gap-2 p-4 min-h-[44px] cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <BrainCircuit size={14} className="text-fg-tertiary" aria-hidden />
        <h3 className="text-[15px] font-semibold text-fg">
          NotebookLM Context Zone
        </h3>
        <ChevronDown
          size={14}
          aria-hidden
          className="ml-auto text-fg-tertiary transition-transform group-open:rotate-180"
        />
      </summary>

      <div className="px-4 pb-4 space-y-4">
        <p className="text-[13px] text-fg-secondary leading-relaxed">
          Paste NotebookLM Briefing Docs, Study Guides, or Chat Summaries here.
          Statenour will parse the markdown and permanently store it into the Journal OS as an intelligence asset.
        </p>

        <div className="space-y-2">
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder="Paste markdown here..."
            aria-label="NotebookLM markdown to ingest"
            className="w-full h-32 rounded-control bg-surface-interactive border border-edge-default p-3 text-[12px] text-fg font-mono focus:border-accent/40 outline-none resize-none transition-colors"
            disabled={status === "ingesting" || status === "success"}
          />

          <div className="flex items-center justify-between">
            <div className="flex-1">
              {status === "error" && (
                <span className="text-[11px] text-rose-400">{errorMsg}</span>
              )}
              {status === "success" && (
                <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                  <Check size={12} /> Successfully injected into OS Memory.
                </span>
              )}
            </div>

            <button
              onClick={handleIngest}
              disabled={!markdown.trim() || status === "ingesting" || status === "success"}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === "ingesting" ? (
                <><Loader2 size={12} className="animate-spin" /> Ingesting</>
              ) : (
                <><Upload size={12} /> Inject Context</>
              )}
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}
