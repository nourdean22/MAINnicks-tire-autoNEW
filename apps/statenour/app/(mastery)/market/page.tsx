"use client";

/**
 * /market · Wave 2 surface merge · former /seo + /radar.
 *
 * Two former pages, both nickstire-bridge projections, collapsed into one
 * tabbed surface via the canonical PageTabs primitive:
 *   · Search · GSC search performance (clicks/impressions/queries/pages)
 *   · Radar  · brand + competitive signal (master_report projection)
 *
 * Each former page body moved verbatim into components/market/*-tab.tsx
 * (StandardPage wrapper → fragment, description relocated inline). Old
 * routes 301 → /market?tab=search · /market?tab=radar (next.config.ts).
 */

import { StandardPage } from "@/components/layout/standard-page";
import { PageTabs } from "@/components/layout/page-tabs";
import { SearchTab } from "@/components/market/search-tab";
import { RadarTab } from "@/components/market/radar-tab";

export default function MarketPage() {
  return (
    <StandardPage
      eyebrow="NOUR OS"
      title="market intel"
      description="Search performance + competitive/brand radar."
    >
      <PageTabs
        defaultKey="search"
        tabs={[
          { key: "search", label: "Search", render: () => <SearchTab /> },
          { key: "radar", label: "Radar", render: () => <RadarTab /> },
        ]}
      />
    </StandardPage>
  );
}
