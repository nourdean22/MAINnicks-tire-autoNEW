import { useState } from "react";
import PageLayout from "@/components/PageLayout";
import InternalLinks from "@/components/InternalLinks";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import {
  Truck, Phone, CheckCircle, Clock, DollarSign, FileText,
  Wrench, Shield, ChevronRight, Users, CalendarClock,
  Headset, CreditCard, BarChart3, BadgePercent, Siren,
  Car, Bus, Forklift,
} from "lucide-react";
import { toast } from "sonner";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FinancingCTA from "@/components/FinancingCTA";

/* ─── KEY BENEFITS ──────────────────────────────────────── */
const BENEFITS = [
  {
    icon: <CalendarClock className="w-7 h-7" />,
    title: "Priority Scheduling",
    desc: "Fleet vehicles jump the queue. Same-day or next-day turnaround on most repairs so your trucks stay on the road.",
  },
  {
    icon: <Headset className="w-7 h-7" />,
    title: "Dedicated Account Manager",
    desc: "One point of contact who knows your fleet inside and out. No runaround, no repeating yourself.",
  },
  {
    icon: <CreditCard className="w-7 h-7" />,
    title: "Net-30 Terms",
    desc: "Approved accounts pay on invoice — no payment at time of service. Simplified billing for your accounting team.",
  },
  {
    icon: <BarChart3 className="w-7 h-7" />,
    title: "Monthly Reporting",
    desc: "Per-vehicle cost tracking, service history, and maintenance forecasting delivered to your inbox every month.",
  },
  {
    icon: <BadgePercent className="w-7 h-7" />,
    title: "Employee Discounts",
    desc: "Your team members receive exclusive personal-vehicle discounts as a perk of your fleet partnership.",
  },
  {
    icon: <Siren className="w-7 h-7" />,
    title: "Emergency Service",
    desc: "Breakdowns don't wait. Fleet partners get priority emergency scheduling and after-hours pickup options.",
  },
];

/* ─── VEHICLE TYPES ─────────────────────────────────────── */
const VEHICLE_TYPES = [
  { icon: <Car className="w-5 h-5" />, label: "Sedans & Coupes" },
  { icon: <Truck className="w-5 h-5" />, label: "Pickup Trucks" },
  { icon: <Truck className="w-5 h-5" />, label: "Cargo & Sprinter Vans" },
  { icon: <Bus className="w-5 h-5" />, label: "Box Trucks & Shuttles" },
  { icon: <Car className="w-5 h-5" />, label: "SUVs & Crossovers" },
  { icon: <Forklift className="w-5 h-5" />, label: "Light Commercial Vehicles" },
];

/* ─── ROI CALCULATOR ────────────────────────────────────── */
function ROICalculator() {
  const [fleetSize, setFleetSize] = useState<number | "">(5);
  const annualSavings = typeof fleetSize === "number" && fleetSize > 0 ? fleetSize * 1200 : 0;

  return (
    <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-6 lg:p-8">
      <h3 className="font-heading text-2xl font-bold text-white uppercase tracking-wide mb-2">
        Estimate Your Savings
      </h3>
      <p className="text-foreground/60 text-sm mb-6">
        Fleet accounts save 10-20% on labor. Enter your fleet size to see estimated annual savings.
      </p>

      <label className="text-xs text-foreground/50 uppercase tracking-wider block mb-2">
        Number of Vehicles
      </label>
      <input
        type="number"
        min={1}
        max={500}
        value={fleetSize}
        onChange={(e) => {
          const v = e.target.value;
          setFleetSize(v === "" ? "" : Math.max(1, parseInt(v) || 1));
        }}
        className="w-full max-w-[200px] bg-background/60 border border-[#2A2A2A] rounded-md text-foreground px-4 py-3 text-lg focus:border-primary focus:ring-1 focus:ring-primary/30 focus:outline-none"
      />

      <div className="mt-6 flex items-end gap-2">
        <span className="font-heading text-4xl lg:text-5xl font-bold text-primary">
          ${annualSavings.toLocaleString()}
        </span>
        <span className="text-foreground/50 text-sm pb-1">estimated annual savings</span>
      </div>
      <p className="text-foreground/40 text-xs mt-2 italic">
        Based on an average of $1,200/year savings per vehicle through volume pricing, priority scheduling, and preventive maintenance programs.
      </p>
    </div>
  );
}

/* ─── MAIN PAGE ─────────────────────────────────────────── */
export default function Fleet() {
  const [form, setForm] = useState({
    contactName: "",
    companyName: "",
    phone: "",
    email: "",
    fleetSize: "",
    message: "",
  });
  const [submitted, setSubmitted] = useState(false);

  const submitLead = trpc.lead.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      toast.success("Request received! We'll contact you within 1 business day.");
    },
    onError: () => {
      toast.error(`Something went wrong. Please call us at ${BUSINESS.phone.display}.`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitLead.mutate({
      name: form.contactName,
      phone: form.phone,
      email: form.email || undefined,
      source: "fleet",
      companyName: form.companyName,
      fleetSize: form.fleetSize ? parseInt(form.fleetSize) || undefined : undefined,
      problem: `Fleet Account Inquiry — Company: ${form.companyName}, Fleet Size: ${form.fleetSize}. ${form.message}`,
    });
  };

  const inputClass =
    "w-full bg-background/60 border border-[#2A2A2A] rounded-md text-foreground px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary/30 focus:outline-none";

  return (
    <PageLayout activeHref="/fleet">
      <SEOHead
        title="Fleet Services | Nick's Tire & Auto Cleveland"
        description="Fleet maintenance and commercial vehicle service in Cleveland. Priority scheduling, volume pricing, net-30 billing, and detailed reporting for businesses."
        canonicalPath="/fleet"
      />
      <Breadcrumbs items={[{ label: "Fleet & Commercial", href: "/fleet" }]} />
      <LocalBusinessSchema />

      {/* ── HERO ─────────────────────────────────────────── */}
      <section className="bg-[#0A0A0A] pt-28 pb-16 lg:pt-36 lg:pb-20">
        <div className="container max-w-5xl">
          <div className="text-center">
            <span className="inline-block bg-primary/10 text-primary text-xs font-bold tracking-widest uppercase px-4 py-1.5 rounded-full mb-6">
              Commercial Services
            </span>
            <h1 className="font-heading font-bold text-4xl lg:text-6xl text-white uppercase tracking-tight leading-[1.05]">
              Fleet Maintenance That Keeps{" "}
              <span className="text-primary">Cleveland Businesses</span> Moving
            </h1>
            <p className="mt-5 text-foreground/70 text-lg max-w-2xl mx-auto">
              Priority service, volume pricing, and dedicated account management for fleets of every size. Keep your vehicles on the road and your costs predictable.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="#fleet-form"
                className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-bold text-sm tracking-wide hover:opacity-90 transition-colors"
              >
                REQUEST FLEET ACCOUNT
                <ChevronRight className="w-4 h-4" />
              </a>
              <a
                href={BUSINESS.phone.href}
                className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 rounded-md font-bold text-sm tracking-wide hover:border-primary hover:text-primary transition-colors"
              >
                <Phone className="w-4 h-4" />
                CALL {BUSINESS.phone.display}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── KEY BENEFITS GRID (2x3) ─────────────────────── */}
      <section className="bg-[#0D0D0D] py-16 lg:py-20">
        <div className="container max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="font-heading font-bold text-3xl lg:text-4xl text-white uppercase tracking-tight">
              Why Cleveland Businesses Choose Us
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {BENEFITS.map((b) => (
              <div
                key={b.title}
                className="bg-[#141414] border border-[#2A2A2A] rounded-lg p-6 hover:border-primary/40 transition-colors"
              >
                <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center text-primary mb-4">
                  {b.icon}
                </div>
                <h3 className="font-heading font-bold text-white uppercase tracking-wider text-sm mb-2">
                  {b.title}
                </h3>
                <p className="text-foreground/60 text-sm leading-relaxed">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FLEET PRICING + ROI CALCULATOR ──────────────── */}
      <section className="bg-[#0A0A0A] py-16 lg:py-20">
        <div className="container max-w-5xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            {/* Pricing info */}
            <div>
              <h2 className="font-heading font-bold text-3xl lg:text-4xl text-white uppercase tracking-tight mb-4">
                Fleet-Specific Pricing
              </h2>
              <p className="text-foreground/70 leading-relaxed mb-6">
                Fleet accounts save <span className="text-primary font-bold">10-20% on labor</span> compared to retail pricing. The more vehicles you bring, the more you save. Volume tire pricing, preventive maintenance packages, and consolidated billing keep your costs predictable.
              </p>
              <ul className="space-y-3">
                {[
                  "Volume discounts on tires and parts",
                  "Flat-rate preventive maintenance packages",
                  "No diagnostic fees for fleet vehicles",
                  "Free loaner coordination for extended repairs",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-foreground/70 text-sm">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* ROI Calculator */}
            <ROICalculator />
          </div>
        </div>
      </section>

      {/* ── VEHICLE TYPES WE SERVICE ────────────────────── */}
      <section className="bg-[#0D0D0D] py-16 lg:py-20">
        <div className="container max-w-4xl">
          <div className="text-center mb-10">
            <h2 className="font-heading font-bold text-2xl lg:text-3xl text-white uppercase tracking-tight">
              All Vehicle Types Serviced
            </h2>
            <p className="text-foreground/60 mt-3">From compact sedans to box trucks — we handle it all.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {VEHICLE_TYPES.map((v) => (
              <div
                key={v.label}
                className="flex items-center gap-3 bg-[#141414] border border-[#2A2A2A] rounded-lg px-4 py-3.5"
              >
                <div className="text-primary shrink-0">{v.icon}</div>
                <span className="text-sm text-foreground/80">{v.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FLEET INQUIRY FORM ──────────────────────────── */}
      <section id="fleet-form" className="bg-[#0A0A0A] py-16 lg:py-20">
        <div className="container max-w-2xl">
          <div className="text-center mb-10">
            <h2 className="font-heading font-bold text-3xl text-white uppercase tracking-tight">
              Request a Fleet Account
            </h2>
            <p className="text-foreground/60 mt-3">
              Fill out the form below and we will contact you within 1 business day.
            </p>
          </div>

          {submitted ? (
            <div className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-8 text-center">
              <CheckCircle className="w-16 h-16 text-primary mx-auto mb-4" />
              <h3 className="font-heading font-bold text-2xl text-white uppercase mb-2">
                Request Received
              </h3>
              <p className="text-foreground/60 max-w-md mx-auto">
                We will review your fleet information and contact you within 1 business day. For
                immediate assistance, call{" "}
                <a href={BUSINESS.phone.href} className="text-primary hover:underline">
                  {BUSINESS.phone.display}
                </a>
                .
              </p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-6 lg:p-8 space-y-5"
            >
              {/* Name + Company */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-foreground/50 uppercase tracking-wider block mb-1.5">
                    Name *
                  </label>
                  <input
                    required
                    type="text"
                    value={form.contactName}
                    onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-foreground/50 uppercase tracking-wider block mb-1.5">
                    Company *
                  </label>
                  <input
                    required
                    type="text"
                    value={form.companyName}
                    onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Phone + Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-foreground/50 uppercase tracking-wider block mb-1.5">
                    Phone *
                  </label>
                  <input
                    required
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-foreground/50 uppercase tracking-wider block mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Fleet Size */}
              <div>
                <label className="text-xs text-foreground/50 uppercase tracking-wider block mb-1.5">
                  Fleet Size *
                </label>
                <input
                  required
                  type="number"
                  min={1}
                  placeholder="Number of vehicles"
                  value={form.fleetSize}
                  onChange={(e) => setForm({ ...form, fleetSize: e.target.value })}
                  className={inputClass + " max-w-[200px]"}
                />
              </div>

              {/* Message */}
              <div>
                <label className="text-xs text-foreground/50 uppercase tracking-wider block mb-1.5">
                  Message
                </label>
                <textarea
                  rows={3}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  placeholder="Tell us about your fleet needs..."
                  className={inputClass + " resize-none"}
                />
              </div>

              <button
                type="submit"
                disabled={submitLead.isPending}
                className="w-full bg-primary text-primary-foreground py-4 rounded-md font-bold text-sm tracking-wide hover:opacity-90 transition-colors disabled:opacity-50"
              >
                {submitLead.isPending ? "SUBMITTING..." : "SUBMIT FLEET REQUEST"}
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="container pb-12">
        <FinancingCTA variant="banner" />
      </section>
      <InternalLinks title="Our Services" />
    </PageLayout>
  );
}
