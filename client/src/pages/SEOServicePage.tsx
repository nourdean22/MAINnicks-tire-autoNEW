import { useParams } from "wouter";
import { Link } from "wouter";
import { Phone, MapPin, Clock, ChevronRight, AlertTriangle, CheckCircle2, Menu, X, Star } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { SEOHead, SkipToContent, Breadcrumbs } from "@/components/SEO";
import { getSEOServiceBySlug, type SEOServicePage as SEOServicePageType } from "@shared/seo-pages";

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 30 }} animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }} transition={{ duration: 0.5, delay, ease: "easeOut" }} className={className}>
      {children}
    </motion.div>
  );
}

function trackPhoneClick(location: string) {
  if (typeof window !== "undefined" && (window as any).gtag) {
    (window as any).gtag("event", "phone_call_click", { event_category: "conversion", event_label: location });
  }
}

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const links = [
    { label: "Services", href: "/#services" },
    { label: "About", href: "/about" },
    { label: "Reviews", href: "/#reviews" },
    { label: "Blog", href: "/blog" },
    { label: "FAQ", href: "/faq" },
    { label: "Contact", href: "/contact" },
  ];
  return (
    <nav aria-label="Main navigation" className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-nick-dark/95 backdrop-blur-md shadow-lg" : "bg-nick-dark/90 backdrop-blur-sm"}`}>
      <div className="container flex items-center justify-between h-16 lg:h-20">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary flex items-center justify-center rounded-sm">
            <span className="font-heading font-bold text-primary-foreground text-lg">N</span>
          </div>
          <div className="flex flex-col">
            <span className="font-heading font-bold text-primary text-lg leading-tight tracking-wide">NICK'S TIRE & AUTO</span>
            <span className="text-muted-foreground text-xs tracking-widest uppercase">Cleveland, Ohio</span>
          </div>
        </Link>
        <div className="hidden lg:flex items-center gap-8">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="font-heading text-sm tracking-widest uppercase text-foreground/80 hover:text-primary transition-colors">{l.label}</Link>
          ))}
          <a href="tel:2168620005" onClick={() => trackPhoneClick("seo-service-nav")} aria-label="Call Nick's Tire and Auto at 216-862-0005" className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 font-heading font-bold text-sm tracking-wider uppercase hover:bg-primary/90 transition-colors">
            <Phone className="w-4 h-4" />(216) 862-0005
          </a>
        </div>
        <button onClick={() => setMobileOpen(!mobileOpen)} className="lg:hidden text-foreground p-2" aria-label={mobileOpen ? "Close menu" : "Open menu"}>
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>
      {mobileOpen && (
        <div className="lg:hidden bg-nick-dark/98 backdrop-blur-md border-t border-border">
          <div className="container py-6 flex flex-col gap-4">
            {links.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setMobileOpen(false)} className="font-heading text-lg tracking-widest uppercase text-foreground/80 hover:text-primary transition-colors py-2">{l.label}</Link>
            ))}
            <a href="tel:2168620005" onClick={() => trackPhoneClick("seo-service-mobile-nav")} className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-3 font-heading font-bold text-sm tracking-wider uppercase mt-2">
              <Phone className="w-4 h-4" />(216) 862-0005
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}

export default function SEOServicePage() {
  const { slug } = useParams<{ slug: string }>();
  const page = slug ? getSEOServiceBySlug(slug) : undefined;

  if (!page) {
    return (
      <div className="min-h-screen bg-nick-dark flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-heading text-4xl text-foreground mb-4">Page Not Found</h1>
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
    <>
      <SEOHead
        title={page.metaTitle}
        description={page.metaDescription}
        canonicalPath={`/${page.slug}`}
      />
      <SkipToContent />
      <Navbar />

      <main id="main-content" className="bg-nick-dark">
        {/* Hero */}
        <section className="relative pt-28 pb-16 lg:pt-36 lg:pb-24 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-nick-dark via-nick-dark/95 to-nick-dark" />
          <div className="relative container">
            <Breadcrumbs items={breadcrumbs} />
            <FadeIn>
              <h1 className="font-heading font-bold text-5xl sm:text-6xl lg:text-7xl text-foreground leading-[0.9] tracking-tight mt-6">
                {page.heroHeadline.split("\n").map((line, i) => (
                  <span key={i}>
                    {i === 0 ? <span className="text-gradient-yellow">{line}</span> : line}
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
                <a href="tel:2168620005" onClick={() => trackPhoneClick(`seo-${page.slug}-hero`)} className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-heading font-bold text-lg tracking-wider uppercase hover:bg-primary/90 transition-colors">
                  <Phone className="w-5 h-5" />CALL FOR A FREE QUOTE
                </a>
                <Link href="/contact" className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-heading font-bold text-lg tracking-wider uppercase hover:border-primary hover:text-primary transition-colors">
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
              <span className="font-mono text-primary text-sm tracking-widest uppercase">Warning Signs</span>
              <h2 className="font-heading font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight">
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
          <section key={i} className={`py-16 lg:py-20 ${i % 2 === 0 ? "bg-nick-dark" : "section-darker"}`}>
            <div className="container max-w-4xl">
              <FadeIn>
                <h2 className="font-heading font-bold text-3xl lg:text-4xl text-foreground tracking-tight mb-6">
                  {section.title.toUpperCase()}
                </h2>
                <p className="text-foreground/70 leading-relaxed text-lg">{section.content}</p>
              </FadeIn>
            </div>
          </section>
        ))}

        {/* FAQs */}
        <section className="py-16 lg:py-20 border-t border-border/30">
          <div className="container max-w-4xl">
            <FadeIn>
              <span className="font-mono text-primary text-sm tracking-widest uppercase">Common Questions</span>
              <h2 className="font-heading font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight mb-10">
                FREQUENTLY ASKED QUESTIONS
              </h2>
            </FadeIn>
            <div className="space-y-6">
              {page.faqs.map((faq, i) => (
                <FadeIn key={i} delay={i * 0.08}>
                  <div className="border border-border/40 p-6 bg-card/30">
                    <h3 className="font-heading font-bold text-lg text-foreground mb-3">{faq.question}</h3>
                    <p className="text-foreground/70 leading-relaxed">{faq.answer}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* Related Pages */}
        <section className="py-16 lg:py-20 section-darker">
          <div className="container">
            <FadeIn>
              <h2 className="font-heading font-bold text-2xl lg:text-3xl text-foreground tracking-tight mb-8">
                RELATED SERVICES
              </h2>
            </FadeIn>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {page.relatedPages.map((relSlug, i) => (
                <FadeIn key={relSlug} delay={i * 0.05}>
                  <Link href={`/${relSlug}`} className="block p-5 border border-border/40 bg-card/30 hover:bg-card/50 hover:border-primary/50 transition-colors group">
                    <span className="font-heading font-bold text-foreground group-hover:text-primary transition-colors tracking-wider uppercase text-sm">
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
              <h2 className="font-heading font-bold text-3xl lg:text-5xl text-primary-foreground tracking-tight">
                READY TO GET THIS FIXED?
              </h2>
              <p className="mt-4 text-primary-foreground/80 text-lg max-w-xl mx-auto">
                Call us or schedule online. We will diagnose the problem, explain your options, and give you an honest quote.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                <a href="tel:2168620005" onClick={() => trackPhoneClick(`seo-${page.slug}-bottom-cta`)} className="inline-flex items-center justify-center gap-2 bg-nick-dark text-foreground px-8 py-4 font-heading font-bold text-lg tracking-wider uppercase hover:bg-nick-dark/90 transition-colors">
                  <Phone className="w-5 h-5" />(216) 862-0005
                </a>
                <Link href="/contact" className="inline-flex items-center justify-center gap-2 border-2 border-primary-foreground text-primary-foreground px-8 py-4 font-heading font-bold text-lg tracking-wider uppercase hover:bg-primary-foreground/10 transition-colors">
                  SCHEDULE ONLINE
                </Link>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Footer */}
        <footer className="bg-nick-dark border-t border-border/30 py-12">
          <div className="container">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-primary flex items-center justify-center rounded-sm">
                    <span className="font-heading font-bold text-primary-foreground text-sm">N</span>
                  </div>
                  <span className="font-heading font-bold text-primary tracking-wide">NICK'S TIRE & AUTO</span>
                </div>
                <p className="text-foreground/60 text-sm leading-relaxed">Honest auto repair serving Cleveland, Euclid, and Northeast Ohio. Fair prices, real diagnostics, no surprises.</p>
              </div>
              <div>
                <h4 className="font-heading font-bold text-foreground tracking-wider text-sm uppercase mb-4">Contact</h4>
                <div className="space-y-2 text-foreground/60 text-sm">
                  <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" />17625 Euclid Ave, Cleveland, OH 44112</div>
                  <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-primary" /><a href="tel:2168620005" onClick={() => trackPhoneClick(`seo-${page.slug}-footer`)} className="hover:text-primary transition-colors">(216) 862-0005</a></div>
                  <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-primary" />Mon–Sat 9AM–6PM</div>
                </div>
              </div>
              <div>
                <h4 className="font-heading font-bold text-foreground tracking-wider text-sm uppercase mb-4">Services</h4>
                <div className="space-y-2 text-foreground/60 text-sm">
                  <Link href="/tires" className="block hover:text-primary transition-colors">Tires</Link>
                  <Link href="/brakes" className="block hover:text-primary transition-colors">Brakes</Link>
                  <Link href="/diagnostics" className="block hover:text-primary transition-colors">Diagnostics</Link>
                  <Link href="/emissions" className="block hover:text-primary transition-colors">Emissions & E-Check</Link>
                  <Link href="/general-repair" className="block hover:text-primary transition-colors">General Repair</Link>
                </div>
              </div>
            </div>
            <div className="mt-8 pt-8 border-t border-border/30 text-center text-foreground/40 text-xs">
              © {new Date().getFullYear()} Nick's Tire & Auto. All rights reserved.
            </div>
          </div>
        </footer>

        {/* Sticky Mobile CTA */}
        <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-nick-dark/95 backdrop-blur-md border-t border-border p-3">
          <div className="flex gap-2">
            <a href="tel:2168620005" onClick={() => trackPhoneClick(`seo-${page.slug}-sticky`)} aria-label="Call Nick's Tire and Auto" className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground py-3 font-heading font-bold text-sm tracking-wider uppercase">
              <Phone className="w-4 h-4" />CALL NOW
            </a>
            <Link href="/contact" className="flex-1 flex items-center justify-center gap-2 border border-primary text-primary py-3 font-heading font-bold text-sm tracking-wider uppercase">
              BOOK ONLINE
            </Link>
          </div>
        </div>
      </main>

      {/* Schema Markup */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Service",
        "name": page.heroHeadline.replace("\n", " "),
        "provider": {
          "@type": "LocalBusiness",
          "name": "Nick's Tire & Auto",
          "telephone": "+1-216-862-0005",
          "address": {
            "@type": "PostalAddress",
            "streetAddress": "17625 Euclid Ave",
            "addressLocality": "Cleveland",
            "addressRegion": "OH",
            "postalCode": "44112"
          }
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
    </>
  );
}
