/**
 * Standalone FAQ page for Nick's Tire & Auto
 * Aggregates common questions across all services with FAQPage schema
 */

import InternalLinks from "@/components/InternalLinks";
import PageLayout from "@/components/PageLayout";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { Phone, ChevronDown } from "lucide-react";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { BUSINESS } from "@shared/business";

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

interface FAQItem {
  question: string;
  answer: string;
  category: string;
}

const FAQ_DATA: FAQItem[] = [
  // General
  {
    category: "General",
    question: "Where is Nick's Tire & Auto located?",
    answer: `We are located at ${BUSINESS.address.full}. We serve Cleveland, Euclid, Lakewood, Parma, East Cleveland, and surrounding Northeast Ohio communities.`
  },
  {
    category: "General",
    question: "What are your hours of operation?",
    answer: "We are open Monday through Saturday from 8:00 AM to 6:00 PM, and Sunday from 9:00 AM to 4:00 PM. Walk-ins are welcome, but appointments are recommended for faster service."
  },
  {
    category: "General",
    question: "Do I need an appointment?",
    answer: `Walk-ins are always welcome. However, scheduling an appointment ensures we can get you in faster and have the right parts ready. You can book online through our website or call us at ${BUSINESS.phone.display}.`
  },
  {
    category: "General",
    question: "What forms of payment do you accept?",
    answer: "We accept cash, all major credit and debit cards, and most fleet cards. We want to make payment as convenient as possible for our customers."
  },
  // Diagnostics
  {
    category: "Diagnostics",
    question: "My check engine light is on. What should I do?",
    answer: "A check engine light can indicate anything from a loose gas cap to a serious engine problem. We recommend bringing your vehicle in for a diagnostic scan. Our technicians use advanced OBD-II equipment to read the exact trouble codes and pinpoint the issue, so you only pay for what actually needs to be fixed."
  },
  {
    category: "Diagnostics",
    question: "How much does a diagnostic scan cost?",
    answer: `Our diagnostic service is competitively priced and includes a full scan of your vehicle's computer system, code interpretation, and a clear explanation of what the codes mean and what repairs are needed. Call us at ${BUSINESS.phone.display} for current pricing.`
  },
  // Emissions
  {
    category: "Emissions & E-Check",
    question: "I failed my Ohio E-Check. Can you help?",
    answer: "Yes. E-Check failures are one of our specialties. Common causes include faulty oxygen sensors, EVAP system leaks, catalytic converter problems, and incomplete drive cycle monitors. We diagnose the exact cause, make the repair, and ensure all emissions monitors complete so your vehicle can pass reinspection."
  },
  {
    category: "Emissions & E-Check",
    question: "How long does an emissions repair take?",
    answer: "Most emissions repairs can be completed in one to two days, depending on the specific issue and parts availability. Simple fixes like replacing an oxygen sensor can often be done same-day. We will give you an accurate timeline after diagnosing the problem."
  },
  // Brakes
  {
    category: "Brakes",
    question: "How do I know if my brakes need to be replaced?",
    answer: "Common signs include squealing or grinding noises when braking, a soft or spongy brake pedal, the vehicle pulling to one side during braking, or a vibrating steering wheel. If you notice any of these symptoms, we recommend having your brakes inspected promptly for your safety."
  },
  {
    category: "Brakes",
    question: "Do you show me the brake problem before doing the repair?",
    answer: "Absolutely. We walk every customer through the diagnosis. We show you the worn parts, explain what needs to be replaced and why, and give you a clear estimate before any work begins. No surprises."
  },
  // Tires
  {
    category: "Tires",
    question: "Do you sell new and used tires?",
    answer: "Yes. We carry a full selection of new tires from major brands at competitive prices, and we also have quality used tires for budget-conscious drivers. All tires include professional mounting and balancing."
  },
  {
    category: "Tires",
    question: "How often should I rotate my tires?",
    answer: "We recommend rotating your tires every 5,000 to 7,500 miles, or roughly every other oil change. Regular rotation promotes even tread wear and extends the life of your tires, saving you money in the long run."
  },
  // Oil Change
  {
    category: "Oil Change",
    question: "How often do I need an oil change?",
    answer: "For most modern vehicles, we recommend an oil change every 5,000 miles for conventional oil or every 7,500 to 10,000 miles for full synthetic oil. Check your owner's manual for your specific vehicle's recommendation, or ask our technicians."
  },
  // Pricing
  {
    category: "Pricing & Warranty",
    question: "Do you provide written estimates before starting work?",
    answer: "Yes. We always provide a clear, written estimate before beginning any repair. If we discover additional issues during the repair, we will contact you and get your approval before proceeding. The price we quote is the price you pay."
  },
  {
    category: "Pricing & Warranty",
    question: "Do you offer any warranty on repairs?",
    answer: "Yes. We stand behind our work with a warranty on parts and labor. The specific warranty terms depend on the type of repair and parts used. Ask your service advisor for details on the warranty coverage for your specific repair."
  },
  // Problem-specific questions
  {
    category: "Common Problems",
    question: "My car is shaking while driving. What could be wrong?",
    answer: "Car shaking can be caused by unbalanced tires, worn brake rotors, bad wheel bearings, worn CV joints, or engine misfires. The cause depends on when the shaking occurs — at highway speeds, during braking, or at idle. We diagnose the exact cause so you only pay for what needs to be fixed. Visit our car shaking while driving page for more details."
  },
  {
    category: "Common Problems",
    question: "My brakes are making a grinding noise. Is it safe to drive?",
    answer: "Grinding brakes usually mean the brake pads are completely worn through and the metal backing plate is grinding against the rotor. This is a safety issue. Continued driving can damage the rotors and calipers, increasing the repair cost significantly. We recommend getting this checked immediately. Learn more on our brakes grinding page."
  },
  {
    category: "Common Problems",
    question: "My check engine light is flashing. What should I do?",
    answer: "A flashing check engine light indicates an active engine misfire that can damage your catalytic converter. You should reduce speed, avoid hard acceleration, and get to a shop as soon as possible. A steady check engine light is less urgent but should still be diagnosed promptly. See our check engine light flashing page for more information."
  },
  {
    category: "Common Problems",
    question: "My car is overheating. What causes this?",
    answer: "Common causes include a failing thermostat, coolant leak, bad water pump, clogged radiator, or a blown head gasket. If your temperature gauge is in the red, pull over safely and turn off the engine. Do not open the radiator cap when hot. Call us and we will help you figure out the next step. Read more on our car overheating page."
  },
  // Vehicle-specific questions
  {
    category: "Vehicle Makes",
    question: "Do you work on Toyota vehicles?",
    answer: "Yes. We service all Toyota models including Camry, Corolla, RAV4, Highlander, Tacoma, and Tundra. We are experienced with common Toyota issues like water pump failures on V6 engines, brake actuator problems on certain Prius models, and suspension wear on Tacomas. Visit our Toyota repair Cleveland page for details."
  },
  {
    category: "Vehicle Makes",
    question: "Do you service Honda cars?",
    answer: "Yes. We work on all Honda models including Civic, Accord, CR-V, Pilot, and Odyssey. We are familiar with common Honda issues like VTC actuator noise on newer engines, AC compressor failures, and transmission concerns on certain model years. See our Honda repair Cleveland page for more information."
  },
  {
    category: "Vehicle Makes",
    question: "Can you repair Ford trucks and cars?",
    answer: "Yes. We service all Ford vehicles including F-150, Explorer, Escape, Focus, and Fusion. We handle common Ford issues like cam phaser problems on 5.4L and 3.5L EcoBoost engines, transmission shudder on certain models, and blend door actuator failures. Check our Ford repair Cleveland page for details."
  },
  {
    category: "Vehicle Makes",
    question: "Do you work on Chevy and GM vehicles?",
    answer: "Yes. We service all Chevrolet and GM models including Silverado, Equinox, Malibu, Cruze, Traverse, and Tahoe. We are experienced with common GM issues like AFM lifter failures, transmission problems on 8-speed automatics, and electrical gremlins. Visit our Chevy repair Cleveland page for more information."
  },
  // Acima Lease-to-Own
  {
    category: "Pricing & Warranty",
    question: "What is Acima lease-to-own?",
    answer: "Acima is a rental purchase agreement — not a loan, credit, or financing. At Nick's Tire & Auto, you can lease the auto services you need with a $10 initial payment and no credit history required. A 90-day early purchase option is available to reduce your total cost. Not available in MN, NJ, WI, or WY."
  },
  {
    category: "Pricing & Warranty",
    question: "How does the $10 initial payment work?",
    answer: "Apply online or in-store in minutes. Once approved, make a $10 initial payment and get your service done the same day. You then pay the remainder over your lease term. $10 initial payment. Lease terms and total cost vary by item and payment schedule. 90-day early purchase option available. Not a loan or credit."
  },
  {
    category: "Pricing & Warranty",
    question: "Can I use Acima again after paying off my first lease?",
    answer: "Yes — returning customers often qualify for increased spending power. Individual results vary. Contact us or visit the financing page to apply."
  },
];

const CATEGORIES = ["All", ...Array.from(new Set(FAQ_DATA.map(f => f.category)))];

// ─── NAVBAR ───────────────────────────────────────────


// ─── FAQ ACCORDION ────────────────────────────────────
function FAQAccordion({ item, index }: { item: FAQItem; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <FadeIn delay={index * 0.03}>
      <div className="border border-border/50 rounded-lg overflow-hidden bg-card/30">
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between p-5 text-left hover:bg-card/50 transition-colors"
          aria-expanded={open}
        >
          <span className="font-semibold font-bold text-foreground text-sm sm:text-base tracking-wide pr-4">{item.question}</span>
          <ChevronDown className={`w-5 h-5 text-primary flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="px-5 pb-5 text-foreground/70 leading-relaxed text-sm border-t border-border/30 pt-4">
                {item.answer}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </FadeIn>
  );
}

// ─── FAQ SCHEMA ───────────────────────────────────────
function FAQSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_DATA.map(f => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: f.answer,
      },
    })),
  };

  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
  );
}

// ─── MAIN PAGE ────────────────────────────────────────
export default function FAQ() {
  const [activeCategory, setActiveCategory] = useState("All");

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const filtered = activeCategory === "All"
    ? FAQ_DATA
    : FAQ_DATA.filter(f => f.category === activeCategory);

  return (
    <PageLayout>
      <SEOHead
        title="Frequently Asked Questions | Nick's Tire & Auto Cleveland"
        description="Common questions about auto repair, brakes, tires, diagnostics, emissions, and oil changes answered by Nick's Tire & Auto in Cleveland, Ohio."
        canonicalPath="/faq"
      />
      <FAQSchema />
      
      
        {/* Hero */}
        <section className="pt-32 pb-12 lg:pt-40 lg:pb-16 bg-[oklch(0.065_0.004_260)]">
          <div className="container">
            <FadeIn>
              <Breadcrumbs items={[{ label: "FAQ" }]} />
            </FadeIn>
            <FadeIn delay={0.1}>
              <span className="font-mono text-nick-blue-light text-sm tracking-wide mt-4 block">Common Questions</span>
              <h1 className="font-semibold font-bold text-4xl sm:text-5xl lg:text-6xl text-foreground mt-3 tracking-tight leading-[0.95]">
                FREQUENTLY ASKED<br />
                <span className="text-primary">QUESTIONS</span>
              </h1>
              <p className="mt-6 text-lg text-foreground/70 max-w-2xl leading-relaxed">
                Find answers to common questions about our auto repair services, pricing, and what to expect when you visit Nick's Tire & Auto in Cleveland.
              </p>
            </FadeIn>
          </div>
        </section>

        {/* Category Filter */}
        <section className="py-8 bg-[oklch(0.055_0.004_260)] border-b border-border/50">
          <div className="container">
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-4 py-2 rounded-full font-semibold text-xs tracking-wide transition-colors ${
                    activeCategory === cat
                      ? "bg-primary text-primary-foreground"
                      : "bg-card/50 text-foreground/60 hover:text-primary border border-border/50"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ List */}
        <section className="py-12 lg:py-20 bg-[oklch(0.065_0.004_260)]">
          <div className="container max-w-3xl">
            <div className="flex flex-col gap-3">
              {filtered.map((item, i) => (
                <FAQAccordion key={item.question} item={item} index={i} />
              ))}
            </div>

            {/* CTA */}
            <FadeIn delay={0.2}>
              <div className="mt-12 text-center bg-card/30 border border-border/50 rounded-lg p-8">
                <h2 className="font-semibold font-bold text-2xl text-foreground tracking-tight mb-3">
                  STILL HAVE QUESTIONS?
                </h2>
                <p className="text-foreground/60 mb-6">
                  Our team is happy to help. Give us a call or stop by the shop.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('faq-cta')} className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors" aria-label="Call Nick's Tire and Auto at 216-862-0005">
                    <Phone className="w-4 h-4" />
                    CALL {BUSINESS.phone.display}
                  </a>
                  <Link href="/contact" className="inline-flex items-center justify-center gap-2 border-2 border-nick-blue/50 text-nick-blue-light px-8 py-4 rounded-md font-semibold font-bold text-sm tracking-wide hover:bg-nick-blue/10 hover:border-nick-blue transition-colors">
                    VISIT CONTACT PAGE
                  </Link>
                </div>
              </div>
            </FadeIn>
          </div>
        </section>


      {/* Footer */}
      
      <InternalLinks title="Related Pages" />
    </PageLayout>
  );
}
