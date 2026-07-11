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
import { BoardTab } from "@/components/brain/board-tab";
import { WisdomTab } from "@/components/brain/wisdom-tab";
import { ReasonTab } from "@/components/brain/reason-tab";
import { BrainHealthView } from "@/components/brain/health-view";
import { BrainContinuityView } from "@/components/brain/continuity-view";
import { KnowledgeActionOutcomes } from "@/components/brain/knowledge-action-outcomes";
import { KnowledgeReviewTab } from "@/components/brain/knowledge-review-tab";
import { HomeBrainGraph } from "@/components/home/home-brain-graph";

function GovernedKnowledgeReview() {
  return (
    <div className="space-y-8">
      <KnowledgeActionOutcomes />
      <KnowledgeReviewTab />
    </div>
  );
}

export default function BrainPage() {
  return (
    <>
      <StandardPage
        eyebrow="Mastery"
        title="Brain"
        description="Everything the system knows about you · the self-model, advisors, wisdom, governed knowledge, and live reasoning."
        width="3xl"
        rhythm="loose"
      >
        <PageTabs
          defaultKey="graph"
          tabs={[
            { key: "graph", label: "Graph", render: () => <HomeBrainGraph variant="full" /> },
            { key: "memory", label: "Memory", render: () => <MemoryTab /> },
            { key: "review", label: "Review", render: () => <GovernedKnowledgeReview /> },
            { key: "board", label: "Board", render: () => <BoardTab /> },
            { key: "wisdom", label: "Wisdom", render: () => <WisdomTab /> },
            { key: "reason", label: "Reason", render: () => <ReasonTab /> },
            { key: "health", label: "Health", render: () => <BrainHealthView /> },
            { key: "continuity", label: "Continuity", render: () => <BrainContinuityView /> },
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
