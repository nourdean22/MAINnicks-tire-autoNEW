"use client";

/**
 * /brain — the unified self-model surface (Wave 2 consolidation).
 *
 * Knowledge Review is the operator gate for external and inferred claims from
 * Obsidian, NotebookLM, Graphify and future research adapters. Pending items
 * remain outside recall until approved; approved actions stay visible until
 * their real-world outcome is recorded.
 */

import { StandardPage } from "@/components/layout/standard-page";
import { PageTabs } from "@/components/layout/page-tabs";
import { NickSidePane } from "@/components/mastery/nick-side-pane";
import { MemoryTab } from "@/components/brain/memory-tab";
import { BrainHealthView } from "@/components/brain/health-view";
import { BrainContinuityView } from "@/components/brain/continuity-view";
import { KnowledgeActionOutcomes } from "@/components/brain/knowledge-action-outcomes";
import { KnowledgeReviewTab } from "@/components/brain/knowledge-review-tab";
import { DiscoverTab } from "@/components/brain/discover-tab";
import { ResearchPipelineStatus } from "@/components/brain/research-pipeline-status";
import { BRAIN_DEFAULT_TAB } from "@/lib/brain/default-tabs";

function GovernedKnowledgeReview() {
  return (
    <div className="space-y-8">
      {/* 2026-08-19 · an empty queue and a STRUCTURALLY DEAD queue used to
          render identically here. Measured in prod: 893 claims ingested,
          best verification score 0.58 against a 0.75 promotion gate, zero
          candidates ever produced. This panel says so. */}
      <ResearchPipelineStatus />
      <KnowledgeActionOutcomes />
      <KnowledgeReviewTab />
      {/* 2026-10-19 · the Discover tab folded in: what the engines noticed is the other half of
          "what needs the operator's judgment" (its feedback buttons train the engine). */}
      <DiscoverTab />
    </div>
  );
}

/** Health plus the former Changed tab (Time Travel lives at #time-travel). */
function HealthAndChanges() {
  return (
    <div className="space-y-8">
      <BrainHealthView />
      <BrainContinuityView />
    </div>
  );
}

export default function BrainPage() {
  return (
    <>
      {/* StandardPage documents `description` as ONE LINE (standard-page.tsx:81).
          Kept short deliberately. */}
      <StandardPage
        eyebrow="Mastery"
        title="Brain"
        description="What is saved, where it came from, and what is inferred."
        width="3xl"
        rhythm="compact"
      >
        {/* 2026-10-19 · wave 2V (Nour's cut): nine tabs became three.
              MEMORY — what we believe: the former Memory tab plus Wisdom
              REVIEW — what needs the operator's judgment: governed claims plus Discover
              HEALTH — is the substrate healthy, and what changed (the former Changed tab)
            Dropped: Map (a canvas gallery), Board and Reason (operator-started cognition Chat already does).
            Every old ?tab= key redirects in next.config.ts and is pinned in
            tests/repo/retired-routes-gate.test.ts. Deep links that stay live: ?tab=memory&resolve=,
            ?tab=memory&focus= (Wisdom cards), ?tab=health#time-travel. nav-items mirrors this list
            (tests/repo/brain-nav-tabs.test.ts). */}
        <PageTabs
          defaultKey={BRAIN_DEFAULT_TAB}
          tabs={[
            { key: "memory", label: "Memory", render: () => <MemoryTab /> },
            { key: "review", label: "Review", render: () => <GovernedKnowledgeReview /> },
            { key: "health", label: "Health", render: () => <HealthAndChanges /> },
          ]}
        />
      </StandardPage>

      <NickSidePane
        page="brain"
        coachSurface="brain"
        presets={[
          "What's the strongest signal in this brain snapshot?",
          "Which knowledge candidates need my judgment?",
          "What should I consolidate or prune today?",
          "Which identity drift is the most actionable?",
        ]}
      />
    </>
  );
}
