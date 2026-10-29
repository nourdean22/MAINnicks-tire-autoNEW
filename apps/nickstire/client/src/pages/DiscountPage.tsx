import PageLayout from "@/components/PageLayout";
import { Link, useParams } from "wouter";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import InternalLinks from "@/components/InternalLinks";
import { CallAndDirections, OfferBox, VisitBox, FaqList, faqSchema, SeeAllDiscounts } from "@/components/DiscountBlocks";
import { BUSINESS, DISCOUNT_PROGRAMS } from "@shared/business";
import { getDiscountPageBySlug, getDiscountGroup, buildDiscountFaqs } from "@shared/discountPages";

export default function DiscountPage() {
  const { slug: paramSlug } = useParams<{ slug: string }>();
  const slug = paramSlug || (typeof window !== "undefined" ? window.location.pathname.replace(/^\/discounts\//, "").split("/")[0] : "");
  const page = slug ? getDiscountPageBySlug(slug) : undefined;
  const group = page ? getDiscountGroup(page.groupId) : undefined;

  if (!page || !group) {
    return (
      <PageLayout>
        <SEOHead title="Discount not found · Nick's Tire & Auto" description="That discount page does not exist." canonicalPath="/discounts" robots="noindex, follow" />
        <div className="container py-32 text-center">
          <h1 className="text-3xl font-bold text-foreground">That is not a page we have.</h1>
          <p className="mt-4 text-foreground/70"><Link href="/discounts" className="text-primary underline">See every discount</Link></p>
        </div>
      </PageLayout>
    );
  }

  const path = `/discounts/${page.slug}`;
  const faqs = buildDiscountFaqs(page);
  const offerSchema = group.offer && {
    "@context": "https://schema.org",
    "@type": "Offer",
    name: `${group.label} discount`,
    description: DISCOUNT_PROGRAMS.offer.display,
    url: `${BUSINESS.urls.website}${path}`,
    offeredBy: { "@id": `${BUSINESS.urls.website}/#localbusiness` },
    itemOffered: {
      "@type": "Service",
      name: "Auto repair and tire labor",
      audience: { "@type": "Audience", audienceType: group.qualifies },
    },
  };

  return (
    <PageLayout>
      <SEOHead title={page.metaTitle} description={page.metaDescription} canonicalPath={path} />
      <LocalBusinessSchema />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema(faqs)) }} />
      {offerSchema && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(offerSchema) }} />}

      <div className="container max-w-3xl pt-28 pb-16 lg:pt-36 space-y-12">
        <header>
          <Breadcrumbs items={[{ label: "Discounts", href: "/discounts" }, { label: group.label }]} />
          <h1 className="mt-6 text-4xl sm:text-5xl font-bold text-foreground leading-tight tracking-tight">{page.h1}</h1>
          <p className="mt-5 text-lg text-foreground/80 leading-relaxed">{page.intro}</p>
          <CallAndDirections source={`discount-${page.slug}-hero`} />
        </header>

        {group.offer ? (
          <OfferBox group={group} />
        ) : (
          <section aria-labelledby="price-heading" className="border-2 border-primary bg-card/40 p-5 sm:p-8">
            <h2 id="price-heading" className="text-sm font-semibold text-primary">Pricing</h2>
            <p className="mt-2 text-3xl sm:text-4xl font-bold text-foreground leading-tight">{group.qualifies}</p>
          </section>
        )}

        {page.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="text-2xl font-bold text-foreground">{s.heading}</h2>
            <p className="mt-3 text-foreground/80 leading-relaxed">{s.body}</p>
          </section>
        ))}

        <VisitBox />
        <FaqList faqs={faqs} />

        <nav aria-label="Related services">
          <h2 className="text-xl font-bold text-foreground">Related</h2>
          <ul className="mt-3 space-y-2">
            {page.related.map((r) => (
              <li key={r.href}><Link href={r.href} className="text-primary underline hover:no-underline">{r.label}</Link></li>
            ))}
          </ul>
          <div className="mt-4"><SeeAllDiscounts /></div>
        </nav>
      </div>
      <InternalLinks />
    </PageLayout>
  );
}
