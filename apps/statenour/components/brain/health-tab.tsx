"use client";

/**
 * The Brain Health tab: is the substrate healthy, and what changed (the former Changed tab; Time Travel
 * lives at #time-travel). Wave D (2026-10-24) moved four readings here from the Memory tab, whose one
 * job is correcting beliefs: learning velocity, persona drift, tool telemetry, suggestion telemetry.
 * Each keeps its own loading, empty and failed state.
 */

import { BrainHealthView } from "@/components/brain/health-view";
import { BrainContinuityView } from "@/components/brain/continuity-view";
import { LearningVelocityScoreboard } from "@/components/brain/learning-velocity-scoreboard";
import { PersonaDriftCard } from "@/components/ultron/persona-drift-card";
import { ToolTelemetryPanel } from "@/components/brain/tool-telemetry-panel";
import { SuggestionTelemetryPanel } from "@/components/brain/suggestion-telemetry-panel";

export function BrainHealthTab() {
  return (
    <div className="space-y-8">
      <BrainHealthView />
      <BrainContinuityView />
      <LearningVelocityScoreboard />
      <div id="persona-drift" className="scroll-mt-24">
        <PersonaDriftCard />
      </div>
      <ToolTelemetryPanel />
      <SuggestionTelemetryPanel />
    </div>
  );
}
