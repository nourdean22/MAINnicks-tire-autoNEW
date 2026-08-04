"use client";

import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { RefreshCw, FileText, AlertTriangle, Zap, CheckSquare, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/ui";

interface BriefLog {
  id: string;
  briefType: string;
  content: string;
  createdAt: string;
}

export default function DailyBriefPage() {
  const [brief, setBrief] = useState<BriefLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchLatestBrief = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/intelligence/briefs/today");
      const data = await res.json();
      if (data.status === "success") {
        setBrief(data.brief);
      } else {
        setBrief(null);
      }
    } catch (err) {
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
      const data = await res.json();
      if (data.status === "success") {
        setBrief(data.brief);
        toast.success("Successfully generated today's brief!");
      } else {
        toast.error(data.message || "Failed to generate brief.");
      }
    } catch (err) {
      toast.error("An error occurred during briefing generation.");
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    fetchLatestBrief();
  }, []);

  // Simple custom parser to style the Markdown brief nicely
  const renderBriefContent = (content: string) => {
    const lines = content.split("\n");
    return lines.map((line, index) => {
      const trimmed = line.trim();
      
      if (trimmed.startsWith("# ")) {
        return (
          <h1 key={index} className="text-xl md:text-2xl font-black text-white tracking-tight mt-6 mb-4 pb-2 border-b border-slate-800">
            {trimmed.slice(2)}
          </h1>
        );
      }
      
      if (trimmed.startsWith("## ")) {
        const title = trimmed.slice(3);
        let icon = <Sparkles className="h-4.5 w-4.5 text-indigo-400" />;
        
        if (title.includes("Alerts")) {
          icon = <AlertTriangle className="h-4.5 w-4.5 text-red-400" />;
        } else if (title.includes("Opportunities")) {
          icon = <Zap className="h-4.5 w-4.5 text-amber-400" />;
        } else if (title.includes("Decisions")) {
          icon = <CheckSquare className="h-4.5 w-4.5 text-blue-400" />;
        }

        return (
          <h2 key={index} className="flex items-center gap-2 text-sm font-bold text-slate-200 tracking-wider uppercase mt-8 mb-4 border-l-2 border-slate-700 pl-3">
            {icon} {title}
          </h2>
        );
      }

      if (trimmed.startsWith("* **")) {
        return (
          <div key={index} className="mt-3 pl-4 border-l border-slate-800 py-1 text-sm text-slate-300 leading-relaxed">
            {trimmed}
          </div>
        );
      }

      if (trimmed.startsWith("- ")) {
        return (
          <li key={index} className="ml-6 list-disc text-sm text-slate-300 leading-relaxed mt-1">
            {trimmed.slice(2)}
          </li>
        );
      }

      if (trimmed === "") {
        return <div key={index} className="h-2" />;
      }

      return (
        <p key={index} className="text-sm text-slate-300 leading-relaxed mt-1">
          {trimmed}
        </p>
      );
    });
  };

  return (
    <div className="max-w-3xl mx-auto px-4 pb-20">
      <div className="flex justify-between items-center mb-6">
        <PageHeader eyebrow="INTELLIGENCE" title="Daily Brief" description="Daily Executive Intelligence Briefings for Nour" />
        <button
          onClick={fetchLatestBrief}
          disabled={loading || generating}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-950 text-xs font-mono text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          REFRESH
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 border border-slate-800/40 rounded-2xl bg-slate-900/10 backdrop-blur-md">
          <RefreshCw className="h-6 w-6 text-slate-500 animate-spin" />
          <span className="text-xs font-mono text-slate-500">Loading daily executive brief...</span>
        </div>
      ) : brief ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800/50 bg-slate-950/40 p-6 backdrop-blur-md">
            <div className="flex justify-between items-center text-xs font-mono text-slate-500 border-b border-slate-900 pb-3 mb-4">
              <span>TYPE: DAILY BRIEF</span>
              <span>COMPILED: {new Date(brief.createdAt).toLocaleString()}</span>
            </div>

            <div className="prose prose-invert max-w-none text-slate-300">
              {renderBriefContent(brief.content)}
            </div>
          </div>

          <div className="flex justify-center gap-3">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-200 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${generating ? "animate-spin" : ""}`} />
              RE-GENERATE BRIEF
            </button>
            <a
              href="/intelligence/ledger"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-700 hover:bg-indigo-600 text-xs font-semibold text-white transition-all"
            >
              OPEN DECISION LEDGER
            </a>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-6 border border-slate-800/40 rounded-2xl bg-slate-900/10 backdrop-blur-md">
          <div className="rounded-full bg-slate-900/80 p-4 border border-slate-800">
            <FileText className="h-10 w-10 text-slate-500" />
          </div>
          <div className="space-y-2 max-w-sm">
            <h3 className="text-sm font-semibold text-slate-200">No Briefing Generated Today</h3>
            <p className="text-xs text-slate-500">
              Run ingestion and synthesis on your registered sources to compile today's executive brief.
            </p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-600 text-xs font-semibold text-white transition-all disabled:opacity-50"
          >
            {generating ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Compiling...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Compile Today's Brief
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
