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
import { FileText, Lightbulb, Loader2, ShieldCheck, Tag } from "lucide-react";
import { ContentManager } from "./content/ContentManager";
import { AIIdeasEngine } from "./content/AIIdeasEngine";

const SpecialsSection = lazy(() => import("./SpecialsSection"));
const PromptEvalsPanel = lazy(() => import("./PromptEvalsPanel"));

type ContentTab = "manager" | "ideas" | "specials" | "evals";

const VALID_CONTENT_TABS: ContentTab[] = ["manager", "ideas", "specials", "evals"];

export default function ContentSection() {
  // 2026-05-23 · URL-persist the inner tab so deep-links + reloads land
  // on the operator's last view. Every other admin section already uses
  // useUrlFilter for inner tabs (Intelligence · Outreach · Money etc.);
  // ContentSection was the lone holdout still using bare useState.
  const [tab, setTab] = useUrlFilter<ContentTab>(
    "contentTab",
    "manager",
    {
      validate: (raw) => (VALID_CONTENT_TABS.includes(raw as ContentTab) ? (raw as ContentTab) : null),
    },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Website & Local"
        subtitle="Articles, notifications, GBP posts, AI ideas engine, specials — everything customer-facing copy + automation"
        icon={<FileText className="w-5 h-5" />}
      />
      <TabBar
        tabs={[
          { id: "manager", label: "Content Manager", icon: <FileText className="w-3.5 h-3.5" /> },
          { id: "ideas", label: "AI Ideas Engine", icon: <Lightbulb className="w-3.5 h-3.5" /> },
          { id: "specials", label: "Specials", icon: <Tag className="w-3.5 h-3.5" /> },
          { id: "evals", label: "Prompt Health", icon: <ShieldCheck className="w-3.5 h-3.5" /> },
        ]}
        activeTab={tab}
        onChange={setTab}
      />

      {tab === "manager" && <ContentManager />}
      {tab === "ideas" && <AIIdeasEngine />}
      {tab === "specials" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <SpecialsSection />
        </Suspense>
      )}
      {tab === "evals" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <PromptEvalsPanel />
        </Suspense>
      )}
    </div>
  );
}
