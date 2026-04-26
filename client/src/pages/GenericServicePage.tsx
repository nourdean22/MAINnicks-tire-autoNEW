/**
 * GenericServicePage — wrapper that renders any service from shared/services.ts
 * via the new FocusedServicePage template.
 *
 * Context:
 *   Until 2026-04-24 every service used the 1,173-line ServicePage.tsx —
 *   heavy, inconsistent with our new FocusedServicePage template, and
 *   hard to maintain. High-traffic services (/brakes, /diagnostics,
 *   /tire-shop-near-me, /auto-repair-near-me, /synthetic-oil-change)
 *   got bespoke page components with hand-written copy.
 *
 *   This wrapper handles the long tail: services that don't warrant
 *   bespoke copy but still need a consistent landing page
 *   (/oil-change, /emissions, /ac-repair, /transmission, /electrical,
 *   /battery, /exhaust, /cooling, /pre-purchase-inspection,
 *   /belts-hoses, /starter-alternator).
 *
 * Reads the current URL path, finds the matching ServiceData in
 * shared/services.ts, transforms it into a ServicePageConfig, and
 * renders. No hardcoded content; everything flows from services.ts.
 */

import { useRoute } from "wouter";
import FocusedServicePage, { type ServicePageConfig, type ServicePricingTier, type ServiceFaq } from "@/components/FocusedServicePage";
import { SERVICES, type ServiceData } from "@shared/services";
import PageLayout from "@/components/PageLayout";
import { SEOHead } from "@/components/SEO";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { getConversionDataForSlug } from "@/data/serviceConversionData";

// ─── SERVICE DATA → PAGE CONFIG ADAPTER ─────────────────────
function serviceDataToConfig(service: ServiceData): ServicePageConfig {
  // Pricing tiers — Nick's policy (2026-04-26): we close in person, not on
  // the website. Show the tier structure (3-tier visual hierarchy stays for
  // conversion architecture), but every tier reads "Free estimate" so the
  // visitor calls / walks in instead of self-closing on a public number.
  const tiers: ServicePricingTier[] = (service.pricingTiers && service.pricingTiers.length > 0)
    ? service.pricingTiers.map((t, i) => ({
        name: t.label,
        price: "Free estimate",
        // sub is intentionally not set to t.range — that field carried explicit
        // dollar ranges ("$60–$120") which we no longer expose. Tier `name`
        // and `use` carry enough context.
        sub: undefined,
        use: i === 0 ? "Standard service for most vehicles" : i === 1 ? "Recommended for most customers" : "Extensive service when needed",
        featured: i === 1, // middle tier featured
      }))
    : [
        {
          name: service.title,
          price: "Free estimate",
          sub: service.duration ? `Typically ${service.duration}` : undefined,
          use: service.shortDesc || "Professional service at Nick's Tire & Auto",
          featured: true,
        },
      ];

  // FAQ entries — prefer quickAnswers (AEO-optimized), fall back to problems
  const faqs: ServiceFaq[] = [
    ...(service.quickAnswers || []).map(q => ({ q: q.question, a: q.answer })),
    ...(service.problems || []).map(p => ({ q: p.question, a: p.answer })),
  ].slice(0, 8); // cap at 8 to keep the page focused

  // Included items — service-specific list, fall back to whyUs bullets
  const included = (service.includedItems && service.includedItems.length > 0)
    ? service.includedItems
    : (service.whyUs || []).slice(0, 8);

  return {
    canonicalPath: `/${service.slug}`,
    title: service.metaTitle,
    description: service.metaDescription,
    eyebrow: service.title,
    h1: service.heroHeadline.replace(/\n/g, " "),
    sub: service.heroSubline,
    // 2026-04-26 close-in-person policy: hero startingPrice no longer
    // surfaces explicit dollar amounts. Hero shows "Free estimate" badge
    // instead — the tier section + free written estimate carries the
    // commitment without exposing a self-close price.
    startingPrice: "Free estimate",
    pricingTitle: `${service.title.toUpperCase()} — FREE ESTIMATE`,
    pricingSub: "Free written estimate before any work. We show you what's needed before you commit.",
    tiers,
    includedTitle: "WHAT'S INCLUDED",
    includedSub: service.whyChooseUs || `Every ${service.title.toLowerCase()} at Nick's comes with this — no games.`,
    included,
    faqs,
    bookingService: service.slug,
    serviceType: service.title,
    ctaHeadline: `BOOK YOUR ${service.title.toUpperCase()}`,
    ctaSub: service.turnaround || "Walk-ins welcome 7 days a week — 17625 Euclid Ave, Cleveland OH.",
  };
}

export default function GenericServicePage() {
  const [, params] = useRoute("/:slug");
  const slug = params?.slug;
  const service = slug ? SERVICES.find(s => s.slug === slug) : null;

  if (!service) {
    return (
      <PageLayout showChat={false}>
        <SEOHead
          title="Service Not Found — Nick's Tire & Auto"
          description="The service you're looking for doesn't exist. Browse all services at Nick's Tire & Auto, Cleveland."
          canonicalPath="/services"
          robots="noindex, nofollow"
        />
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <h1 className="font-bold text-3xl text-foreground mb-3">SERVICE NOT FOUND</h1>
            <p className="text-foreground/60 mb-8">
              That service doesn&apos;t match anything at Nick&apos;s. Browse all services or go home.
            </p>
            <div className="flex gap-3 justify-center">
              <Link href="/services" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-md font-bold">
                All Services
              </Link>
              <Link href="/" className="inline-flex items-center gap-2 border border-border/40 text-foreground px-6 py-3 rounded-md font-bold">
                <ArrowLeft className="w-4 h-4" /> Home
              </Link>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  // Merge in per-slug conversion-architecture data (anchor table, fear
  // stats, loss-aversion stats, cross-sell). Pulled from
  // client/src/data/serviceConversionData.tsx so business data
  // (shared/services.ts) stays free of marketing copy.
  const baseConfig = serviceDataToConfig(service);
  const conversionData = getConversionDataForSlug(service.slug);
  const config: ServicePageConfig = { ...baseConfig, ...conversionData };
  return <FocusedServicePage config={config} />;
}
