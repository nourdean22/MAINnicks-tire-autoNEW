"use client";

import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { RefreshCw, FileText, AlertTriangle, Zap, CheckSquare, Sparkles } from "lucide-react";
import { StandardPage } from "@/components/layout/standard-page";

interface BriefLog {
  id: string;
  briefType: string;
  content: string;
  createdAt: string;
}

export default function DailyBriefPage() {
  const [brief, setBrief] = useState<BriefLog | null>(null);
  // Why not just null-vs-set: "no brief today" and "no brief EVER" need
  // different operator actions — the first means the scheduled job stopped, the
  // second means it has never once completed. The old empty state conflated them.
  const [emptyState, setEmptyState] = useState<{ lastBriefAt: string | null; message: string } | null>(null);
  // A failed REQUEST is not evidence about the historical record. Without this,
  // a 500 or dropped connection rendered "No Briefing Has Ever Been Generated".
  const [errored, setErrored] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchLatestBrief = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/intelligence/briefs/today");
      const body = await res.json();
      // apiHandler wraps every plain-object return as { ok, data, meta }
      // (lib/utils/http.ts:93, :278). Reading `body.status` directly made the
      // check ALWAYS false, so this screen rendered its empty state even when a
      // brief existed. The `?? body` keeps it working if the route ever returns raw.
      const payload = body?.data ?? body;
      setErrored(false);
      if (payload?.status === "success") {
        setBrief(payload.brief);
        setEmptyState(null);
      } else {
        setBrief(null);
        setEmptyState({
          lastBriefAt: payload?.lastBriefAt ?? null,
          message: payload?.message ?? "No briefing available.",
        });
      }
    } catch (err) {
      setErrored(true);
      setBrief(null);
      setEmptyState(null);
      toast.error("Failed to load today's briefing.");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    toast.info("Running ingestion connectors & claims analysis...");
    try {
      const res = await fetch("/api/intelligence/briefs/generate", {
        method: "POST",
      });
      const body = await res.json();
      const payload = body?.data ?? body;   // same envelope as above
      if (payload?.status === "success") {
        setBrief(payload.brief);
        setEmptyState(null);
        setErrored(false);
        toast.success("Successfully generated today's brief!");
      } else {
        toast.error(payload?.message || "Failed to generate brief.");
      }
    } catch (err) {
      toast.error("An error occurred during briefing generation.");
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => void fetchLatestBrief(), 0);
    return () => clearTimeout(t);
  }, []);

  // Simple custom parser to style the Markdown brief nicely
  const renderBriefContent = (content: string) => {
    const lines = content.split("\n");
    return lines.map((line, index) => {
      const trimmed = line.trim();
      
      if (trimmed.startsWith("# ")) {
        return (
          <h1 key={index} className="text-xl md:text-2xl font-semibold text-fg tracking-tight mt-6 mb-4 pb-2 border-b border-edge-subtle">
            {trimmed.slice(2)}
          </h1>
        );
      }
      
      if (trimmed.startsWith("## ")) {
        const title = trimmed.slice(3);
        let icon = <Sparkles className="h-4.5 w-4.5 text-fg-tertiary" />;
        
        if (title.includes("Alerts")) {
          icon = <AlertTriangle className="h-4.5 w-4.5 text-red-400" />;
        } else if (title.includes("Opportunities")) {
          icon = <Zap className="h-4.5 w-4.5 text-amber-400" />;
        } else if (title.includes("Decisions")) {
          icon = <CheckSquare className="h-4.5 w-4.5 text-fg-tertiary" />;
        }

        return (
          <h2 key={index} className="flex items-center gap-2 text-[15px] font-semibold text-fg mt-8 mb-4 border-l-2 border-edge-strong pl-3">
            {icon} {title}
          </h2>
        );
      }

      if (trimmed.startsWith("* **")) {
        return (
          <div key={index} className="mt-3 pl-4 border-l border-edge-subtle py-1 text-sm text-fg-secondary leading-relaxed">
            {trimmed}
          </div>
        );
      }

      if (trimmed.startsWith("- ")) {
        return (
          <li key={index} className="ml-6 list-disc text-sm text-fg-secondary leading-relaxed mt-1">
            {trimmed.slice(2)}
          </li>
        );
      }

      if (trimmed === "") {
        return <div key={index} className="h-2" />;
      }

      return (
        <p key={index} className="text-sm text-fg-secondary leading-relaxed mt-1">
          {trimmed}
        </p>
      );
    });
  };

  return (
    <StandardPage
      eyebrow="Intelligence"
      title="Daily Brief"
      description="Daily executive intelligence briefings for Nour."
      width="md"
      rhythm="comfortable"
      className="mx-auto px-4 pb-20"
      parent={{ href: "/system", label: "system" }}
      actions={
        <button
          onClick={fetchLatestBrief}
          disabled={loading || generating}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-control border border-edge-default bg-content px-3 py-2 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      }
    >

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 border border-edge-subtle rounded-surface bg-content">
          <RefreshCw className="h-6 w-6 text-fg-tertiary animate-spin" />
          <span className="text-xs font-mono text-fg-tertiary">Loading daily executive brief...</span>
        </div>
      ) : brief ? (
        <div className="space-y-6">
          <div className="rounded-surface border border-edge-subtle bg-content p-6">
            <div className="flex justify-between items-center font-mono text-[11px] text-fg-tertiary border-b border-edge-subtle pb-3 mb-4">
              <span>Type: daily brief</span>
              <span>Compiled: {new Date(brief.createdAt).toLocaleString()}</span>
            </div>

            <div className="prose prose-invert max-w-none text-fg-secondary">
              {renderBriefContent(brief.content)}
            </div>
          </div>

          <div className="flex justify-center gap-3">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-control bg-accent px-4 py-2 text-[14px] font-semibold text-[var(--text-inverse)] transition-colors duration-[var(--motion-state)] hover:bg-accent-hover disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${generating ? "animate-spin" : ""}`} />
              Re-generate brief
            </button>
            <a
              href="/intelligence/ledger"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-control border border-edge-default bg-content px-3 py-2 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
            >
              Open decision ledger
            </a>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-6 border border-edge-subtle rounded-surface bg-content">
          <div className="rounded-full bg-surface-interactive p-4 border border-edge-subtle">
            <FileText className="h-10 w-10 text-fg-tertiary" />
          </div>
          <div className="space-y-2 max-w-sm">
            <h3 className="text-sm font-semibold text-fg">
              {errored
                ? "Could Not Load Today's Briefing"
                : emptyState?.lastBriefAt
                  ? "No Briefing Generated Today"
                  : "No Briefing Has Ever Been Generated"}
            </h3>
            <p className="text-xs text-fg-tertiary">
              {errored
                ? "The request failed — this says nothing about whether a brief exists. Retry, or check /system/crons."
                : (emptyState?.message ??
                  "Run ingestion and synthesis on your registered sources to compile today's executive brief.")}
            </p>
            {emptyState?.lastBriefAt ? (
              <p className="text-xs font-mono text-amber-300">
                Last brief: {new Date(emptyState.lastBriefAt).toLocaleString()}
              </p>
            ) : null}
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-control bg-accent px-4 py-2 text-[14px] font-semibold text-[var(--text-inverse)] transition-colors duration-[var(--motion-state)] hover:bg-accent-hover disabled:opacity-50"
          >
            {generating ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Compiling...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Compile today&apos;s brief
              </>
            )}
          </button>
        </div>
      )}
    </StandardPage>
  );
}
