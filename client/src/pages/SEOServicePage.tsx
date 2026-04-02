import PageLayout from "@/components/PageLayout";
import { useParams } from "wouter";
import { Link } from "wouter";
import { Phone, ChevronRight, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import FadeIn from "@/components/FadeIn";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { getSEOServiceBySlug } from "@shared/seo-pages";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import FinancingCTA from "@/components/FinancingCTA";



function trackPhoneClick(location: string) {
  if (typeof window !== "undefined" && (window as any).gtag) {
    (window as any).gtag("event", "phone_call_click", { event_category: "conversion", event_label: location });
  }
}

export default function SEOServicePage() {
  const { slug } = useParams<{ slug: string }>();
  const page = slug ? getSEOServiceBySlug(slug) : undefined;

  if (!page) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-semibold text-4xl text-foreground mb-4">Page Not Found</h1>
          <Link href="/" className="text-primary hover:underline">Return to Homepage</Link>
        </div>
      </div>
    );
  }

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Services", href: "/#services" },
    { label: page.heroHeadline.replace("\n", " ") },
  ];

  return (
    <PageLayout showChat={true}>
      <SEOHead
        title={page.metaTitle}
        description={page.metaDescription}
        canonicalPath={`/${page.slug}`}
      />
      
      
        {/* Hero */}
        <section className="relative pt-28 pb-16 lg:pt-36 lg:pb-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-background via-background/95 to-background" />
          <div className="relative container">
            <Breadcrumbs items={breadcrumbs} />
            <FadeIn>
              <h1 className="font-semibold font-bold text-5xl sm:text-6xl lg:text-7xl text-foreground leading-[0.9] tracking-tight mt-6">
                {page.heroHeadline.split("\n").map((line, i) => (
                  <span key={i}>
                    {i === 0 ? <span className="text-primary">{line}</span> : line}
                    {i < page.heroHeadline.split("\n").length - 1 && <br />}
                  </span>
                ))}
              </h1>
            </FadeIn>
            <FadeIn delay={0.1}>
              <p className="mt-6 text-lg sm:text-xl text-foreground/80 max-w-2xl font-light leading-relaxed">
                {page.heroSubline}
              </p>
            </FadeIn>
            <FadeIn delay={0.2}>
              <div className="mt-8 flex flex-col sm:flex-row gap-4">
                <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick(`seo-${page.slug}-hero`)} className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:bg-primary/90 transition-colors">
                  <Phone className="w-5 h-5" />CALL FOR A FREE QUOTE
                </a>
                <Link href="/contact" className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:border-primary hover:text-primary transition-colors">
                  SCHEDULE ONLINE <ChevronRight className="w-5 h-5" />
                </Link>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Symptoms */}
        <section className="py-16 lg:py-20 border-t border-border/30">
          <div className="container">
            <FadeIn>
              <span className="font-mono text-primary text-sm tracking-wide">Warning Signs</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight">
                COMMON SYMPTOMS
              </h2>
            </FadeIn>
            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {page.symptoms.map((symptom, i) => (
                <FadeIn key={i} delay={i * 0.05}>
                  <div className="flex items-start gap-3 p-4 border border-border/40 bg-card/30 hover:bg-card/50 transition-colors">
                    <AlertTriangle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-foreground/80 text-sm leading-relaxed">{symptom}</span>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* Content Sections */}
        {page.sections.map((section, i) => (
          <section key={i} className={`py-16 lg:py-20 ${i % 2 === 0 ? "bg-background" : "bg-[oklch(0.055_0.004_260)]"}`}>
            <div className="container max-w-4xl">
              <FadeIn>
                <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground tracking-tight mb-6">
                  {section.title.toUpperCase()}
                </h2>
                <p className="text-foreground/70 leading-relaxed text-lg">{section.content}</p>
              </FadeIn>
            </div>
          </section>
        ))}

        {/* How We Handle This Service */}
        <section className="py-16 lg:py-20 bg-[oklch(0.065_0.004_260)]">
          <div className="container max-w-4xl">
            <FadeIn>
              <span className="font-mono text-primary text-sm tracking-wide">Our Process</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight mb-6">
                WHAT HAPPENS WHEN YOU BRING YOUR CAR IN
              </h2>
              <p className="text-foreground/70 leading-relaxed text-lg mb-8">
                At Nick's Tire & Auto, every service follows the same principle: diagnose first, explain clearly, then fix it right. Here's what the process looks like from start to finish.
              </p>
            </FadeIn>
            <div className="space-y-4">
              <FadeIn delay={0.05}>
                <div className="flex items-start gap-4 bg-card/30 border border-border/50 rounded-lg p-5">
                  <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="font-semibold font-bold text-primary text-xs">1</span>
                  </div>
                  <div>
                    <h3 className="font-semibold font-bold text-foreground mb-1">Walk In or Book Online</h3>
                    <p className="text-foreground/70 text-sm leading-relaxed">No appointment needed — we're first-come, first-served. You can also <Link href="/booking" className="text-nick-blue-light hover:underline">book online</Link> or call {BUSINESS.phone.display} to schedule a specific time. Open {BUSINESS.hours.display}, Sundays 9–4.</p>
                  </div>
                </div>
              </FadeIn>
              <FadeIn delay={0.1}>
                <div className="flex items-start gap-4 bg-card/30 border border-border/50 rounded-lg p-5">
                  <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="font-semibold font-bold text-primary text-xs">2</span>
                  </div>
                  <div>
                    <h3 className="font-semibold font-bold text-foreground mb-1">Inspection & Diagnosis</h3>
                    <p className="text-foreground/70 text-sm leading-relaxed">Our technicians inspect your vehicle and identify the root cause — not just the symptoms. We use professional diagnostic tools and hands-on testing to get it right the first time.</p>
                  </div>
                </div>
              </FadeIn>
              <FadeIn delay={0.15}>
                <div className="flex items-start gap-4 bg-card/30 border border-border/50 rounded-lg p-5">
                  <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="font-semibold font-bold text-primary text-xs">3</span>
                  </div>
                  <div>
                    <h3 className="font-semibold font-bold text-foreground mb-1">Transparent Quote</h3>
                    <p className="text-foreground/70 text-sm leading-relaxed">We explain what we found, what needs to be done, and exactly how much it costs. No surprises, no upsells. You approve the work before we start.</p>
                  </div>
                </div>
              </FadeIn>
              <FadeIn delay={0.2}>
                <div className="flex items-start gap-4 bg-card/30 border border-border/50 rounded-lg p-5">
                  <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="font-semibold font-bold text-primary text-xs">4</span>
                  </div>
                  <div>
                    <h3 className="font-semibold font-bold text-foreground mb-1">Repair & Drive</h3>
                    <p className="text-foreground/70 text-sm leading-relaxed">Most repairs are completed same-day. We verify the fix before handing your keys back. Need <Link href="/financing" className="text-nick-blue-light hover:underline">financing</Link>? We offer plans from $10 down so you can get the repair done now.</p>
                  </div>
                </div>
              </FadeIn>
            </div>
          </div>
        </section>

        {/* Trust Signals */}
        <section className="py-16 lg:py-20 bg-[oklch(0.055_0.004_260)]">
          <div className="container">
            <FadeIn>
              <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground tracking-tight mb-10">
                WHY CLEVELAND DRIVERS CHOOSE NICK'S
              </h2>
            </FadeIn>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <FadeIn delay={0.05}>
                <div className="bg-card/30 border border-border/50 rounded-lg p-6">
                  <div className="text-3xl font-bold text-primary mb-2">{BUSINESS.reviews.rating} Stars</div>
                  <p className="text-foreground/70 text-sm leading-relaxed">{BUSINESS.reviews.countDisplay} Google reviews from real Cleveland-area customers. Our reputation is built on honest work and fair pricing — read what drivers say on our <Link href="/reviews" className="text-nick-blue-light hover:underline">reviews page</Link>.</p>
                </div>
              </FadeIn>
              <FadeIn delay={0.1}>
                <div className="bg-card/30 border border-border/50 rounded-lg p-6">
                  <div className="text-3xl font-bold text-primary mb-2">Open 7 Days</div>
                  <p className="text-foreground/70 text-sm leading-relaxed">{BUSINESS.hours.display} and Sundays 9 AM–4 PM. Walk-ins welcome on a first-come, first-served basis. Located at {BUSINESS.address.street} on Euclid Ave with easy access from I-90.</p>
                </div>
              </FadeIn>
              <FadeIn delay={0.15}>
                <div className="bg-card/30 border border-border/50 rounded-lg p-6">
                  <div className="text-3xl font-bold text-primary mb-2">$10 Down</div>
                  <p className="text-foreground/70 text-sm leading-relaxed"><Link href="/financing" className="text-nick-blue-light hover:underline">Financing available</Link> on tires and major repairs. Don't put off a safety repair because of cost — get it fixed today and pay over time with affordable monthly payments.</p>
                </div>
              </FadeIn>
            </div>
          </div>
        </section>

        {/* FAQs */}
        <section className="py-16 lg:py-20 border-t border-border/30">
          <div className="container max-w-4xl">
            <FadeIn>
              <span className="font-mono text-primary text-sm tracking-wide">Common Questions</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight mb-10">
                FREQUENTLY ASKED QUESTIONS
              </h2>
            </FadeIn>
            <div className="space-y-6">
              {page.faqs.map((faq, i) => (
                <FadeIn key={i} delay={i * 0.08}>
                  <div className="border border-border/40 p-6 bg-card/30">
                    <h3 className="font-semibold font-bold text-lg text-foreground mb-3">{faq.question}</h3>
                    <p className="text-foreground/70 leading-relaxed">{faq.answer}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* Related Pages */}
        <section className="py-16 lg:py-20 bg-[oklch(0.055_0.004_260)]">
          <div className="container">
            <FadeIn>
              <h2 className="font-semibold font-bold text-2xl lg:text-3xl text-foreground tracking-tight mb-8">
                RELATED SERVICES
              </h2>
            </FadeIn>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {page.relatedPages.map((relSlug, i) => (
                <FadeIn key={relSlug} delay={i * 0.05}>
                  <Link href={`/${relSlug}`} className="block p-5 border border-border/40 bg-card/30 hover:bg-card/50 hover:border-primary/50 transition-colors group">
                    <span className="font-semibold font-bold text-foreground group-hover:text-primary transition-colors tracking-wide text-sm">
                      {relSlug.replace(/-/g, " ").replace("cleveland", "").trim()}
                    </span>
                    <ChevronRight className="w-4 h-4 text-primary mt-2" />
                  </Link>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 lg:py-24 bg-primary">
          <div className="container text-center">
            <FadeIn>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-primary-foreground tracking-tight">
                READY TO GET THIS FIXED?
              </h2>
              <p className="mt-4 text-primary-foreground/80 text-lg max-w-xl mx-auto">
                Call us or schedule online. We will diagnose the problem, explain your options, and give you an honest quote.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick(`seo-${page.slug}-bottom-cta`)} className="inline-flex items-center justify-center gap-2 bg-background text-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:bg-background/90 transition-colors">
                  <Phone className="w-5 h-5" />{BUSINESS.phone.display}
                </a>
                <Link href="/contact" className="inline-flex items-center justify-center gap-2 border-2 border-primary-foreground text-primary-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:bg-primary-foreground/10 transition-colors">
                  SCHEDULE ONLINE
                </Link>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Footer */}
        

        {/* Sticky Mobile CTA */}
        <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background/95 backdrop-blur-md border-t border-border p-3">
          <div className="flex gap-2">
            <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick(`seo-${page.slug}-sticky`)} aria-label="Call Nick's Tire and Auto" className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground py-3 font-semibold font-bold text-sm tracking-wide">
              <Phone className="w-4 h-4" />CALL NOW
            </a>
            <Link href="/contact" className="flex-1 flex items-center justify-center gap-2 border border-primary text-primary py-3 font-semibold font-bold text-sm tracking-wide">
              BOOK ONLINE
            </Link>
          </div>
        </div>


      {/* Schema Markup */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Service",
        "name": page.heroHeadline.replace("\n", " "),
        "provider": {
          "@type": "LocalBusiness",
          "name": "Nick's Tire & Auto",
          "telephone": "+1-" + BUSINESS.phone.dashed,
          "address": {
            "@type": "PostalAddress",
            "streetAddress": BUSINESS.address.street,
            "addressLocality": "Cleveland",
            "addressRegion": "OH",
            "postalCode": "44112"
          },
          "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": BUSINESS.reviews.rating,
            "reviewCount": BUSINESS.reviews.count,
            "bestRating": "5"
          },
          "hasMap": BUSINESS.urls.googleBusiness,
          "sameAs": [...BUSINESS.sameAs]
        },
        "areaServed": {
          "@type": "City",
          "name": "Cleveland"
        },
        "url": `https://nickstire.org/${page.slug}`
      })}} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": page.faqs.map(faq => ({
          "@type": "Question",
          "name": faq.question,
          "acceptedAnswer": {
            "@type": "Answer",
            "text": faq.answer
          }
        }))
      })}} />
    
      <section className="container pb-8">
        <FinancingCTA variant="banner" />
      </section>
      <InternalLinks />
</PageLayout>
  );
}
