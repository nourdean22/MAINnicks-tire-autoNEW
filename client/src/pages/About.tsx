/**
 * /about — About Nick's Tire & Auto.
 * Trust-building page with full story, philosophy, and community focus.
 */
import InternalLinks from "@/components/InternalLinks";
import { Link } from "wouter";
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { Phone, Star, ArrowRight, CreditCard } from "lucide-react";
import { motion } from "framer-motion";
import FadeIn from "@/components/FadeIn";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";
const DIAG_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-diagnostics-AN7H3iz5Tow2ab2METgner.webp";

export default function About() {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, { staleTime: 60 * 60 * 1000, retry: 1 });
  const rating = googleData?.rating ?? 4.9;
  const totalReviews = googleData?.totalReviews ?? BUSINESS.reviews.count;

  return (
    <PageLayout activeHref="/about">
      <SEOHead
        title="About Us | Nick's Tire & Auto Cleveland"
        description="Nick's Tire & Auto — honest diagnostics, fair pricing since 2018. 4.9★ (1,700+ reviews). Serving Cleveland & Euclid. Call (216) 862-0005."
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
              Serving East Cleveland since 2018. An independent shop built on one idea: show you the problem before we fix it.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Nick's Story */}
      <section className="py-20 bg-nick-dark">
        <div className="max-w-5xl mx-auto px-6 grid md:grid-cols-2 gap-12 items-center">
          <FadeIn>
            <div>
              <h2 className="text-3xl font-bold text-foreground mb-6">Built from the ground up on Euclid Ave.</h2>
              <p className="text-foreground/70 mb-4">
                Nick's Tire & Auto opened in 2018 with a straightforward mission: give East Side Cleveland drivers a shop they could actually trust. No pressure sales. No mystery invoices. Just honest diagnostics, fair prices, and the respect of showing you exactly what's wrong before we touch your car.
              </p>
              <p className="text-foreground/70 mb-4">
                What started as a small independent shop has grown into one of Cleveland's top-rated auto repair shops, with over {totalReviews.toLocaleString()} five-star Google reviews from real customers across the city.
              </p>
              <p className="text-foreground/70">
                We're not a chain. We're not a dealership. We're your neighbors — and we treat your car like it belongs to one.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={0.15}>
            <div className="bg-white/5 rounded-2xl p-8 border border-white/10">
              <div className="grid grid-cols-2 gap-6">
                <div className="text-center">
                  <div className="text-4xl font-black text-primary mb-1">2018</div>
                  <div className="text-foreground/60 text-sm">Year Founded</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-black text-primary mb-1">{totalReviews.toLocaleString()}+</div>
                  <div className="text-foreground/60 text-sm">5-Star Reviews</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-black text-primary mb-1">{rating.toFixed(1)}</div>
                  <div className="text-foreground/60 text-sm">Google Rating</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-black text-primary mb-1">7+</div>
                  <div className="text-foreground/60 text-sm">Years Serving Cleveland</div>
                </div>
              </div>
            </div>
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
                <p className="mt-4 text-foreground/50 text-lg leading-relaxed">
                  We even built a free AI-powered Diagnose tool so you can describe your car's symptoms before you even come in — no pressure, no obligation.
                </p>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Why Trust Us */}
      <section className="section-elevated py-24 lg:py-32">
        <div className="container">
          <FadeIn>
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground tracking-tight text-center mb-16">
              Why Cleveland drivers trust us.
            </h2>
          </FadeIn>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { title: "Honest Diagnostics", text: "We use advanced OBD-II scanners and live data analysis. We test before we replace, so you never pay for parts you don't need." },
              { title: "Fair Pricing", text: "No hidden fees. No surprise charges. The price we quote is the price you pay, and we explain every line item." },
              { title: "Full-Service Shop", text: "Tires, brakes, diagnostics, emissions, oil changes, suspension, steering, exhaust — one shop for everything." },
              { title: "Since 2018", text: "7 years of serving East Cleveland with zero corporate pressure. We answer to our customers, not shareholders." },
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

      {/* Rooted in East Cleveland */}
      <section className="py-16 bg-white/5">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <FadeIn>
            <h2 className="text-2xl font-bold text-foreground mb-4">Rooted in East Cleveland</h2>
            <p className="text-foreground/70 max-w-2xl mx-auto mb-8">
              We're located at 17625 Euclid Ave — right in the heart of East Cleveland. We serve drivers from Euclid, East Cleveland, Cleveland Heights, South Euclid, Lyndhurst, Willoughby, and across the East Side. If you're a local, this is your shop.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              {["Cleveland", "Euclid", "East Cleveland", "Cleveland Heights", "South Euclid", "Lyndhurst", "Willoughby", "Wickliffe"].map(area => (
                <FadeIn key={area}>
                  <span className="px-4 py-2 bg-white/10 rounded-full text-sm text-foreground/70">{area}</span>
                </FadeIn>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Financing + Rewards */}
      <section className="py-12 bg-nick-dark border-y border-white/10">
        <div className="max-w-5xl mx-auto px-6 grid md:grid-cols-2 gap-8">
          <FadeIn>
            <div className="flex gap-4 items-start">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <CreditCard className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-bold text-foreground mb-1">Payment Options Available</h3>
                <p className="text-foreground/60 text-sm">Need tires or major repairs but can't pay all at once? We offer lease-to-own and financing options so you can get back on the road without the stress. Ask us how.</p>
              </div>
            </div>
          </FadeIn>
          <FadeIn delay={0.1}>
            <div className="flex gap-4 items-start">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <Star className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-bold text-foreground mb-1">Rewards Program</h3>
                <p className="text-foreground/60 text-sm">Earn rewards on every visit. Our loyalty program is our way of saying thank you to the drivers who trust us year after year.</p>
              </div>
            </div>
          </FadeIn>
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