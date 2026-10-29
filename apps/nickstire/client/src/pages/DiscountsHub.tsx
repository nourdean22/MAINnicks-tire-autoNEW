import PageLayout from "@/components/PageLayout";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import InternalLinks from "@/components/InternalLinks";
import { CallAndDirections, OfferBox, VisitBox, FaqList, faqSchema } from "@/components/DiscountBlocks";
import { DISCOUNT_PAGES, DISCOUNTS_HUB, getDiscountGroup } from "@shared/discountPages";
import { getRouteByPath } from "@shared/routes";

export default function DiscountsHub() {
  const cards = DISCOUNT_PAGES.map((p) => ({ page: p, group: getDiscountGroup(p.groupId)! }));
  const seo = getRouteByPath("/discounts")!;

  return (
    <PageLayout>
      <SEOHead title={seo.title} description={seo.description} canonicalPath="/discounts" />
      <LocalBusinessSchema />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema(DISCOUNTS_HUB.faqs)) }} />

      <div className="container max-w-3xl pt-28 pb-16 lg:pt-36 space-y-12">
        <header>
          <Breadcrumbs items={[{ label: "Discounts" }]} />
          <h1 className="mt-6 text-4xl sm:text-5xl font-bold text-foreground leading-tight tracking-tight">{DISCOUNTS_HUB.h1}</h1>
          <p className="mt-5 text-lg text-foreground/80 leading-relaxed">{DISCOUNTS_HUB.intro}</p>
          <CallAndDirections source="discounts-hub-hero" />
        </header>

        <OfferBox />

        <section aria-labelledby="groups-heading">
          <h2 id="groups-heading" className="text-2xl font-bold text-foreground">Who gets a discount</h2>
          <ul className="mt-4 divide-y divide-border/40 border-y border-border/40">
            {cards.map(({ page, group }) => (
              <li key={page.slug}>
                <Link href={`/discounts/${page.slug}`} className="flex min-h-12 items-center justify-between gap-4 py-4 group">
                  <span>
                    <span className="block font-semibold text-foreground group-hover:text-primary transition-colors">{group.label}</span>
                    <span className="block text-sm text-foreground/70">{group.qualifies}</span>
                  </span>
                  <ChevronRight className="w-5 h-5 shrink-0 text-primary" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <VisitBox />
        <FaqList faqs={DISCOUNTS_HUB.faqs} />
      </div>
      <InternalLinks />
    </PageLayout>
  );
}
