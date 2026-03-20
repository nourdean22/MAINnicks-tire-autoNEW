import { useState } from "react";
import PageLayout from "@/components/PageLayout";
import InternalLinks from "@/components/InternalLinks";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import {
  Truck, Phone, CheckCircle, Clock, DollarSign, FileText,
  Wrench, Shield, ChevronRight, Building2,
} from "lucide-react";
import { toast } from "sonner";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";

const FLEET_SERVICES = [
  { icon: <Wrench className="w-6 h-6" />, title: "Preventive Maintenance", desc: "Scheduled oil changes, tire rotations, brake inspections, and fluid services to keep your fleet running." },
  { icon: <Truck className="w-6 h-6" />, title: "Tire Programs", desc: "Volume tire pricing, fleet-wide rotations, and TPMS management. We track tread depth and recommend replacements before failures." },
  { icon: <Shield className="w-6 h-6" />, title: "Priority Service", desc: "Fleet vehicles get priority scheduling. Minimize downtime with same-day or next-day turnaround on most repairs." },
  { icon: <FileText className="w-6 h-6" />, title: "Detailed Reporting", desc: "Per-vehicle service history, cost tracking, and maintenance forecasting. Know exactly where your money goes." },
  { icon: <DollarSign className="w-6 h-6" />, title: "Net-30 Billing", desc: "Approved fleet accounts receive net-30 invoicing. No payment at time of service. Simplified accounting." },
  { icon: <Clock className="w-6 h-6" />, title: "Extended Hours", desc: "Early drop-off and after-hours pickup available for fleet vehicles. We work around your schedule." },
];

const INDUSTRIES = [
  "Delivery & Courier Services",
  "Construction & Contractors",
  "Property Management",
  "Real Estate Agencies",
  "Landscaping & Lawn Care",
  "Plumbing & HVAC",
  "Electrical Contractors",
  "Food Service & Catering",
  "Rideshare & Taxi",
  "Non-Profit Organizations",
];

export default function Fleet() {
  const [form, setForm] = useState({
    companyName: "",
    contactName: "",
    phone: "",
    email: "",
    fleetSize: "",
    vehicleTypes: "",
    message: "",
  });
  const [submitted, setSubmitted] = useState(false);

  const submitLead = trpc.lead.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      toast.success("Request received! We'll contact you within 1 business day.");
    },
    onError: () => {
      toast.error("Something went wrong. Please call us at ${BUSINESS.phone.display}.");
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
      vehicleTypes: form.vehicleTypes || undefined,
      problem: `Fleet Account Inquiry — Fleet Size: ${form.fleetSize}, Vehicle Types: ${form.vehicleTypes}. ${form.message}`,
    });
  };

  return (
    <PageLayout activeHref="/fleet">
      <SEOHead
        title="Fleet Services | Nick's Tire & Auto Cleveland"
        description="Fleet maintenance and commercial vehicle service in Cleveland. Priority scheduling, volume pricing, net-30 billing, and detailed reporting for businesses."
        canonicalPath="/fleet"
      />
      <Breadcrumbs items={[{ label: "Fleet & Commercial", href: "/fleet" }]} />
      <LocalBusinessSchema />

      {/* Hero */}
      <section className="bg-[oklch(0.065_0.004_260)] pt-28 pb-16 lg:pt-36 lg:pb-20">
        <div className="container max-w-4xl">
          <div className="text-center">
            <span className="font-mono text-nick-teal text-sm tracking-wide">Commercial Services</span>
            <h1 className="font-bold text-4xl lg:text-6xl text-foreground mt-3 tracking-tight">
              FLEET & <span className="text-primary">BUSINESS</span> ACCOUNTS
            </h1>
            <p className="mt-4 text-foreground/70 text-lg max-w-2xl mx-auto">
              Keep your fleet on the road. Priority service, volume pricing, and dedicated account management for Cleveland businesses.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
              <a href="#fleet-form" className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-bold text-sm tracking-wide hover:opacity-90 transition-colors">
                REQUEST FLEET ACCOUNT
                <ChevronRight className="w-4 h-4" />
              </a>
              <a href={BUSINESS.phone.href} className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 rounded-md font-bold text-sm tracking-wide hover:border-primary hover:text-primary transition-colors">
                <Phone className="w-4 h-4" />
                CALL {BUSINESS.phone.display}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Services Grid */}
      <section className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-20">
        <div className="container max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="font-bold text-3xl lg:text-4xl text-foreground tracking-tight">
              FLEET SERVICES
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FLEET_SERVICES.map((s) => (
              <div key={s.title} className="bg-card/50 border border-border/30 rounded-lg p-6">
                <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center text-primary mb-4">
                  {s.icon}
                </div>
                <h3 className="font-bold text-foreground tracking-wider text-sm mb-2">{s.title}</h3>
                <p className="text-foreground/60 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Industries */}
      <section className="bg-[oklch(0.065_0.004_260)] py-16 lg:py-20">
        <div className="container max-w-4xl">
          <div className="text-center mb-10">
            <h2 className="font-bold text-2xl lg:text-3xl text-foreground tracking-tight">
              INDUSTRIES WE SERVE
            </h2>
            <p className="text-foreground/60 mt-3">From 3-vehicle operations to 50+ vehicle fleets.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {INDUSTRIES.map((ind) => (
              <div key={ind} className="flex items-center gap-2 bg-card/30 border border-border/20 rounded-md px-3 py-2.5">
                <Building2 className="w-3.5 h-3.5 text-nick-teal shrink-0" />
                <span className="text-[12px] text-foreground/70">{ind}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Form */}
      <section id="fleet-form" className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-20">
        <div className="container max-w-2xl">
          <div className="text-center mb-10">
            <h2 className="font-bold text-3xl text-foreground tracking-tight">
              REQUEST A FLEET ACCOUNT
            </h2>
            <p className="text-foreground/60 mt-3">Fill out the form below and we will contact you within 1 business day.</p>
          </div>

          {submitted ? (
            <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-8 text-center">
              <CheckCircle className="w-16 h-16 text-nick-teal mx-auto mb-4" />
              <h3 className="font-bold text-2xl text-foreground mb-2">Request Received</h3>
              <p className="text-foreground/60 max-w-md mx-auto">
                We will review your fleet information and contact you within 1 business day to discuss your account. For immediate assistance, call <a href={BUSINESS.phone.href} className="text-primary hover:underline">{BUSINESS.phone.display}</a>.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 lg:p-8 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[12px] text-foreground/50 uppercase tracking-wider block mb-1.5">Company Name *</label>
                  <input required type="text" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none" />
                </div>
                <div>
                  <label className="text-[12px] text-foreground/50 uppercase tracking-wider block mb-1.5">Contact Name *</label>
                  <input required type="text" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[12px] text-foreground/50 uppercase tracking-wider block mb-1.5">Phone *</label>
                  <input required type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none" />
                </div>
                <div>
                  <label className="text-[12px] text-foreground/50 uppercase tracking-wider block mb-1.5">Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[12px] text-foreground/50 uppercase tracking-wider block mb-1.5">Fleet Size *</label>
                  <select required value={form.fleetSize} onChange={(e) => setForm({ ...form, fleetSize: e.target.value })} className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none">
                    <option value="">Select...</option>
                    <option value="1-5">1–5 vehicles</option>
                    <option value="6-15">6–15 vehicles</option>
                    <option value="16-30">16–30 vehicles</option>
                    <option value="31-50">31–50 vehicles</option>
                    <option value="50+">50+ vehicles</option>
                  </select>
                </div>
                <div>
                  <label className="text-[12px] text-foreground/50 uppercase tracking-wider block mb-1.5">Vehicle Types</label>
                  <input type="text" placeholder="e.g. Vans, pickups, sedans" value={form.vehicleTypes} onChange={(e) => setForm({ ...form, vehicleTypes: e.target.value })} className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="text-[12px] text-foreground/50 uppercase tracking-wider block mb-1.5">Additional Details</label>
                <textarea rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Tell us about your fleet needs..." className="w-full bg-background/60 border border-border/50 rounded-md text-foreground px-4 py-3 text-[13px] focus:border-primary focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none resize-none" />
              </div>
              <button type="submit" disabled={submitLead.isPending} className="w-full bg-primary text-primary-foreground py-4 rounded-md font-bold text-sm tracking-wide hover:opacity-90 transition-colors disabled:opacity-50">
                {submitLead.isPending ? "SUBMITTING..." : "SUBMIT FLEET REQUEST"}
              </button>
            </form>
          )}
        </div>
      </section>
      <InternalLinks title="Our Services" />
    </PageLayout>
  );
}
