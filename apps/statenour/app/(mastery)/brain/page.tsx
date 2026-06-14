"use client";

/**
 * /brain — the unified self-model surface (Wave 2 consolidation).
 *
 * Four former pages merged into one tabbed surface (redirects, not
 * deletes — see next.config.ts):
 *   • Memory ← the former /brain hub dashboard (every self-model
 *     subsystem: maturity, skills, identity, beliefs, contradictions,
 *     predictions, nudges, telemetry). Default tab.
 *   • Board  ← the former /brain/board (multi-advisor consultation).
 *   • Wisdom ← the former /brain/wisdom (the wisdom-layer dashboard).
 *   • Reason ← the former /reason (the live tier-classified reasoning
 *     engine · "Charizard" surface).
 *
 * Each former page's own query params survive alongside ?tab= because
 * PageTabs reads only its own param and merges (never replaces) the
 * query string on tab-switch:
 *   • Memory · ?resolve=<key>            (contradiction deep-link)
 *   • Wisdom · ?evolution=1 · ?focus=<k> (review surface · card focus)
 *   • Reason · ?q=<text> · ?h=1          (question · sessionStorage handoff)
 *
 * Lives under (mastery) layout so it inherits NourStateProvider +
 * AmbientAura + PageTracker + KeyboardShortcuts like the rest of the
 * mastery surfaces.
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

export default function BrainPage() {
  return (
    <>
      <StandardPage
        eyebrow="Mastery"
        title="Brain"
        description="Everything the system knows about you · the self-model, advisors, wisdom, and live reasoning."
        width="2xl"
        rhythm="loose"
      >
        <PageTabs
          defaultKey="memory"
          tabs={[
            { key: "memory", label: "Memory", render: () => <MemoryTab /> },
            { key: "board", label: "Board", render: () => <BoardTab /> },
            { key: "wisdom", label: "Wisdom", render: () => <WisdomTab /> },
            { key: "reason", label: "Reason", render: () => <ReasonTab /> },
            { key: "health", label: "Health", render: () => <BrainHealthView /> },
            { key: "continuity", label: "Continuity", render: () => <BrainContinuityView /> },
          ]}
        />
      </StandardPage>

      {/* Phase 5 FULL propagation (2026-05-26) · NickSidePane on /brain.
       *  Mounted at the page-level (outside the tabs) so the FAB renders
       *  on every tab. Presets bias toward what's known / what's forming /
       *  what to consolidate. */}
      <NickSidePane
        page="brain"
        coachSurface="brain"
        presets={[
          "What's the strongest signal in this brain snapshot?",
          "Which memory cluster is growing fastest?",
          "What should I consolidate or prune today?",
          "Which identity drift is the most actionable?",
        ]}
      />
    </>
  );
}
