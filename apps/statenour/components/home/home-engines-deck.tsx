"use client";

import { ObsidianEngineCard } from "@/components/obsidian/obsidian-engine-card";
import { NotebookLMCockpit } from "@/components/home/notebooklm-cockpit";

export function HomeEnginesDeck() {
  return (
    <section 
      aria-label="Engines Deck"
      className="grid grid-cols-1 md:grid-cols-2 gap-4"
    >
      <NotebookLMCockpit />
      <ObsidianEngineCard />
    </section>
  );
}
