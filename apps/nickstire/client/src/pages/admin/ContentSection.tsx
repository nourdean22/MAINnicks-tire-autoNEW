/**
 * ContentSection — Content Manager + AI Ideas Engine + Specials.
 * Tab 1: Content Manager (articles, notifications, gen log)
 * Tab 2: AI Ideas Engine (trending topics, SEO opportunities, seasonal, competitor gaps)
 * Tab 3: Specials (2026-05-19 Elon-cut · moved from RevenueSection · it's
 *        content management, not invoice/revenue data)
 *
 * 2026-07-04 maintainability split: this file was 1,515 lines — five
 * unrelated features glued into one file (the merge-conflict magnet the
 * admin review flagged). The tab bodies now live in ./content/*, one file
 * per feature, mirroring the ./today/ + ./customers/ extraction precedent.
 * This shell keeps the registry-facing default export + tab routing only.
 * Pure mechanical move — no component was modified.
 */
import { lazy, Suspense } from "react";
import { PageHeader, TabBar, useUrlFilter } from "./shared";
import { Building2, Camera, FileText, Loader2, MapPin, MessageCircleQuestion, Swords, Tag } from "lucide-react";
import { ContentManager } from "./content/ContentManager";
import { CompetitorsTab, EntityTab, GbpQaTab, LocalGrowthTab, PhotoQueueTab } from "./GrowthSection";
import { resolveInnerTab } from "./innerTabs";

const SpecialsSection = lazy(() => import("./SpecialsSection"));

export default function ContentSection() {
  // 2026-05-23 · URL-persist the inner tab so deep-links + reloads land
  // on the operator's last view. Every other admin section already uses
  // useUrlFilter for inner tabs (Intelligence · Outreach · Money etc.);
  // ContentSection was the lone holdout still using bare useState.
  // 2026-10-19 (admin prune W1): the Growth section's tabs joined here; AI Ideas,
  // Prompt Health and Review Replies were cut. A retired value lands on Manager.
  const [tab, setTab] = useUrlFilter<string>("contentTab", "manager", {
    validate: (raw) => resolveInnerTab("content", raw, null),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Website & Local"
        subtitle="Articles, notifications, GBP posts, specials, and the local search checklists. Nothing here posts to Google for you."
        icon={<FileText className="w-5 h-5" />}
      />
      <TabBar
        tabs={[
          { id: "manager", label: "Content Manager", icon: <FileText className="w-3.5 h-3.5" /> },
          { id: "specials", label: "Specials", icon: <Tag className="w-3.5 h-3.5" /> },
          { id: "local", label: "Local Growth", icon: <MapPin className="w-3.5 h-3.5" /> },
          { id: "qa", label: "GBP Q&A", icon: <MessageCircleQuestion className="w-3.5 h-3.5" /> },
          { id: "photos", label: "Photo Queue", icon: <Camera className="w-3.5 h-3.5" /> },
          { id: "entity", label: "Entity / Brand", icon: <Building2 className="w-3.5 h-3.5" /> },
          { id: "competitors", label: "Competitors", icon: <Swords className="w-3.5 h-3.5" /> },
        ]}
        activeTab={tab}
        onChange={setTab}
      />

      {tab === "manager" && <ContentManager />}
      {tab === "specials" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <SpecialsSection />
        </Suspense>
      )}
      {tab === "local" && <LocalGrowthTab />}
      {tab === "qa" && <GbpQaTab />}
      {tab === "photos" && <PhotoQueueTab />}
      {tab === "entity" && <EntityTab />}
      {tab === "competitors" && <CompetitorsTab />}
    </div>
  );
}
