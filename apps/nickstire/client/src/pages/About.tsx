/**
 * /about — About Nick's Tire & Auto.
 * Trust-building page with full story, philosophy, and community focus.
 */
import InternalLinks from "@/components/InternalLinks";
import { Link } from "wouter";
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import {
  Phone, Star, ArrowRight, CreditCard,
  Camera, Car, FileCheck, Wrench, Award, ShieldCheck,
  MapPin, Quote,
} from "lucide-react";
import FadeIn from "@/components/FadeIn";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import ResponsivePhoto from "@/components/ResponsivePhoto";
import { CURATED_TESTIMONIALS } from "@shared/customer-testimonials";

// wave-181.23 · /about social-proof wall.
// Three hand-picked testimonials surface the strongest brand-voice
// trust patterns: anti-upsell, flashlight-tour philosophy, "honest
// work" customer language. Pulled from the curated set so they survive
// even when review_replies hasn't populated from the live Google feed.
const ABOUT_QUOTES = [
  CURATED_TESTIMONIALS.find((t) => t.name === "Amber S."),
  CURATED_TESTIMONIALS.find((t) => t.name === "Greg M."),
  CURATED_TESTIMONIALS.find((t) => t.name === "Marcus L."),
].filter((t): t is NonNullable<typeof t> => Boolean(t));

// wave-181.x · About page now uses two new operator-supplied shop photos:
//   HERO_IMG · close-shot of the actual Nick's signage with tire banners ·
//             stronger brand-identity hero than the wide-sign-bays variant
//   WAITING_IMG · interior waiting area with the iconic "BRAKES FOREVER"
//                 sign + plaid couch + sunlight · trust signal that we're
//                 a real-real shop a customer would sit comfortably in
// Filenames carry brand + geo keywords for image-search ranking.
const HERO_IMG = "/photos/nicks-tire-auto-shop-sign-cleveland-ohio.webp";
const DIAG_IMG = "/photos/busy-shop-action-mechanics.webp";
const WAITING_IMG = "/photos/nicks-tire-auto-customer-waiting-area-cleveland.webp";

export default function About() {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, { staleTime: 60 * 60 * 1000, retry: 1 });
  const rating = googleData?.rating ?? 4.9;
  const totalReviews = googleData?.totalReviews ?? BUSINESS.reviews.count;

  return (
    <PageLayout activeHref="/about" showChat={true}>
      <SEOHead
        title="About Nick's Tire & Auto · Cleveland's Honest Crew Since 2018"
        description={`Family-run auto repair on Euclid Ave. 4.9★ Google rating across ${BUSINESS.reviews.countDisplay} reviews, ${BUSINESS.warranty.display}, and a coffee maker older than half our customers. Walk-ins welcome 7 days. ${BUSINESS.phone.display}`}
        canonicalPath="/about"
      />

      {/* Hero */}
      <section className="relative min-h-[60vh] flex items-end overflow-hidden">
        <div className="absolute inset-0">
          {/* LCP fix · hero is above-the-fold, must load eagerly with high priority.
              ResponsivePhoto serves /storefront-day-mobile.webp (98KB) under
              768px instead of the 469KB desktop variant. */}
          <ResponsivePhoto loading="eager" fetchPriority="high" src={HERO_IMG} alt="Nick's Tire & Auto shop sign on Euclid Avenue in Cleveland, Ohio — yellow Nick's Tire & Auto branded sign with phone number 216-862-0005 and tire stacks on the sidewalk" className="w-full h-full object-cover" objectPosition="center 42%" />
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
                Nick's Tire & Auto opened in 2018 with a straightforward mission: give East Side Cleveland drivers a shop they could actually trust. No pressure sales. No mystery invoices. Just honest answers, fair prices, and the respect of showing you exactly what's wrong before we touch your car.
              </p>
              <p className="text-foreground/70 mb-4">
                What started as a small independent shop has grown into Cleveland's 4.9★, {totalReviews.toLocaleString()}-review East Side shop — real customers, real reviews, no marketing budget.
              </p>
              <p className="text-foreground/70">
                We're not a chain. We're not a dealership. We're your neighbors — and we treat your car like it belongs to one.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={0.15}>
            <div className="bg-white/5 rounded-2xl p-8 border border-white/10">
              <div className="grid grid-cols-2 gap-6 stagger-in">
                <div className="text-center">
                  <div className="text-4xl font-black text-primary mb-1 text-gradient-yellow">2018</div>
                  <div className="text-foreground/60 text-sm">Year Founded</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-black text-primary mb-1 text-gradient-yellow">{totalReviews.toLocaleString()}+</div>
                  <div className="text-foreground/60 text-sm">5-Star Reviews</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-black text-primary mb-1 text-gradient-yellow">{rating.toFixed(1)}</div>
                  <div className="text-foreground/60 text-sm">Google Rating</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-black text-primary mb-1 text-gradient-yellow">{new Date().getFullYear() - 2018}+</div>
                  <div className="text-foreground/60 text-sm">Years Serving Cleveland</div>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Authority strip — credentials + equipment + history */}
      <section className="bg-[oklch(0.07_0.004_260)] py-12 lg:py-16 border-y border-white/5">
        <div className="container max-w-6xl">
          <FadeIn>
            <div className="flex items-center justify-center gap-2 mb-6 text-foreground/40 text-xs uppercase tracking-[0.2em] font-bold">
              <Award className="w-4 h-4 text-primary" />
              The shop floor, not the marketing pitch
            </div>
          </FadeIn>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { stat: "30+", label: "Years combined tech experience", sub: "Master + journeyman techs across the floor" },
              { stat: "4 bays", label: "Operating capacity", sub: "Two lifts, two flat-bay drive-ons; ~32 jobs/day max" },
              { stat: "OBD-II + live data", label: "Scan tools, manufacturer-grade", sub: "Snap-on / Autel — same tools the dealer uses" },
              { stat: "12-mo", label: "Parts + labor warranty", sub: "12-month parts / 90-day labor — in writing" },
            ].map((item, i) => (
              <FadeIn key={item.label} delay={i * 0.08}>
                <div className="text-center">
                  <div className="font-heading text-3xl lg:text-4xl font-bold text-primary mb-2 tracking-tight">{item.stat}</div>
                  <div className="text-foreground/80 text-sm font-semibold leading-tight mb-1.5">{item.label}</div>
                  <div className="text-foreground/45 text-xs leading-snug">{item.sub}</div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Philosophy — split layout */}
      <section className="bg-[oklch(0.065_0.004_260)] py-24 lg:py-32">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div className="relative rounded-2xl overflow-hidden aspect-[4/3]">
                <img loading="lazy" src={DIAG_IMG} alt="Auto diagnostics in progress at Nick's Tire & Auto Cleveland — engine bay testing" className="w-full h-full object-cover" style={{ objectPosition: "center 50%" }} />
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
                  Most shops hand you a bill and hope you don't ask questions. We walk you under the car, show you the worn parts, explain your options, and let you decide. No pressure. No upselling.
                </p>
                <p className="mt-4 text-foreground/50 text-lg leading-relaxed">
                  The price we quote is the price you pay. That approach has earned us {totalReviews.toLocaleString()}+ five-star reviews from Cleveland drivers who keep coming back.
                </p>
                <p className="mt-4 text-foreground/50 text-lg leading-relaxed">
                  We even built a free Diagnose tool — describe your car's symptoms before you come in, no pressure, no obligation.
                </p>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* wave-181.23 · Pull-quote testimonial wall.
          Placed right after the Philosophy split so the visitor sees
          real customer language reinforcing the philosophy they just
          read. Three quotes covering the three highest-trust patterns:
          (1) honest work + price, (2) anti-upsell discipline,
          (3) flashlight-tour transparency. */}
      <section className="bg-[oklch(0.06_0.004_260)] py-20 lg:py-28 border-y border-white/5">
        <div className="container max-w-6xl">
          <FadeIn>
            <div className="text-center mb-12">
              <div className="text-xs uppercase tracking-[0.2em] text-primary font-bold mb-2">
                In our customers' words
              </div>
              <h2 className="text-3xl lg:text-4xl font-bold text-foreground tracking-tight uppercase">
                4.9★ from {totalReviews.toLocaleString()}+ Cleveland drivers.
                <span className="block text-primary text-2xl lg:text-3xl mt-2 normal-case">
                  These are three of them.
                </span>
              </h2>
            </div>
          </FadeIn>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {ABOUT_QUOTES.map((q, i) => (
              <FadeIn key={q.name} delay={i * 0.1}>
                <figure className="h-full bg-[#141414] border border-[#2A2A2A] rounded-2xl p-6 lg:p-7 flex flex-col">
                  <Quote className="w-6 h-6 text-primary/40 mb-3" aria-hidden />
                  <blockquote className="text-foreground/80 text-[14px] lg:text-[15px] leading-relaxed flex-1">
                    {q.text}
                  </blockquote>
                  <figcaption className="mt-5 pt-4 border-t border-white/5 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-foreground text-sm">{q.name}</div>
                      <div className="text-foreground/40 text-[11px] uppercase tracking-[0.1em] mt-0.5">
                        Google · {q.date}
                      </div>
                    </div>
                    <div className="flex gap-0.5">
                      {[...Array(q.rating)].map((_, i) => (
                        <Star key={i} className="w-3.5 h-3.5 fill-primary text-primary" />
                      ))}
                    </div>
                  </figcaption>
                </figure>
              </FadeIn>
            ))}
          </div>
          <FadeIn delay={0.4}>
            <div className="text-center mt-10">
              <Link
                href="/reviews"
                className="inline-flex items-center gap-1.5 text-primary hover:text-primary/80 text-sm font-semibold tracking-tight transition-colors"
              >
                Read {totalReviews.toLocaleString()}+ more reviews
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* wave-181.23 · "Real shop" triple-anchor.
          The single most effective trust device a small business can
          deploy: name the physical address, the phone number, and the
          street so the visitor mentally pictures driving past it.
          Anti-pattern: corporate-looking shops with no clear physical
          address get filtered by skeptical Cleveland drivers. */}
      <section className="bg-[#0B0B0B] py-14 lg:py-16 border-b border-[#1F1F1F]">
        <div className="container max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="flex items-start gap-4 p-5 rounded-xl border border-[#1F1F1F] bg-[#101010]">
              <MapPin className="w-6 h-6 text-primary mt-0.5 shrink-0" aria-hidden />
              <div>
                <div className="text-foreground/50 text-[10px] uppercase tracking-[0.18em] font-bold mb-1.5">
                  The address
                </div>
                <div className="text-foreground font-semibold text-[15px] leading-tight">
                  {BUSINESS.address.street}
                </div>
                <div className="text-foreground/60 text-[13px] mt-0.5">
                  {BUSINESS.address.city}, {BUSINESS.address.state} {BUSINESS.address.zip}
                </div>
                <div className="text-foreground/35 text-[11px] mt-2">
                  Yellow sign · open bays · real building you can drive past
                </div>
              </div>
            </div>
            <a
              href={BUSINESS.phone.href}
              onClick={() => trackPhoneClick("about-real-phone")}
              className="flex items-start gap-4 p-5 rounded-xl border border-[#1F1F1F] bg-[#101010] hover:border-primary/30 hover:bg-[#FDB913]/[0.02] transition-all group"
            >
              <Phone className="w-6 h-6 text-primary mt-0.5 shrink-0" aria-hidden />
              <div>
                <div className="text-foreground/50 text-[10px] uppercase tracking-[0.18em] font-bold mb-1.5">
                  The phone
                </div>
                <div className="text-foreground font-semibold text-[15px] leading-tight group-hover:text-primary transition-colors">
                  {BUSINESS.phone.display}
                </div>
                <div className="text-foreground/60 text-[13px] mt-0.5">
                  Answered by an actual person at the shop
                </div>
                <div className="text-foreground/35 text-[11px] mt-2">
                  No phone tree · no call-center · 7 days a week
                </div>
              </div>
            </a>
            <div className="flex items-start gap-4 p-5 rounded-xl border border-[#1F1F1F] bg-[#101010]">
              <Wrench className="w-6 h-6 text-primary mt-0.5 shrink-0" aria-hidden />
              <div>
                <div className="text-foreground/50 text-[10px] uppercase tracking-[0.18em] font-bold mb-1.5">
                  The bay
                </div>
                <div className="text-foreground font-semibold text-[15px] leading-tight">
                  4 lifts · 30+ years combined experience
                </div>
                <div className="text-foreground/60 text-[13px] mt-0.5">
                  Master + journeyman techs on the floor
                </div>
                <div className="text-foreground/35 text-[11px] mt-2">
                  Snap-on / Autel scan tools · manufacturer-grade
                </div>
              </div>
            </div>
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
              { title: "Honest Answers", text: "OBD-II scanners and live data on every car. We test before we replace — so you never pay for parts you don't need." },
              { title: "Fair Pricing", text: "The price we quote is the price you pay. Every line item explained. We tell you the cost before we touch anything." },
              { title: "Full-Service Shop", text: "Tires, brakes, check-engine light, emissions, oil changes, suspension, steering, exhaust — one shop for everything." },
              { title: "Since 2018", text: `${new Date().getFullYear() - 2018} years of serving East Cleveland with zero corporate pressure. We answer to our customers, not shareholders.` },
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

      {/* What we DON'T do — anti-promise trust device.
          2026-05-05 brand-voice pass: most powerful trust copy a shop can
          write is what they refuse to do. Each line is a real policy,
          stated in plain language. */}
      <section className="py-24 lg:py-32">
        <div className="container max-w-3xl">
          <FadeIn>
            <div className="text-center mb-12">
              <div className="text-xs uppercase tracking-[0.2em] text-primary font-bold mb-2">Anti-promises</div>
              <h2 className="text-3xl lg:text-5xl font-bold text-foreground tracking-tight uppercase leading-[1.05]">
                What we <span className="text-primary">won't</span> do.
              </h2>
              <p className="text-foreground/55 text-base mt-4">
                Most shops talk about what they do. The shortcut to standing out is naming what we refuse to.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={0.1}>
            <ul className="space-y-4 text-base lg:text-lg">
              {[
                "Replace brake pads that pass inspection.",
                "Quote a fix without showing you the broken part.",
                "Book a service we can't do that day unless we tell you up front.",
                "Sell you new tires when used tires would last another year.",
                "Add a fee at pickup that wasn't on the written estimate.",
                "Pretend a noise is fine when we can hear it from the parking lot.",
              ].map((line, i) => (
                <li key={i} className="flex items-start gap-3 p-4 border border-border/40 rounded-lg bg-card/30">
                  <span className="text-primary font-bold text-lg leading-none mt-0.5 shrink-0">·</span>
                  <span className="text-foreground/80 leading-relaxed">{line}</span>
                </li>
              ))}
            </ul>
            <p className="text-center text-foreground/50 text-sm mt-8 italic">
              If we ever do, call us out. We'll fix it.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Reciprocity — "What you get for free" */}
      <section className="bg-[oklch(0.065_0.004_260)] py-20 lg:py-24">
        <div className="container max-w-6xl">
          <FadeIn>
            <div className="text-center mb-10">
              <div className="text-xs uppercase tracking-[0.2em] text-primary font-bold mb-2">No-charge, no-catch</div>
              <h2 className="text-3xl lg:text-5xl font-bold text-foreground tracking-tight uppercase">
                Six things we give you free
                <span className="block text-primary">that other shops charge for.</span>
              </h2>
              <p className="text-foreground/55 text-base mt-4 max-w-2xl mx-auto">
                These aren't promotions. They're built into how the shop runs. We'd rather earn your repair than nickel-and-dime the inspection.
              </p>
            </div>
          </FadeIn>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                icon: <FileCheck className="w-6 h-6" />,
                title: "Multi-point inspection",
                sub: "27 checkpoints — brakes, fluids, belts, suspension, lights, tires. Every visit, free.",
                anchor: "Most shops: $59–$99",
              },
              {
                icon: <Camera className="w-6 h-6" />,
                title: "Photo documentation",
                sub: "We take pictures of any worn part before we replace it. You see what we saw.",
                anchor: "Most shops: 'trust us'",
              },
              {
                icon: <Wrench className="w-6 h-6" />,
                title: "OBD-II code scan",
                sub: "Check engine light? Free scan, on the spot. Print-out included.",
                anchor: "AutoZone equivalent: $0; dealer: $89–$150",
              },
              {
                icon: <Car className="w-6 h-6" />,
                title: "Free Uber within 5 miles",
                sub: "Drop off the car, take a free Uber home. We'll pick you up the same way when it's done.",
                anchor: "Most shops: shuttle by appointment, or none",
              },
              {
                icon: <ShieldCheck className="w-6 h-6" />,
                title: "Written estimate before any work",
                // wave-181.44 · replaced "without your approval" (formal,
                // procedural) with the relief haiku ("you don't pay until
                // you say yes") — same phrase Brian uses on every VAPI
                // repair call. Cross-touchpoint consistency per
                // brand-perception step 5.
                sub: "Every repair over $100 — full written estimate, line-by-line. You don't pay until you say yes.",
                anchor: "Industry standard: verbal-only, sometimes",
              },
              {
                icon: <Star className="w-6 h-6" />,
                title: "12-month warranty in writing",
                sub: "12-month parts / 90-day labor. If a fix doesn't take, we redo it free.",
                anchor: "Chain warranties: 90 days typical",
              },
            ].map((item, i) => (
              <FadeIn key={item.title} delay={i * 0.06}>
                <div className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-6 h-full hover:border-primary/30 transition-colors">
                  <div className="w-11 h-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
                    {item.icon}
                  </div>
                  <h3 className="font-heading font-bold text-foreground text-lg uppercase tracking-wide mb-2">{item.title}</h3>
                  <p className="text-foreground/60 text-sm leading-relaxed mb-3">{item.sub}</p>
                  <div className="text-[11px] uppercase tracking-wider text-foreground/35 font-semibold border-t border-white/5 pt-3">
                    {item.anchor}
                  </div>
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
                <p className="text-foreground/60 text-sm">Need tires or major repairs but can't pay all at once? Lease-to-own and payment programs on the spot — $10 down, four providers, no credit check. We'll walk you through it.</p>
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

      {/* Written guarantees — formalized commitments */}
      <section className="bg-[oklch(0.065_0.004_260)] py-20 lg:py-24">
        <div className="container max-w-4xl">
          <FadeIn>
            <div className="text-center mb-10">
              <div className="text-xs uppercase tracking-[0.2em] text-primary font-bold mb-2">In writing, on every receipt</div>
              <h2 className="text-3xl lg:text-4xl font-bold text-foreground tracking-tight uppercase">
                Four guarantees we put in print.
              </h2>
            </div>
          </FadeIn>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              {
                num: "01",
                title: "12-month parts / 90-day labor warranty",
                sub: "Failed part or improper repair? Bring it back, no charge — full re-do, including labor.",
              },
              {
                num: "02",
                title: "Quoted price = paid price",
                sub: "If the written estimate is $440, the bill is $440. If we find something extra, we stop and call you with the new number — no surprise add-ons at pickup.",
              },
              {
                num: "03",
                title: "We don't replace what isn't broken",
                sub: "We test before we replace. If the part on your car still works, we say so — even when replacing it would make us money.",
              },
              {
                num: "04",
                title: "If we can't fix it, you don't pay",
                sub: "If we mis-diagnose and the issue isn't resolved, the diagnostic and repair are free. We eat the cost — it's our problem, not yours.",
              },
            ].map((item) => (
              <FadeIn key={item.num}>
                <div className="bg-[#141414] border border-primary/20 rounded-xl p-5 h-full">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-heading text-xl font-bold text-primary">{item.num}</span>
                    <h3 className="font-semibold text-foreground text-sm leading-snug">{item.title}</h3>
                  </div>
                  <p className="text-foreground/60 text-sm leading-relaxed">{item.sub}</p>
                </div>
              </FadeIn>
            ))}
          </div>
          <FadeIn delay={0.3}>
            <p className="text-center text-foreground/40 text-xs mt-8 italic max-w-xl mx-auto">
              Every receipt has these printed on the back. Not because the law makes us — because we want you holding us to them.
            </p>
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
            <p className="mt-4 text-foreground/40 text-lg max-w-md mx-auto">Call us, drop off online, or just pull up. Walk-ins welcome — first-come, first-served.</p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick("about-cta")} className="inline-flex items-center justify-center gap-2 bg-foreground text-background px-8 py-3.5 rounded-full font-medium hover:bg-foreground/90 transition-colors">
                <Phone className="w-4 h-4" />
                Call {BUSINESS.phone.display}
              </a>
              <Link href="/contact" className="inline-flex items-center justify-center gap-2 border border-foreground/30 text-foreground px-8 py-3.5 rounded-full font-medium hover:bg-foreground/5 transition-colors">
                Schedule Drop-Off
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>
      <InternalLinks title="Explore Our Services" />
    </PageLayout>
  );
}