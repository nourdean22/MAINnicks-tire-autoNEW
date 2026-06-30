"use client";

/**
 * /content — the unified content + outreach surface (Wave 2 consolidation).
 *
 * Four former pages merged into one tabbed surface (redirects, not deletes —
 * see next.config.ts):
 *   • Drafts   ← the former /content/drafts (Nick-generated approval queue).
 *               Default tab.
 *   • History  ← the former /content/history (7-axis critic scoreboard).
 *   • Publish  ← the former /social (direct IG/FB publish + Buffer schedule).
 *   • Outreach ← the former /outreach (bulk-SMS propose → Telegram approval).
 *
 * The Drafts "Schedule →" deep-links to /content?tab=publish&caption=…, and
 * the Publish tab's ?caption / ?imageUrl / ?platforms pre-fill bridge rides
 * alongside ?tab= (PageTabs reads only its own param and merges the query
 * string on tab-switch, so the deep-link state survives).
 *
 * Lives under (mastery) layout so it inherits NourStateProvider +
 * AmbientAura + PageTracker + KeyboardShortcuts like the rest of the
 * mastery surfaces.
 */

import { StandardPage } from "@/components/layout/standard-page";
import { PageTabs } from "@/components/layout/page-tabs";
import { DraftsTab } from "@/components/content/drafts-tab";
import { AssistantTab } from "@/components/content/assistant-tab";
import { HistoryTab } from "@/components/content/history-tab";
import { PublishTab } from "@/components/content/publish-tab";
import { OutreachTab } from "@/components/content/outreach-tab";

export default function ContentPage() {
  return (
    <StandardPage
      eyebrow="NOUR OS"
      title="Content"
      description="Draft → review → publish → outreach — the full content pipeline in one place."
      width="3xl"
      rhythm="comfortable"
    >
      <PageTabs
        defaultKey="drafts"
        tabs={[
          { key: "drafts", label: "Drafts", render: () => <DraftsTab /> },
          { key: "assistant", label: "AI Assistant", render: () => <AssistantTab /> },
          { key: "history", label: "History", render: () => <HistoryTab /> },
          { key: "publish", label: "Publish", render: () => <PublishTab /> },
          { key: "outreach", label: "Outreach", render: () => <OutreachTab /> },
        ]}
      />
    </StandardPage>
  );
}
