"use client";

import React, { useState } from "react";
import { Zap, AlertTriangle, Check, X, ShieldAlert, ArrowRight } from "lucide-react";

export interface Opportunity {
  id: string;
  title: string;
  description: string;
  domain: string;
  impact: number;
  urgency: number;
  confidence: number;
  reversibility: number;
  score: number;
  status: string;
}

interface OpportunityCardProps {
  opportunity: Opportunity;
  onStatusChange?: (id: string, newStatus: string) => void;
}

export function OpportunityCard({ opportunity, onStatusChange }: OpportunityCardProps) {
  const [loading, setLoading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(opportunity.status);

  const handleAction = async (action: "accepted" | "declined" | "resolved") => {
    setLoading(true);
    try {
      const res = await fetch("/api/intelligence/decisions/log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          opportunityId: opportunity.id,
          action,
        }),
      });

      const data = await res.json();
      if (data.status === "success") {
        setCurrentStatus(action);
        if (onStatusChange) {
          onStatusChange(opportunity.id, action);
        }
      }
    } catch (err) {
      console.error("Failed to submit decision:", err);
    } finally {
      setLoading(false);
    }
  };

  // Color mappings based on domain
  const domainColors: Record<string, string> = {
    ai: "bg-purple-900/40 text-purple-200 border-purple-800/80",
    seo: "bg-blue-900/40 text-blue-200 border-blue-800/80",
    competitor: "bg-amber-900/40 text-amber-200 border-amber-800/80",
    automotive: "bg-red-900/40 text-red-200 border-red-800/80",
    macro: "bg-emerald-900/40 text-emerald-200 border-emerald-800/80",
  };

  const domainColor = domainColors[opportunity.domain] || "bg-slate-800/60 text-slate-200 border-slate-700";

  return (
    <div className="relative rounded-xl border border-slate-800/60 bg-slate-900/40 p-5 backdrop-blur-md transition-all hover:border-slate-700/60">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${domainColor}`}>
            {opportunity.domain}
          </span>
          <span className="flex items-center gap-1 rounded-md bg-slate-800/40 px-2 py-0.5 text-xs font-semibold text-slate-400">
            Score: <strong className="text-white">{opportunity.score}</strong>
          </span>
        </div>

        {/* Priority Indicator */}
        <div className="flex items-center gap-1.5">
          {opportunity.score >= 80 ? (
            <span className="flex items-center gap-1 rounded-md bg-red-950/60 px-2 py-0.5 text-xs font-bold text-red-400 border border-red-900/60">
              <ShieldAlert className="h-3 w-3" /> Critical
            </span>
          ) : opportunity.score >= 60 ? (
            <span className="flex items-center gap-1 rounded-md bg-amber-950/60 px-2 py-0.5 text-xs font-bold text-amber-400 border border-amber-900/60">
              <Zap className="h-3 w-3" /> High
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-md bg-slate-800/60 px-2 py-0.5 text-xs font-bold text-slate-400">
              Medium
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="mt-4">
        <h3 className="text-base font-bold text-slate-100">{opportunity.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{opportunity.description}</p>
      </div>

      {/* Metrics breakdown */}
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-slate-800/40 pt-4 text-xs text-slate-400">
        <div className="flex items-center justify-between">
          <span>Impact</span>
          <span className="font-semibold text-slate-200">{opportunity.impact}/100</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Urgency</span>
          <span className="font-semibold text-slate-200">{opportunity.urgency}/100</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Confidence</span>
          <span className="font-semibold text-slate-200">{Math.round(opportunity.confidence * 100)}%</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Reversibility</span>
          <span className="font-semibold text-slate-200">{opportunity.reversibility}/100</span>
        </div>
      </div>

      {/* Decision Status / Actions */}
      <div className="mt-5 flex items-center justify-between gap-4 border-t border-slate-800/40 pt-4">
        <div className="text-xs text-slate-500">
          Status:{" "}
          <span className={`font-semibold capitalize ${
            currentStatus === "accepted"
              ? "text-emerald-400"
              : currentStatus === "declined"
              ? "text-red-400"
              : currentStatus === "resolved"
              ? "text-blue-400"
              : "text-amber-400"
          }`}>
            {currentStatus}
          </span>
        </div>

        {currentStatus === "pending" ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleAction("declined")}
              disabled={loading}
              className="flex h-8 items-center gap-1 rounded-lg border border-red-900/60 bg-red-950/20 px-3 text-xs font-semibold text-red-400 transition-all hover:bg-red-950/60 hover:text-white disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" /> Decline
            </button>
            <button
              onClick={() => handleAction("accepted")}
              disabled={loading}
              className="flex h-8 items-center gap-1 rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-3 text-xs font-semibold text-emerald-400 transition-all hover:bg-emerald-950/60 hover:text-white disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" /> Accept
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            {currentStatus === "accepted" ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <Check className="h-4.5 w-4.5" /> Accepted Decision
              </span>
            ) : currentStatus === "declined" ? (
              <span className="flex items-center gap-1 text-red-400">
                <X className="h-4.5 w-4.5" /> Declined / Dismissed
              </span>
            ) : (
              <span className="flex items-center gap-1 text-blue-400">
                <Check className="h-4.5 w-4.5" /> Resolved
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
