"use client";

import React from "react";
import { CheckCircle2, AlertCircle, Play, Eye, Brain } from "lucide-react";

export interface TimelineEvent {
  id: string;
  type: "intent" | "memory" | "thought" | "tool_plan" | "tool_exec";
  status: "pending" | "running" | "success" | "error" | "gated";
  label: string;
  detail?: string;
  timestamp: number;
}

export interface ToolExecutionTimelineProps {
  events: TimelineEvent[];
}

export const ToolExecutionTimeline: React.FC<ToolExecutionTimelineProps> = ({ events }) => {
  return (
    <div className="flex flex-col space-y-4 py-2 pl-4 border-l border-zinc-800">
      {events.map((evt) => (
        <div key={evt.id} className="relative flex items-start space-x-3">
          <div className="absolute left-[-21px] mt-1 bg-zinc-950 rounded-full p-0.5 border border-zinc-800">
            {evt.status === "success" && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
            {evt.status === "error" && <AlertCircle className="w-3 h-3 text-rose-500" />}
            {evt.status === "running" && <Play className="w-3 h-3 text-gold animate-pulse" />}
            {evt.status === "gated" && <Eye className="w-3 h-3 text-amber-500" />}
            {evt.status === "pending" && <Brain className="w-3 h-3 text-zinc-500" />}
          </div>
          <div className="flex-1 bg-zinc-900/40 rounded-lg p-3 border border-zinc-800/80 backdrop-blur-sm">
            <div className="flex justify-between items-center">
              <span className="text-[11px] font-semibold text-zinc-300 font-display uppercase tracking-wider">
                {evt.label}
              </span>
              <span className="text-[9px] text-zinc-500 font-mono">
                {new Date(evt.timestamp).toLocaleTimeString()}
              </span>
            </div>
            {evt.detail && (
              <pre className="mt-2 text-[10px] text-zinc-400 font-mono bg-zinc-950 p-2 rounded border border-zinc-900 overflow-x-auto whitespace-pre-wrap">
                {evt.detail}
              </pre>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
