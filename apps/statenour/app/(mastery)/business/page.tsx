"use client";

import { StandardPage } from "@/components/layout/standard-page";
import { PageTabs } from "@/components/layout/page-tabs";
import { FinancialTab } from "@/components/business/financial-tab";
import { FunnelTab } from "@/components/business/funnel-tab";

export default function BusinessPage() {
  return (
    <StandardPage
      eyebrow="NOUR OS"
      title="business"
      width="md"
      rhythm="loose"
      description="Money + conversion — Nick's shop revenue, targets, and the lead→retained funnel."
    >
      <PageTabs
        defaultKey="money"
        tabs={[
          { key: "money", label: "Money", render: () => <FinancialTab /> },
          { key: "funnel", label: "Funnel", render: () => <FunnelTab /> },
        ]}
      />
    </StandardPage>
  );
}
