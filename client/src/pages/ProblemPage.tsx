import PageLayout from "@/components/PageLayout";
import { useParams, useRoute } from "wouter";
import { Link } from "wouter";
import { Phone, ChevronRight, AlertOctagon } from "lucide-react";
import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { getProblemBySlug } from "@shared/seo-pages";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FinancingCTA from "@/components/FinancingCTA";

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
  if (typeof window !== "undefined" && window.gtag) {
    window.gtag("event", "phone_call_click", { event_category: "conversion", event_label: location });
  }
}

function LikelihoodBadge({ likelihood }: { likelihood: string }) {
  const colors = {
    "Common": "bg-red-500/20 text-red-400 border-red-500/30",
    "Moderate": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    "Less Common": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  };
  return (
    <span className={`px-2 py-0.5 text-xs border rounded ${colors[likelihood as keyof typeof colors] || colors["Moderate"]}`}>
      {likelihood}
    </span>
  );
}

export default function ProblemPage() {
  const { slug: paramSlug } = useParams<{ slug: string }>();
  // Fallback: extract slug from pathname if useParams doesn't match (static routes)
  const slug = paramSlug || (typeof window !== "undefined" ? window.location.pathname.replace(/^\//, "").split("/")[0] : "");
  const page = slug ? getProblemBySlug(slug) : undefined;

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
    { label: "Services", href: "/#services" },
    { label: page.heroHeadline.replace("\n", " ").replace("?", "") },
  ];

  return (
    <PageLayout showChat={true}>
      <SEOHead
        title={page.metaTitle}
        description={page.metaDescription}
        canonicalPath={`/${page.slug}`}
      />
      <LocalBusinessSchema />


        {/* Hero */}
        <section className="relative pt-28 pb-16 lg:pt-36 lg:pb-24">
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
              <div className="mt-8 flex flex-col sm:flex-row gap-4 stagger-in">
                <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick(`problem-${page.slug}-hero`)} className="inline-flex items-center justify-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:bg-primary/90 transition-colors">
                  <Phone className="w-5 h-5" />CALL FOR DIAGNOSIS
                </a>
                <Link href="/contact" className="inline-flex items-center justify-center gap-2 stagger-in border-2 border-foreground/30 text-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:border-primary hover:text-primary transition-colors">
                  SCHEDULE ONLINE <ChevronRight className="w-5 h-5" />
                </Link>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Problem Description */}
        <section className="py-16 lg:py-20 border-t border-border/30">
          <div className="container max-w-4xl">
            <FadeIn>
              <span className="font-mono text-primary text-sm tracking-wide">Understanding the Problem</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight mb-6">
                WHAT IS HAPPENING
              </h2>
              <p className="text-foreground/70 leading-relaxed text-lg">{page.problemDescription}</p>
            </FadeIn>
          </div>
        </section>

        {/* When to Stop Driving */}
        <section className="py-12 lg:py-16 bg-red-500/10 border-y border-red-500/20">
          <div className="container max-w-4xl">
            <FadeIn>
              <div className="flex items-start gap-4 stagger-in">
                <AlertOctagon className="w-8 h-8 text-red-400 shrink-0 mt-1" />
                <div>
                  <h2 className="font-semibold font-bold text-xl lg:text-2xl text-red-400 tracking-tight mb-3">
                    WHEN TO STOP DRIVING
                  </h2>
                  <p className="text-foreground/80 leading-relaxed">{page.whenToStop}</p>
                </div>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Possible Causes */}
        <section className="py-16 lg:py-20 bg-[oklch(0.055_0.004_260)]">
          <div className="container">
            <FadeIn>
              <span className="font-mono text-primary text-sm tracking-wide">Root Causes</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight">
                POSSIBLE CAUSES
              </h2>
            </FadeIn>
            <div className="mt-10 space-y-6">
              {page.possibleCauses.map((cause, i) => (
                <FadeIn key={i} delay={i * 0.08}>
                  <div className="border border-border/40 p-6 bg-card/30">
                    <div className="flex items-start justify-between mb-3 flex-wrap gap-2 stagger-in">
                      <h3 className="font-semibold font-bold text-lg text-foreground">{cause.cause}</h3>
                      <LikelihoodBadge likelihood={cause.likelihood} />
                    </div>
                    <p className="text-foreground/70 leading-relaxed mb-3">{cause.explanation}</p>
                    <div className="flex items-center gap-2 stagger-in text-sm">
                      <span className="font-mono text-foreground/40">Typical cost:</span>
                      <span className="font-mono text-primary">{cause.typicalCost}</span>
                    </div>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* How We Diagnose */}
        <section className="py-16 lg:py-20">
          <div className="container max-w-4xl">
            <FadeIn>
              <span className="font-mono text-primary text-sm tracking-wide">Our Approach</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight mb-6">
                HOW WE DIAGNOSE THIS
              </h2>
              <p className="text-foreground/70 leading-relaxed text-lg">{page.diagnosticProcess}</p>
            </FadeIn>
          </div>
        </section>

        {/* How We Fix This */}
        <section className="py-16 lg:py-20 bg-[oklch(0.065_0.004_260)]">
          <div className="container max-w-4xl">
            <FadeIn>
              <span className="font-mono text-primary text-sm tracking-wide">Our Repair Process</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight mb-6">
                HOW WE FIX THIS AT NICK'S
              </h2>
              <p className="text-foreground/70 leading-relaxed text-lg mb-8">
                Every repair at Nick's Tire & Auto starts with understanding the actual problem — not guessing. Here's what happens from the moment you pull into our shop on Euclid Ave to the moment you drive away with a fix that lasts.
              </p>
            </FadeIn>

            <div className="space-y-6">
              <FadeIn delay={0.05}>
                <div className="flex items-start gap-4 stagger-in">
                  <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="font-semibold font-bold text-primary text-sm">1</span>
                  </div>
                  <div>
                    <h3 className="font-semibold font-bold text-foreground text-lg mb-2">Drop Off or Wait</h3>
                    <p className="text-foreground/70 leading-relaxed">Walk-ins are welcome — no appointment needed for diagnostics. Tell our front desk what you're experiencing and we'll get your vehicle into the bay. Most diagnostic inspections start within 30 minutes of arrival.</p>
                  </div>
                </div>
              </FadeIn>
              <FadeIn delay={0.1}>
                <div className="flex items-start gap-4 stagger-in">
                  <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="font-semibold font-bold text-primary text-sm">2</span>
                  </div>
                  <div>
                    <h3 className="font-semibold font-bold text-foreground text-lg mb-2">Full Diagnostic Inspection</h3>
                    <p className="text-foreground/70 leading-relaxed">Our technicians use professional scan tools, visual inspection, and road testing when needed. We don't just read a code and guess — we trace the problem to its root cause so we fix it right the first time.</p>
                  </div>
                </div>
              </FadeIn>
              <FadeIn delay={0.15}>
                <div className="flex items-start gap-4 stagger-in">
                  <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="font-semibold font-bold text-primary text-sm">3</span>
                  </div>
                  <div>
                    <h3 className="font-semibold font-bold text-foreground text-lg mb-2">Honest Quote, Your Decision</h3>
                    <p className="text-foreground/70 leading-relaxed">We'll call you with exactly what we found, what needs to be fixed, and what it costs. No pressure, no upsells. If you want a second opinion, no hard feelings. We give you the information and you make the call.</p>
                  </div>
                </div>
              </FadeIn>
              <FadeIn delay={0.2}>
                <div className="flex items-start gap-4 stagger-in">
                  <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="font-semibold font-bold text-primary text-sm">4</span>
                  </div>
                  <div>
                    <h3 className="font-semibold font-bold text-foreground text-lg mb-2">Repair & Quality Check</h3>
                    <p className="text-foreground/70 leading-relaxed">Once approved, we get to work. Most standard repairs are completed same-day. Before handing your keys back, we verify the fix with a final inspection to make sure everything is solid.</p>
                  </div>
                </div>
              </FadeIn>
            </div>

            <FadeIn delay={0.25}>
              <div className="mt-10 bg-card/50 border border-border/50 rounded-lg p-6">
                <h3 className="font-semibold font-bold text-foreground text-lg mb-3">Estimated Turnaround Times</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 stagger-in text-sm">
                  <div className="flex justify-between text-foreground/70">
                    <span>Diagnostic inspection</span>
                    <span className="font-mono text-primary">30–60 min</span>
                  </div>
                  <div className="flex justify-between text-foreground/70">
                    <span>Minor repair (sensors, filters)</span>
                    <span className="font-mono text-primary">1–2 hours</span>
                  </div>
                  <div className="flex justify-between text-foreground/70">
                    <span>Brake or suspension work</span>
                    <span className="font-mono text-primary">2–4 hours</span>
                  </div>
                  <div className="flex justify-between text-foreground/70">
                    <span>Engine or transmission repair</span>
                    <span className="font-mono text-primary">1–3 days</span>
                  </div>
                </div>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Trust Signals */}
        <section className="py-16 lg:py-20 bg-[oklch(0.055_0.004_260)]">
          <div className="container">
            <FadeIn>
              <span className="font-mono text-primary text-sm tracking-wide">Why Nick's</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight mb-10">
                TRUSTED BY CLEVELAND DRIVERS
              </h2>
            </FadeIn>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 stagger-in">
              <FadeIn delay={0.05}>
                <div className="text-center p-6">
                  <div className="text-4xl font-bold text-primary mb-2">{BUSINESS.reviews.rating}</div>
                  <div className="text-foreground/60 text-sm">Google Rating</div>
                  <div className="text-foreground/40 text-xs mt-1">{BUSINESS.reviews.countDisplay} reviews</div>
                </div>
              </FadeIn>
              <FadeIn delay={0.1}>
                <div className="text-center p-6">
                  <div className="text-4xl font-bold text-primary mb-2">7</div>
                  <div className="text-foreground/60 text-sm">Days a Week</div>
                  <div className="text-foreground/40 text-xs mt-1">{BUSINESS.hours.display}</div>
                </div>
              </FadeIn>
              <FadeIn delay={0.15}>
                <div className="text-center p-6">
                  <div className="text-4xl font-bold text-primary mb-2">$10</div>
                  <div className="text-foreground/60 text-sm">Down Financing</div>
                  <div className="text-foreground/40 text-xs mt-1"><Link href="/financing" className="text-nick-blue-light hover:underline">Learn more</Link></div>
                </div>
              </FadeIn>
              <FadeIn delay={0.2}>
                <div className="text-center p-6">
                  <div className="text-4xl font-bold text-primary mb-2">FCFS</div>
                  <div className="text-foreground/60 text-sm">Walk-Ins Welcome</div>
                  <div className="text-foreground/40 text-xs mt-1">No appointment needed</div>
                </div>
              </FadeIn>
            </div>
            <FadeIn delay={0.25}>
              <p className="mt-8 text-center text-foreground/60 max-w-2xl mx-auto leading-relaxed">
                Located at {BUSINESS.address.full}, Nick's Tire & Auto has been serving Cleveland and Northeast Ohio since 2018. We fix the problem, explain the cost, and get you back on the road — that's it. No games. Read what our customers say on our <Link href="/reviews" className="text-nick-blue-light hover:underline">reviews page</Link>.
              </p>
            </FadeIn>
          </div>
        </section>

        {/* FAQs */}
        <section className="py-16 lg:py-20 bg-[oklch(0.055_0.004_260)]">
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
        <section className="py-16 lg:py-20">
          <div className="container">
            <FadeIn>
              <h2 className="font-semibold font-bold text-2xl lg:text-3xl text-foreground tracking-tight mb-8">
                RELATED SERVICES
              </h2>
            </FadeIn>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-in">
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
                LET US DIAGNOSE THE PROBLEM
              </h2>
              <p className="mt-4 text-primary-foreground/80 text-lg max-w-xl mx-auto">
                We will find the exact cause, explain your options, and give you an honest quote. No guesswork. No unnecessary repairs.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-4 stagger-in justify-center">
                <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick(`problem-${page.slug}-bottom-cta`)} className="inline-flex items-center justify-center gap-2 stagger-in bg-background text-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:bg-background/90 transition-colors">
                  <Phone className="w-5 h-5" />{BUSINESS.phone.display}
                </a>
                <Link href="/contact" className="inline-flex items-center justify-center gap-2 stagger-in border-2 border-primary-foreground text-primary-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:bg-primary-foreground/10 transition-colors">
                  SCHEDULE ONLINE
                </Link>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Footer */}
        

        {/* Sticky Mobile CTA */}
        <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background/95 backdrop-blur-md border-t border-border p-3">
          <div className="flex gap-2 stagger-in">
            <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick(`problem-${page.slug}-sticky`)} aria-label="Call Nick's Tire and Auto" className="flex-1 flex items-center justify-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium py-3 font-semibold font-bold text-sm tracking-wide">
              <Phone className="w-4 h-4" />CALL NOW
            </a>
            <Link href="/contact" className="flex-1 flex items-center justify-center gap-2 stagger-in border border-primary text-primary py-3 font-semibold font-bold text-sm tracking-wide">
              BOOK ONLINE
            </Link>
          </div>
        </div>


      {/* Schema */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": page.faqs.map(faq => ({
          "@type": "Question",
          "name": faq.question,
          "acceptedAnswer": { "@type": "Answer", "text": faq.answer }
        }))
      })}} />
    
      <section className="container pb-8">
        <FinancingCTA variant="banner" />
      </section>
      <InternalLinks />
</PageLayout>
  );
}
