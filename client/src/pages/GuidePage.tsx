/*
 * GUIDE PAGE — Individual guide page for Nick's Tire & Auto
 * SEO-optimized with JSON-LD Article schema markup
 */

import PageLayout from "@/components/PageLayout";
import { useRef, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { getGuideBySlug, GUIDES, GUIDE_CATEGORY_LABELS, type GuideCategory } from "@shared/guides";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { Phone, ChevronRight, ArrowLeft, ArrowRight, BookOpen } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default function GuidePage() {
  const [, params] = useRoute("/guides/:slug");
  const slug = params?.slug || "";
  const guide = getGuideBySlug(slug);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  // 404 for unknown guides
  if (!guide) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-semibold font-bold text-4xl text-foreground mb-4">GUIDE NOT FOUND</h1>
          <p className="text-foreground/60 mb-8">The guide you are looking for does not exist.</p>
          <Link href="/guides" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 font-semibold font-bold text-sm tracking-wide">
            <ArrowLeft className="w-4 h-4" />
            BACK TO GUIDES
          </Link>
        </div>
      </div>
    );
  }

  const categoryLabel = GUIDE_CATEGORY_LABELS[guide.category];

  // Related guides (same category, different slug)
  const related = GUIDES.filter(g => g.slug !== guide.slug && g.category === guide.category).slice(0, 3);
  const moreRelated = related.length < 2
    ? [...related, ...GUIDES.filter(g => g.slug !== guide.slug && g.category !== guide.category).slice(0, 3 - related.length)]
    : related;

  // JSON-LD Article schema
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.title,
    description: guide.description,
    datePublished: "2026-03-01",
    dateModified: "2026-03-01",
    author: {
      "@type": "Organization",
      name: "Nick's Tire & Auto",
      url: "https://nickstire.org",
    },
    publisher: {
      "@type": "Organization",
      name: "Nick's Tire & Auto",
      url: "https://nickstire.org",
      logo: {
        "@type": "ImageObject",
        url: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp",
      },
      address: {
        "@type": "PostalAddress",
        streetAddress: BUSINESS.address.street,
        addressLocality: "Cleveland",
        addressRegion: "OH",
        postalCode: "44112",
      },
      sameAs: [...BUSINESS.sameAs],
    },
  };

  return (
    <PageLayout activeHref="/guides" showChat={true}>
      <SEOHead
        title={guide.title}
        description={guide.description}
        canonicalPath={`/guides/${guide.slug}`}
      />
      <Breadcrumbs items={[{ label: "Guides", href: "/guides" }, { label: categoryLabel }]} />

      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero */}
      <section className="relative bg-[oklch(0.065_0.004_260)] py-16 lg:py-24">
        <div className="container">
          <FadeIn>
            <div className="flex items-center gap-3 mb-4">
              <Link href="/" className="text-[12px] text-foreground/50 hover:text-primary transition-colors">Home</Link>
              <ChevronRight className="w-3 h-3 text-foreground/30" />
              <Link href="/guides" className="text-[12px] text-foreground/50 hover:text-primary transition-colors">Guides</Link>
              <ChevronRight className="w-3 h-3 text-foreground/30" />
              <span className="text-[12px] text-primary">{categoryLabel}</span>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <span className="inline-block px-3 py-1 bg-primary/10 border border-primary/30 text-primary text-[12px] font-semibold tracking-wide mb-4">
              {categoryLabel.toUpperCase()}
            </span>
            <h1 className="font-semibold font-bold text-3xl sm:text-4xl lg:text-5xl text-foreground leading-[0.95] tracking-tight max-w-4xl">
              {guide.title.toUpperCase()}
            </h1>
          </FadeIn>

          <FadeIn delay={0.2}>
            <p className="mt-6 text-lg text-foreground/70 max-w-2xl leading-relaxed">
              {guide.description}
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Guide Content */}
      <section className="bg-[oklch(0.065_0.004_260)] py-16 lg:py-20">
        <div className="container">
          <div className="max-w-3xl mx-auto">
            {guide.sections.map((section, i) => (
              <FadeIn key={i} delay={i * 0.05}>
                <div className="mb-12">
                  <h2 className="font-semibold font-bold text-2xl lg:text-3xl text-foreground tracking-[-0.01em] mb-4">
                    {section.heading}
                  </h2>
                  <p className="text-foreground/70 text-lg leading-relaxed">
                    {section.content}
                  </p>
                </div>
              </FadeIn>
            ))}

            {/* CTA */}
            <FadeIn>
              <div className="mt-12 bg-primary/10 border border-primary/30 p-8 text-center">
                <h3 className="font-semibold font-bold text-2xl text-foreground tracking-[-0.01em] mb-3">
                  NEED HELP WITH YOUR VEHICLE?
                </h3>
                <p className="text-foreground/60 mb-6">
                  Our technicians are ready to help. Call or book online for an appointment.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <a href={BUSINESS.phone.href} className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-semibold font-bold text-sm tracking-wide hover:bg-primary/90 transition-colors">
                    <Phone className="w-4 h-4" />
                    CALL {BUSINESS.phone.display}
                  </a>
                  <Link href="/booking" className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-semibold font-bold text-sm tracking-wide hover:border-primary hover:text-primary transition-colors">
                    BOOK ONLINE
                  </Link>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Related Guides */}
      {moreRelated.length > 0 && (
        <section className="bg-[oklch(0.055_0.004_260)] py-16 border-t border-border/30">
          <div className="container">
            <FadeIn>
              <span className="font-mono text-primary text-sm tracking-wide">Keep Reading</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight mb-10">
                RELATED GUIDES
              </h2>
            </FadeIn>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {moreRelated.map((rel, i) => (
                <FadeIn key={rel.slug} delay={i * 0.1}>
                  <Link href={`/guides/${rel.slug}`} className="group block bg-card border border-border/30 overflow-hidden hover:border-primary/30 transition-colors">
                    <div className="p-6">
                      <div className="flex items-center gap-2 mb-3">
                        <BookOpen className="w-4 h-4 text-primary" />
                        <span className="text-[12px] text-primary tracking-wide">
                          {GUIDE_CATEGORY_LABELS[rel.category]}
                        </span>
                      </div>
                      <h3 className="font-semibold font-bold text-lg text-foreground tracking-wider group-hover:text-primary transition-colors leading-tight line-clamp-2">
                        {rel.title.replace(/ \| Nick.*$/, "")}
                      </h3>
                      <p className="mt-2 text-foreground/50 text-sm line-clamp-2">
                        {rel.description}
                      </p>
                    </div>
                  </Link>
                </FadeIn>
              ))}
            </div>

            <FadeIn delay={0.2}>
              <div className="mt-8 text-center">
                <Link href="/guides" className="inline-flex items-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-semibold font-bold text-sm tracking-wide hover:border-primary hover:text-primary transition-colors">
                  VIEW ALL GUIDES
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </FadeIn>
          </div>
        </section>
      )}

      <InternalLinks />
    </PageLayout>
  );
}
