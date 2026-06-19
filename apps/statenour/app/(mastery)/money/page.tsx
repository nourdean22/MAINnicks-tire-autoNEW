"use client";

/**
 * /money — personal wealth hub. 2026-06-19 · IA reorg Phase 5. Consolidates
 * the former standalone /finance (bank ledger) + /wealth (investment
 * portfolio) into one tabbed surface, mirroring the proven /business PageTabs
 * pattern. Personal money only — Nick's-Tire business revenue stays under
 * /business. /finance + /wealth now 307-redirect here (?tab=finance|wealth).
 */

import { StandardPage } from "@/components/layout/standard-page";
import { PageTabs } from "@/components/layout/page-tabs";
import { FinanceTab } from "@/components/money/finance-tab";
import { WealthTab } from "@/components/money/wealth-tab";

export default function MoneyPage() {
  return (
    <StandardPage
      eyebrow="NOUR OS"
      title="money"
      width="2xl"
      rhythm="comfortable"
      description="Personal wealth — bank ledger (Finance) + investment portfolio (Wealth). Business revenue lives under Business."
    >
      <PageTabs
        defaultKey="finance"
        tabs={[
          { key: "finance", label: "Finance", render: () => <FinanceTab /> },
          { key: "wealth", label: "Wealth", render: () => <WealthTab /> },
        ]}
      />
    </StandardPage>
  );
}
