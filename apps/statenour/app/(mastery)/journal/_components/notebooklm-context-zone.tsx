"use client";

import { useState } from "react";
import { BrainCircuit, Upload, Loader2, Check } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

export function NotebookLMContextZone() {
  const [markdown, setMarkdown] = useState("");
  const [status, setStatus] = useState<"idle" | "ingesting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const utils = trpc.useUtils();
  
  const captureMutation = trpc.brain.captureThought.useMutation({
    onSuccess: () => {
      setStatus("success");
      setMarkdown("");
      utils.journal.feed.invalidate();
      
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
    <div className="rounded-xl border border-(--gold)/20 bg-linear-to-br from-(--gold)/5 to-transparent p-4 space-y-4">
      <div className="flex items-center gap-2">
        <BrainCircuit size={14} className="text-(--gold)" />
        <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-(--gold)">
          NotebookLM Context Zone
        </h3>
      </div>
      
      <p className="text-[11px] text-(--text-secondary) leading-relaxed">
        Paste NotebookLM Briefing Docs, Study Guides, or Chat Summaries here. 
        Statenour will parse the markdown and permanently store it into the Journal OS as an intelligence asset.
      </p>

      <div className="space-y-2">
        <textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          placeholder="Paste markdown here..."
          className="w-full h-32 rounded-lg bg-zinc-900/50 border border-zinc-800 p-3 text-[12px] text-zinc-300 font-mono focus:border-(--gold)/40 outline-none resize-none transition-colors"
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
            className="flex items-center gap-2 px-3 py-1.5 rounded bg-(--gold)/10 text-(--gold) border border-(--gold)/20 hover:bg-(--gold)/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[11px] font-bold uppercase tracking-wider"
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
  );
}
