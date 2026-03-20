/**
 * AI Labor Estimator — detailed repair cost estimates powered by AI.
 * Customers enter Year/Make/Model + describe the repair.
 * AI generates a full breakdown: labor hours, parts, total cost range.
 * Feeds into lead capture for conversion.
 */
import { useState, useRef } from "react";
import PageLayout from "@/components/PageLayout";
import InternalLinks from "@/components/InternalLinks";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import {
  Calculator, Car, Wrench, Clock, Phone, ChevronRight, DollarSign,
  FileText, AlertTriangle, Loader2, RotateCcw, ArrowRight, Info,
} from "lucide-react";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import { motion, useInView } from "framer-motion";
import { Link } from "wouter";

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Common vehicle makes for quick selection
const POPULAR_MAKES = [
  "Toyota", "Honda", "Ford", "Chevrolet", "Nissan", "Hyundai",
  "Kia", "Jeep", "Dodge", "BMW", "Subaru", "Volkswagen",
];

// Common repair categories for quick selection
const COMMON_REPAIRS = [
  { label: "Brake Pads & Rotors", value: "Brake pads and rotors replacement" },
  { label: "Oil Change (Synthetic)", value: "Full synthetic oil change" },
  { label: "Check Engine Light Diagnosis", value: "Check engine light diagnostic and repair" },
  { label: "Struts / Shocks", value: "Struts or shocks replacement" },
  { label: "Tire Mount & Balance", value: "Tire mounting and balancing for 4 tires" },
  { label: "AC Repair", value: "AC system diagnosis and repair - not blowing cold" },
  { label: "Wheel Alignment", value: "Four-wheel alignment" },
  { label: "Alternator Replacement", value: "Alternator replacement" },
  { label: "Emissions / E-Check Repair", value: "Ohio E-Check emissions repair" },
  { label: "Wheel Bearing", value: "Wheel bearing replacement" },
  { label: "Tie Rod Ends", value: "Tie rod end replacement" },
  { label: "Water Pump", value: "Water pump replacement" },
];

// Generate year options (current year down to 1990)
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: currentYear - 1989 }, (_, i) => String(currentYear + 1 - i));

export default function LaborEstimator() {
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [mileage, setMileage] = useState("");
  const [repairDescription, setRepairDescription] = useState("");
  const [customRepair, setCustomRepair] = useState(false);

  const estimateMutation = trpc.laborEstimate.generate.useMutation();

  const canSubmit = year && make && model && repairDescription.trim().length >= 3;

  const handleSubmit = () => {
    if (!canSubmit) return;
    estimateMutation.mutate({
      year,
      make,
      model,
      mileage: mileage || undefined,
      repairDescription,
    });
  };

  const handleReset = () => {
    setYear("");
    setMake("");
    setModel("");
    setMileage("");
    setRepairDescription("");
    setCustomRepair(false);
    estimateMutation.reset();
  };

  const result = estimateMutation.data;

  return (
    <PageLayout activeHref="/estimate">
      <SEOHead
        title="AI Repair Estimator | Nick's Tire & Auto — Cleveland, OH"
        description="Get a detailed repair cost estimate for your vehicle. Enter your year, make, model, and repair needed. AI-powered labor and parts breakdown. Cleveland's trusted auto repair shop."
        canonicalPath="/estimate"
      />
      <Breadcrumbs items={[{ label: "Repair Estimator", href: "/estimate" }]} />
      <LocalBusinessSchema />

      {/* Hero */}
      <section className="section-dark pt-28 pb-16 lg:pt-36 lg:pb-20">
        <div className="container max-w-3xl text-center">
          <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">AI-Powered Estimates</span>
          <h1 className="font-heading font-bold text-4xl lg:text-5xl text-foreground mt-3 tracking-tight">
            REPAIR <span className="text-gradient-yellow">COST ESTIMATOR</span>
          </h1>
          <p className="mt-4 text-foreground/70 text-lg max-w-xl mx-auto">
            Enter your vehicle and repair details for a detailed cost breakdown. Labor hours, parts pricing, and total estimate — all transparent, no surprises.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 text-foreground/50 text-sm font-mono">
            <Calculator className="w-4 h-4 text-nick-teal" />
            <span>Fair pricing that keeps Cleveland drivers rolling</span>
          </div>
        </div>
      </section>

      {/* Estimator Form or Results */}
      <section className="section-darker py-12 lg:py-16">
        <div className="container max-w-3xl">
          {!result ? (
            <FadeIn>
              <div className="bg-card/80 border border-border/30 rounded-lg p-6 lg:p-8 space-y-8">
                {/* Step 1: Vehicle Info */}
                <div>
                  <label className="font-mono text-xs text-nick-teal/80 tracking-wider uppercase block mb-4">
                    1. Your Vehicle
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Year */}
                    <div>
                      <label className="text-foreground/50 text-xs font-mono block mb-1">Year</label>
                      <select
                        value={year}
                        onChange={(e) => setYear(e.target.value)}
                        className="w-full bg-background/60 border border-border/50 rounded-md px-3 py-3 text-foreground font-mono text-sm focus:border-nick-teal focus:ring-1 focus:ring-nick-teal/30 outline-none"
                      >
                        <option value="">Select Year</option>
                        {YEARS.map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>

                    {/* Make */}
                    <div>
                      <label className="text-foreground/50 text-xs font-mono block mb-1">Make</label>
                      <input
                        type="text"
                        value={make}
                        onChange={(e) => setMake(e.target.value)}
                        placeholder="e.g. Honda"
                        list="makes-list"
                        className="w-full bg-background/60 border border-border/50 rounded-md px-3 py-3 text-foreground font-mono text-sm focus:border-nick-teal focus:ring-1 focus:ring-nick-teal/30 outline-none placeholder:text-foreground/30"
                      />
                      <datalist id="makes-list">
                        {POPULAR_MAKES.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    </div>

                    {/* Model */}
                    <div>
                      <label className="text-foreground/50 text-xs font-mono block mb-1">Model</label>
                      <input
                        type="text"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder="e.g. Civic"
                        className="w-full bg-background/60 border border-border/50 rounded-md px-3 py-3 text-foreground font-mono text-sm focus:border-nick-teal focus:ring-1 focus:ring-nick-teal/30 outline-none placeholder:text-foreground/30"
                      />
                    </div>
                  </div>

                  {/* Mileage (optional) */}
                  <div className="mt-3">
                    <label className="text-foreground/50 text-xs font-mono block mb-1">Mileage (optional)</label>
                    <input
                      type="text"
                      value={mileage}
                      onChange={(e) => setMileage(e.target.value)}
                      placeholder="e.g. 85000"
                      className="w-full sm:w-48 bg-background/60 border border-border/50 rounded-md px-3 py-3 text-foreground font-mono text-sm focus:border-nick-teal focus:ring-1 focus:ring-nick-teal/30 outline-none placeholder:text-foreground/30"
                    />
                  </div>
                </div>

                {/* Step 2: Repair Needed */}
                {(year && make && model) && (
                  <div>
                    <label className="font-mono text-xs text-nick-teal/80 tracking-wider uppercase block mb-4">
                      2. What Repair Do You Need?
                    </label>

                    {!customRepair ? (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {COMMON_REPAIRS.map((r) => (
                            <button
                              key={r.value}
                              type="button"
                              onClick={() => setRepairDescription(r.value)}
                              className={`flex items-center gap-3 px-4 py-3.5 border rounded-md font-mono text-sm text-left transition-all ${
                                repairDescription === r.value
                                  ? "border-nick-yellow bg-nick-yellow/10 text-nick-yellow ring-1 ring-nick-yellow/30"
                                  : "border-border/50 text-foreground/70 hover:border-nick-teal/40 hover:text-nick-teal"
                              }`}
                            >
                              <Wrench className="w-4 h-4 shrink-0" />
                              {r.label}
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => { setCustomRepair(true); setRepairDescription(""); }}
                          className="mt-3 text-nick-teal/80 hover:text-nick-teal text-sm font-mono underline underline-offset-4"
                        >
                          Describe a different repair...
                        </button>
                      </>
                    ) : (
                      <>
                        <textarea
                          value={repairDescription}
                          onChange={(e) => setRepairDescription(e.target.value)}
                          placeholder="Describe the repair you need. For example: 'Front brakes are grinding and need new pads and rotors' or 'Car is overheating and needs a water pump replacement'"
                          rows={4}
                          className="w-full bg-background/60 border border-border/50 rounded-md px-4 py-3 text-foreground font-mono text-sm focus:border-nick-teal focus:ring-1 focus:ring-nick-teal/30 outline-none placeholder:text-foreground/30 resize-none"
                        />
                        <button
                          onClick={() => { setCustomRepair(false); setRepairDescription(""); }}
                          className="mt-2 text-nick-teal/80 hover:text-nick-teal text-sm font-mono underline underline-offset-4"
                        >
                          Choose from common repairs instead
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Submit */}
                {canSubmit && (
                  <div className="text-center pt-2">
                    <button
                      onClick={handleSubmit}
                      disabled={estimateMutation.isPending}
                      className="inline-flex items-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 rounded-md font-heading font-bold text-lg tracking-wider uppercase hover:bg-nick-gold transition-colors glow-yellow disabled:opacity-50"
                    >
                      {estimateMutation.isPending ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          CALCULATING...
                        </>
                      ) : (
                        <>
                          <Calculator className="w-5 h-5" />
                          GET ESTIMATE
                          <ChevronRight className="w-5 h-5" />
                        </>
                      )}
                    </button>
                    {estimateMutation.isPending && (
                      <p className="mt-3 text-foreground/50 text-sm font-mono">
                        Analyzing repair for your {year} {make} {model}...
                      </p>
                    )}
                  </div>
                )}

                {/* Error */}
                {estimateMutation.isError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-md p-4 text-center">
                    <p className="text-red-400 text-sm font-mono">
                      Something went wrong generating the estimate. Please try again or call us directly.
                    </p>
                    <a
                      href={BUSINESS.phone.href}
                      onClick={() => trackPhoneClick("estimate-error")}
                      className="inline-flex items-center gap-2 text-nick-yellow font-mono text-sm mt-2 hover:underline"
                    >
                      <Phone className="w-4 h-4" />
                      {BUSINESS.phone.display}
                    </a>
                  </div>
                )}
              </div>
            </FadeIn>
          ) : (
            /* ─── RESULTS ─── */
            <div className="space-y-6">
              <FadeIn>
                {/* Header */}
                <div className="bg-card/80 border border-border/30 rounded-lg p-6 lg:p-8">
                  <div className="text-center mb-6">
                    <span className="font-mono text-nick-teal text-xs tracking-widest uppercase">Repair Estimate</span>
                    <h2 className="font-heading font-bold text-3xl lg:text-4xl text-foreground mt-2">
                      {result.repairTitle}
                    </h2>
                    <p className="text-foreground/60 font-mono text-sm mt-1">
                      <Car className="w-4 h-4 inline mr-1" />
                      {result.vehicleDisplay}
                    </p>
                  </div>

                  {/* Grand Total */}
                  <div className="flex items-center justify-center gap-6 py-8 border-y border-border/30">
                    <div className="text-center">
                      <span className="font-mono text-foreground/40 text-xs uppercase block mb-1">From</span>
                      <span className="font-heading font-bold text-4xl lg:text-5xl text-nick-teal">
                        ${result.grandTotalLow.toLocaleString()}
                      </span>
                    </div>
                    <div className="text-foreground/20 text-2xl">—</div>
                    <div className="text-center">
                      <span className="font-mono text-foreground/40 text-xs uppercase block mb-1">Up To</span>
                      <span className="font-heading font-bold text-4xl lg:text-5xl text-nick-yellow">
                        ${result.grandTotalHigh.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Time estimate */}
                  <div className="flex items-center justify-center gap-2 text-foreground/60 font-mono text-sm mt-4">
                    <Clock className="w-4 h-4 text-nick-teal" />
                    Estimated time: {result.timeEstimate}
                  </div>

                  {/* Summary */}
                  <p className="mt-6 text-foreground/70 text-base leading-relaxed text-center max-w-xl mx-auto">
                    {result.summary}
                  </p>
                </div>
              </FadeIn>

              {/* Line Items Breakdown */}
              {result.lineItems.length > 0 && (
                <FadeIn delay={0.1}>
                  <div className="bg-card/80 border border-border/30 rounded-lg p-6 lg:p-8">
                    <h3 className="font-heading font-bold text-xl text-foreground tracking-wider mb-6 flex items-center gap-2">
                      <FileText className="w-5 h-5 text-nick-teal" />
                      DETAILED BREAKDOWN
                    </h3>

                    <div className="space-y-4">
                      {result.lineItems.map((item, i) => (
                        <div key={i} className="border-b border-border/20 pb-4 last:border-0 last:pb-0">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <h4 className="font-mono text-foreground font-semibold text-sm">{item.description}</h4>
                              {item.notes && (
                                <p className="text-foreground/50 text-xs font-mono mt-1">{item.notes}</p>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-4 mt-3">
                            <div>
                              <span className="text-foreground/40 text-xs font-mono block">Labor</span>
                              <span className="text-foreground/80 text-sm font-mono">
                                {item.laborHours}h — ${item.laborCost > 0 ? `$${item.laborCost.toLocaleString()}` : 'Included'}
                              </span>
                            </div>
                            <div>
                              <span className="text-foreground/40 text-xs font-mono block">Parts</span>
                              <span className="text-foreground/80 text-sm font-mono">
                                ${item.partsLow} – ${item.partsHigh}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="text-foreground/40 text-xs font-mono block">Subtotal</span>
                              <span className="text-nick-yellow text-sm font-mono font-semibold">
                                ${(item.laborCost + item.partsLow).toLocaleString()} – ${(item.laborCost + item.partsHigh).toLocaleString()}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Totals */}
                    <div className="mt-6 pt-4 border-t border-border/30 space-y-2">
                      <div className="flex justify-between text-sm font-mono">
                        <span className="text-foreground/60">Total Labor ({result.totalLaborHours}h)</span>
                        <span className="text-foreground/80">${result.totalLaborCost.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm font-mono">
                        <span className="text-foreground/60">Total Parts</span>
                        <span className="text-foreground/80">${result.totalPartsLow.toLocaleString()} – ${result.totalPartsHigh.toLocaleString()}</span>
                      </div>
                      {result.shopSupplies > 0 && (
                        <div className="flex justify-between text-sm font-mono">
                          <span className="text-foreground/60">Shop Supplies</span>
                          <span className="text-foreground/80">${result.shopSupplies}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-base font-mono font-bold pt-2 border-t border-border/20">
                        <span className="text-foreground">Estimated Total</span>
                        <span className="text-nick-yellow">${result.grandTotalLow.toLocaleString()} – ${result.grandTotalHigh.toLocaleString()}</span>
                      </div>
                      <p className="text-foreground/40 text-xs font-mono text-right">+ applicable tax</p>
                    </div>
                  </div>
                </FadeIn>
              )}

              {/* Important Notes */}
              {result.importantNotes.length > 0 && (
                <FadeIn delay={0.15}>
                  <div className="bg-nick-yellow/5 border border-nick-yellow/20 rounded-lg p-5">
                    <h4 className="font-mono text-nick-yellow text-xs tracking-widest uppercase mb-3 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      Important Notes
                    </h4>
                    <ul className="space-y-2">
                      {result.importantNotes.map((note, i) => (
                        <li key={i} className="text-foreground/70 text-sm font-mono flex items-start gap-2">
                          <span className="text-nick-teal mt-0.5">•</span>
                          {note}
                        </li>
                      ))}
                    </ul>
                  </div>
                </FadeIn>
              )}

              {/* Disclaimer */}
              <FadeIn delay={0.2}>
                <div className="bg-background/40 border border-border/20 rounded-lg p-4 flex items-start gap-3">
                  <Info className="w-4 h-4 text-foreground/40 mt-0.5 shrink-0" />
                  <p className="text-foreground/50 text-xs font-mono leading-relaxed">
                    {result.disclaimer}
                  </p>
                </div>
              </FadeIn>

              {/* CTAs */}
              <FadeIn delay={0.25}>
                <div className="bg-card/80 border border-border/30 rounded-lg p-6 lg:p-8 text-center">
                  <h3 className="font-heading font-bold text-2xl text-foreground tracking-wider mb-2">
                    READY TO GET STARTED?
                  </h3>
                  <p className="text-foreground/60 font-mono text-sm mb-6">
                    Call us or book online to schedule your {result.repairTitle.toLowerCase()}.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <a
                      href={BUSINESS.phone.href}
                      onClick={() => trackPhoneClick("estimate-cta")}
                      className="inline-flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark px-6 py-3.5 rounded-md font-heading font-bold tracking-wider uppercase hover:bg-nick-gold transition-colors"
                    >
                      <Phone className="w-5 h-5" />
                      CALL {BUSINESS.phone.display}
                    </a>
                    <Link
                      href="/contact"
                      className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-6 py-3.5 rounded-md font-heading font-bold tracking-wider uppercase hover:border-nick-teal hover:text-nick-teal transition-colors"
                    >
                      BOOK ONLINE
                      <ArrowRight className="w-5 h-5" />
                    </Link>
                  </div>
                  <button
                    onClick={handleReset}
                    className="mt-4 inline-flex items-center gap-2 text-foreground/50 hover:text-nick-teal font-mono text-sm transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Get another estimate
                  </button>
                </div>
              </FadeIn>
            </div>
          )}
        </div>
      </section>

      {/* Trust Section */}
      <section className="section-dark py-12 lg:py-16">
        <div className="container max-w-3xl">
          <FadeIn>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
              <div>
                <DollarSign className="w-8 h-8 text-nick-yellow mx-auto mb-3" />
                <h4 className="font-heading font-bold text-foreground text-sm tracking-wider uppercase">No Hidden Fees</h4>
                <p className="text-foreground/60 text-xs font-mono mt-1">The price we quote is the price you pay.</p>
              </div>
              <div>
                <Wrench className="w-8 h-8 text-nick-teal mx-auto mb-3" />
                <h4 className="font-heading font-bold text-foreground text-sm tracking-wider uppercase">Expert Technicians</h4>
                <p className="text-foreground/60 text-xs font-mono mt-1">Advanced OBD-II diagnostics and certified repairs.</p>
              </div>
              <div>
                <Car className="w-8 h-8 text-nick-yellow mx-auto mb-3" />
                <h4 className="font-heading font-bold text-foreground text-sm tracking-wider uppercase">Cleveland Trusted</h4>
                <p className="text-foreground/60 text-xs font-mono mt-1">{BUSINESS.reviews.countDisplay} reviews, {BUSINESS.reviews.rating} stars.</p>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <InternalLinks />
    </PageLayout>
  );
}
