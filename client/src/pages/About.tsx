/**
 * /about — Tesla-style About page.
 * Clean, minimal, photography-driven.
 */
import InternalLinks from "@/components/InternalLinks";
import { useRef } from "react";
import { Link } from "wouter";
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { Phone, Star, ArrowRight } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";
const DIAG_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-diagnostics-AN7H3iz5Tow2ab2METgner.webp";

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 20 }} animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ duration: 0.6, delay, ease: "easeOut" }} className={className}>
      {children}
    </motion.div>
  );
}

export default function About() {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, { staleTime: 60 * 60 * 1000, retry: 1 });
  const rating = googleData?.rating ?? 4.9;
  const totalReviews = googleData?.totalReviews ?? BUSINESS.reviews.count;

  return (
    <PageLayout activeHref="/about">
      <SEOHead
        title="About Us | Nick's Tire & Auto Cleveland"
        description="Learn about Nick's Tire & Auto — honest diagnostics, fair pricing, experienced technicians serving Cleveland, Euclid, and Northeast Ohio."
        canonicalPath="/about"
      />

      {/* Hero */}
      <section className="relative min-h-[60vh] flex items-end overflow-hidden">
        <div className="absolute inset-0">
          <img loading="lazy" src={HERO_IMG} alt="Inside Nick's Tire and Auto" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        </div>
        <div className="relative container pb-16 pt-32">
          <Breadcrumbs items={[{ label: "About" }]} />
      <LocalBusinessSchema />
          <FadeIn>
            <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold text-foreground tracking-tight leading-[0.95] mt-4">
              About <span className="text-primary">Nick's</span>
            </h1>
            <p className="mt-4 text-lg text-foreground/60 max-w-lg font-light">
              An independent shop on Euclid Avenue, built on one idea: show drivers the problem before you fix it.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Philosophy — split layout */}
      <section className="bg-[oklch(0.065_0.004_260)] py-24 lg:py-32">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div className="relative rounded-2xl overflow-hidden aspect-[4/3]">
                <img loading="lazy" src={DIAG_IMG} alt="Technician performing diagnostics" className="w-full h-full object-cover" />
                <div className="absolute bottom-4 right-4 bg-primary px-4 py-3 rounded-xl">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-2xl text-primary-foreground">{rating.toFixed(1)}</span>
                    <div className="flex gap-0.5">
                      {[...Array(5)].map((_, i) => <Star key={i} className="w-3.5 h-3.5 fill-nick-dark text-primary-foreground" />)}
                    </div>
                  </div>
                  <span className="text-xs text-primary-foreground/70 font-medium">{totalReviews.toLocaleString()}+ reviews</span>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div>
                <h2 className="text-3xl lg:text-5xl font-bold text-foreground tracking-tight leading-[1.1]">
                  We show you the problem <span className="text-primary">before we fix it.</span>
                </h2>
                <p className="mt-6 text-foreground/50 text-lg leading-relaxed">
                  Most shops hand you a bill and hope you don't ask questions. We walk you through the diagnosis, show you the worn parts, explain your options, and let you decide. No pressure. No upselling.
                </p>
                <p className="mt-4 text-foreground/50 text-lg leading-relaxed">
                  The price we quote is the price you pay. That approach has earned us {totalReviews.toLocaleString()}+ five-star reviews from Cleveland drivers who keep coming back.
                </p>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* What sets us apart */}
      <section className="section-elevated py-24 lg:py-32">
        <div className="container">
          <FadeIn>
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground tracking-tight text-center mb-16">
              Why Cleveland drivers trust us.
            </h2>
          </FadeIn>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { title: "Honest Diagnostics", text: "We use advanced OBD-II scanners and live data analysis. We test before we replace, so you never pay for parts you don't need." },
              { title: "Fair Pricing", text: "No hidden fees. No surprise charges. The price we quote is the price you pay, and we explain every line item." },
              { title: "Full-Service Shop", text: "Tires, brakes, diagnostics, emissions, oil changes, suspension, steering, exhaust — one shop for everything." },
            ].map((item, i) => (
              <FadeIn key={item.title} delay={i * 0.1}>
                <div className="p-8 border border-border rounded-2xl h-full">
                  <h3 className="text-lg font-semibold text-foreground tracking-tight">{item.title}</h3>
                  <p className="mt-3 text-foreground/40 text-sm leading-relaxed">{item.text}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Services quick links */}
      <section className="bg-[oklch(0.065_0.004_260)] py-24 lg:py-32">
        <div className="container">
          <FadeIn>
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground tracking-tight text-center mb-4">Our Services</h2>
            <p className="text-foreground/40 text-center text-lg mb-12">From routine maintenance to complex repairs.</p>
          </FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { title: "Tires", slug: "/tires" },
              { title: "Brakes", slug: "/brakes" },
              { title: "Diagnostics", slug: "/diagnostics" },
              { title: "Emissions & E-Check", slug: "/emissions" },
              { title: "Oil Change", slug: "/oil-change" },
              { title: "General Repair", slug: "/general-repair" },
            ].map((s, i) => (
              <FadeIn key={s.slug} delay={i * 0.06}>
                <Link href={s.slug} className="group flex items-center justify-between p-5 border border-border rounded-xl hover:border-foreground/20 transition-all">
                  <span className="font-semibold text-foreground group-hover:text-primary transition-colors">{s.title}</span>
                  <ArrowRight className="w-4 h-4 text-foreground/30 group-hover:text-primary transition-colors" />
                </Link>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section-elevated py-24 lg:py-32">
        <div className="container text-center">
          <FadeIn>
            <h2 className="text-3xl lg:text-5xl font-bold text-foreground tracking-tight">Ready to get started?</h2>
            <p className="mt-4 text-foreground/40 text-lg max-w-md mx-auto">Call us, book online, or just stop by. Walk-ins welcome.</p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick("about-cta")} className="inline-flex items-center justify-center gap-2 bg-foreground text-background px-8 py-3.5 rounded-full font-medium hover:bg-foreground/90 transition-colors">
                <Phone className="w-4 h-4" />
                Call {BUSINESS.phone.display}
              </a>
              <Link href="/contact" className="inline-flex items-center justify-center gap-2 border border-foreground/30 text-foreground px-8 py-3.5 rounded-full font-medium hover:bg-foreground/5 transition-colors">
                Book Online
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>
      <InternalLinks title="Explore Our Services" />
    </PageLayout>
  );
}
