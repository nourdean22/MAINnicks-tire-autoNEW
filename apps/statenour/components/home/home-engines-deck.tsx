"use client";

import { ObsidianEngineCard } from "@/components/obsidian/obsidian-engine-card";
import { NotebookLMCockpit } from "@/components/home/notebooklm-cockpit";
import { GraphifySnapshotCard } from "@/components/home/graphify-snapshot-card";

export function HomeEnginesDeck() {
  return (
    <section aria-label="Knowledge Bridges" className="space-y-3">
      <div className="px-1">
        <p className="text-[10px] font-mono uppercase tracking-widest text-fg-secondary">Knowledge bridges</p>
        <p className="text-xs text-fg-secondary mt-1">
          BrainMemory remains the canonical online memory. These surfaces capture, research, or map information around it.
        </p>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <ObsidianEngineCard />
        <NotebookLMCockpit />
        <GraphifySnapshotCard />
      </div>
    </section>
  );
}
