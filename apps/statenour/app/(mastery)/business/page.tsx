"use client";

import { StandardPage } from "@/components/layout/standard-page";
import { PageTabs } from "@/components/layout/page-tabs";
import { FinancialTab } from "@/components/business/financial-tab";
import { FunnelTab } from "@/components/business/funnel-tab";
import { ClientsTab } from "@/components/business/clients-tab";

export default function BusinessPage() {
  return (
    <StandardPage
      eyebrow="NOUR OS"
      title="business"
      width="2xl"
      rhythm="loose"
      description="Revenue · conversion · clients — shop revenue + targets, the lead→retained funnel, and the coaching CRM (contacts, bookings, agreements)."
    >
      <PageTabs
        defaultKey="money"
        tabs={[
          { key: "money", label: "Money", render: () => <FinancialTab /> },
          { key: "funnel", label: "Funnel", render: () => <FunnelTab /> },
          { key: "clients", label: "Clients", render: () => <ClientsTab /> },
        ]}
      />
    </StandardPage>
  );
}
