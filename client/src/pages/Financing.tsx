import PageLayout from "@/components/PageLayout";
import { SEOHead } from "@/components/SEO";
import InternalLinks from "@/components/InternalLinks";
import {
  DollarSign, Phone, CheckCircle, CreditCard, Clock, Shield,
  ChevronRight, AlertCircle, Calculator,
} from "lucide-react";

const FINANCING_OPTIONS = [
  {
    title: "SYNCHRONY CAR CARE",
    type: "Credit Card",
    highlight: "6 months no interest on purchases of $199+",
    features: [
      "No annual fee",
      "Accepted at thousands of auto repair shops nationwide",
      "Special financing on qualifying purchases",
      "Easy online account management",
    ],
    applyUrl: "https://www.mysynchrony.com/car-care",
  },
  {
    title: "SUNBIT",
    type: "Buy Now, Pay Later",
    highlight: "Split your repair into easy monthly payments",
    features: [
      "Approvals for most credit types",
      "30-second application at the counter",
      "No hard credit check to see options",
      "Payments up to 72 months",
    ],
    applyUrl: "https://sunbit.com",
  },
];

const PAYMENT_METHODS = [
  "Cash",
  "Visa / Mastercard / Discover / Amex",
  "Debit Cards",
  "Apple Pay / Google Pay",
  "Synchrony Car Care Card",
  "Sunbit Payment Plans",
];

export default function Financing() {
  return (
    <PageLayout activeHref="/financing">
      <SEOHead
        title="Financing & Payment Options | Nick's Tire & Auto — Cleveland, OH"
        description="Affordable auto repair financing in Cleveland. No-interest payment plans, buy now pay later options, and multiple payment methods. Don't delay repairs because of cost."
        canonicalPath="/financing"
      />

      {/* Hero */}
      <section className="section-dark pt-28 pb-16 lg:pt-36 lg:pb-20">
        <div className="container max-w-4xl text-center">
          <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">Payment Options</span>
          <h1 className="font-heading font-bold text-4xl lg:text-6xl text-foreground mt-3 tracking-tight">
            AFFORDABLE <span className="text-gradient-yellow">REPAIRS</span>
          </h1>
          <p className="mt-4 text-foreground/70 text-lg max-w-2xl mx-auto">
            Do not delay repairs because of cost. We offer flexible financing options so you can get your vehicle fixed today and pay over time.
          </p>
        </div>
      </section>

      {/* Financing Options */}
      <section className="section-darker py-16 lg:py-20">
        <div className="container max-w-4xl">
          <div className="text-center mb-12">
            <h2 className="font-heading font-bold text-3xl text-foreground tracking-tight">
              FINANCING OPTIONS
            </h2>
            <p className="text-foreground/60 mt-3">Apply in-store or online. Get approved in minutes.</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {FINANCING_OPTIONS.map((opt) => (
              <div key={opt.title} className="card-vibrant bg-card/80 rounded-lg p-6 lg:p-8 flex flex-col">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-md bg-nick-yellow/10 flex items-center justify-center text-nick-yellow">
                    <CreditCard className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-heading font-bold text-foreground tracking-wider text-sm">{opt.title}</h3>
                    <span className="font-mono text-xs text-foreground/40">{opt.type}</span>
                  </div>
                </div>

                <div className="bg-nick-yellow/10 border border-nick-yellow/20 rounded-md p-3 mb-5">
                  <p className="font-heading font-bold text-nick-yellow text-sm text-center">{opt.highlight}</p>
                </div>

                <ul className="space-y-2.5 mb-6 flex-1">
                  {opt.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-foreground/70">
                      <CheckCircle className="w-4 h-4 text-nick-teal shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>

                <a
                  href={opt.applyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark px-6 py-3 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors"
                >
                  LEARN MORE
                  <ChevronRight className="w-4 h-4" />
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="section-dark py-16 lg:py-20">
        <div className="container max-w-3xl">
          <h2 className="font-heading font-bold text-2xl lg:text-3xl text-foreground tracking-tight text-center mb-10">
            HOW IT WORKS
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              { num: "01", icon: <Calculator className="w-6 h-6" />, title: "Get Your Estimate", desc: "We diagnose the issue and give you a clear repair estimate with no hidden fees." },
              { num: "02", icon: <CreditCard className="w-6 h-6" />, title: "Choose Your Plan", desc: "Apply for financing right at the counter. Most approvals take under 60 seconds." },
              { num: "03", icon: <CheckCircle className="w-6 h-6" />, title: "Drive Away Today", desc: "We complete the repair and you pay over time with manageable monthly payments." },
            ].map((step) => (
              <div key={step.num} className="text-center">
                <span className="font-heading font-bold text-4xl text-border/40">{step.num}</span>
                <div className="w-12 h-12 mx-auto mt-3 mb-3 rounded-full bg-nick-yellow/10 flex items-center justify-center text-nick-yellow">
                  {step.icon}
                </div>
                <h3 className="font-heading font-bold text-foreground tracking-wider text-sm mb-2">{step.title}</h3>
                <p className="text-foreground/60 text-sm">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Payment Methods */}
      <section className="section-darker py-16 lg:py-20">
        <div className="container max-w-3xl">
          <h2 className="font-heading font-bold text-2xl text-foreground tracking-tight text-center mb-8">
            ACCEPTED PAYMENT METHODS
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {PAYMENT_METHODS.map((m) => (
              <div key={m} className="flex items-center gap-2 bg-card/50 border border-border/20 rounded-md px-4 py-3">
                <DollarSign className="w-4 h-4 text-nick-teal shrink-0" />
                <span className="font-mono text-sm text-foreground/70">{m}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Important Note */}
      <section className="section-dark py-12 lg:py-16">
        <div className="container max-w-3xl">
          <div className="flex items-start gap-4 bg-nick-yellow/5 border border-nick-yellow/20 rounded-md p-5">
            <AlertCircle className="w-6 h-6 text-nick-yellow shrink-0 mt-0.5" />
            <div>
              <h3 className="font-heading font-bold text-foreground text-sm tracking-wider mb-2">DO NOT DELAY SAFETY REPAIRS</h3>
              <p className="text-foreground/70 text-sm leading-relaxed">
                Brakes, tires, and suspension problems get worse and more expensive over time. If cost is a concern, talk to us about financing before you leave. We would rather help you pay over time than have you driving with a safety issue.
              </p>
            </div>
          </div>

          <div className="mt-8 text-center">
            <a
              href="tel:2168620005"
              className="inline-flex items-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors"
            >
              <Phone className="w-4 h-4" />
              CALL TO DISCUSS OPTIONS — (216) 862-0005
            </a>
          </div>
        </div>
      </section>
      <InternalLinks title="Related Services" />
    </PageLayout>
  );
}
