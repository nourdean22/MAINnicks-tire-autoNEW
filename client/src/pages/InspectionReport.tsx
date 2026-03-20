import { useMemo } from "react";
import PageLayout from "@/components/PageLayout";
import { SEOHead } from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import { useRoute } from "wouter";
import {
  CheckCircle, AlertTriangle, XCircle, Car, Wrench, Phone, Calendar,
  User, Gauge, Shield, Droplets, Cog, CircuitBoard, Truck,
} from "lucide-react";
import { BUSINESS } from "@shared/business";
import { QueryError } from "@/components/QueryState";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";

const CONDITION_CONFIG = {
  green: { label: "Good", color: "text-nick-teal", bg: "bg-nick-teal/20", border: "border-nick-teal/30", icon: <CheckCircle className="w-5 h-5" /> },
  yellow: { label: "Monitor", color: "text-nick-yellow", bg: "bg-nick-yellow/20", border: "border-nick-yellow/30", icon: <AlertTriangle className="w-5 h-5" /> },
  red: { label: "Needs Repair", color: "text-red-400", bg: "bg-red-400/20", border: "border-red-400/30", icon: <XCircle className="w-5 h-5" /> },
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  brakes: <Shield className="w-4 h-4" />,
  tires: <Gauge className="w-4 h-4" />,
  engine: <Cog className="w-4 h-4" />,
  suspension: <Truck className="w-4 h-4" />,
  electrical: <CircuitBoard className="w-4 h-4" />,
  fluids: <Droplets className="w-4 h-4" />,
  body: <Car className="w-4 h-4" />,
  other: <Wrench className="w-4 h-4" />,
};

const OVERALL_CONFIG = {
  good: { label: "Good Condition", color: "text-nick-teal", bg: "bg-nick-teal/10", border: "border-nick-teal/30" },
  fair: { label: "Fair — Some Items Need Attention", color: "text-nick-yellow", bg: "bg-nick-yellow/10", border: "border-nick-yellow/30" },
  "needs-attention": { label: "Needs Attention", color: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/30" },
};

export default function InspectionReport() {
  const [, params] = useRoute("/inspection/:token");
  const token = params?.token || "";

  const { data: inspection, isLoading , isError, error } = trpc.inspection.byToken.useQuery(
    { token },
    { enabled: !!token }
  );

  const summary = useMemo(() => {
    if (!inspection?.items) return { green: 0, yellow: 0, red: 0, totalCost: 0 };
    return {
      green: inspection.items.filter((i: any) => i.condition === "green").length,
      yellow: inspection.items.filter((i: any) => i.condition === "yellow").length,
      red: inspection.items.filter((i: any) => i.condition === "red").length,
      totalCost: inspection.items.reduce((sum: number, i: any) => sum + (i.estimatedCost || 0), 0),
    };
  }, [inspection]);

  if (isLoading) {
    return (
      <PageLayout>
        <SEOHead title="Vehicle Inspection Report | Nick's Tire & Auto" description="View your digital vehicle inspection report from Nick's Tire & Auto in Cleveland. Detailed condition assessment with photos and technician notes." canonicalPath="/inspection" />
        <section className="section-dark pt-28 pb-20">
          <div className="container max-w-3xl text-center py-20">
            <div className="w-10 h-10 border-2 border-nick-yellow border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-foreground/60 font-mono text-sm">Loading inspection report...</p>
          </div>
        </section>
      </PageLayout>
    );
  }

  if (isError) {
    return (
      <QueryError
        message="Failed to load data. Please try again."
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (!inspection) {
    return (
      <PageLayout>
        <SEOHead title="Inspection Not Found | Nick's Tire & Auto" description="This inspection report could not be found. Contact Nick's Tire & Auto in Cleveland for assistance with your vehicle inspection." canonicalPath="/inspection" />
        <section className="section-dark pt-28 pb-20">
          <div className="container max-w-3xl text-center py-20">
            <AlertTriangle className="w-16 h-16 text-nick-yellow/60 mx-auto mb-4" />
            <h1 className="font-heading font-bold text-3xl text-foreground mb-3">Report Not Found</h1>
            <p className="text-foreground/60 max-w-md mx-auto mb-6">
              This inspection report does not exist or has not been published yet. If you received a link, please contact us.
            </p>
            <a href={BUSINESS.phone.href} className="inline-flex items-center gap-2 bg-nick-yellow text-nick-dark px-6 py-3 rounded-md font-heading font-bold text-sm tracking-wider uppercase">
              <Phone className="w-4 h-4" /> CALL {BUSINESS.phone.display}
            </a>
          </div>
        </section>
      </PageLayout>
    );
  }

  const overall = OVERALL_CONFIG[inspection.overallCondition as keyof typeof OVERALL_CONFIG] || OVERALL_CONFIG.fair;

  return (
    <PageLayout>
      <SEOHead title={`Vehicle Inspection — ${inspection.vehicleInfo} | Nick's Tire & Auto`} description="Your digital vehicle inspection report from Nick's Tire & Auto in Cleveland. Detailed condition assessment with technician recommendations." canonicalPath="/inspection" />
      <LocalBusinessSchema />

      {/* Header */}
      <section className="section-dark pt-28 pb-12 lg:pt-36 lg:pb-16">
        <div className="container max-w-3xl">
          <div className="text-center mb-8">
            <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">Digital Inspection Report</span>
            <h1 className="font-heading font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight">
              {inspection.vehicleInfo}
            </h1>
            {inspection.mileage && (
              <p className="text-foreground/60 font-mono text-sm mt-2">
                <Gauge className="w-4 h-4 inline mr-1" />
                {inspection.mileage.toLocaleString()} miles
              </p>
            )}
          </div>

          {/* Vehicle & Technician Info */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <div className="bg-card/50 rounded-md p-3 text-center">
              <User className="w-4 h-4 text-nick-teal mx-auto mb-1" />
              <span className="font-mono text-xs text-foreground/40 block">Customer</span>
              <span className="font-mono text-sm text-foreground">{inspection.customerName}</span>
            </div>
            <div className="bg-card/50 rounded-md p-3 text-center">
              <Wrench className="w-4 h-4 text-nick-teal mx-auto mb-1" />
              <span className="font-mono text-xs text-foreground/40 block">Technician</span>
              <span className="font-mono text-sm text-foreground">{inspection.technicianName}</span>
            </div>
            <div className="bg-card/50 rounded-md p-3 text-center">
              <Calendar className="w-4 h-4 text-nick-teal mx-auto mb-1" />
              <span className="font-mono text-xs text-foreground/40 block">Date</span>
              <span className="font-mono text-sm text-foreground">
                {new Date(inspection.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div className={`rounded-md p-3 text-center ${overall.bg} border ${overall.border}`}>
              <span className="font-mono text-xs text-foreground/40 block mb-1">Overall</span>
              <span className={`font-heading font-bold text-sm ${overall.color}`}>{overall.label}</span>
            </div>
          </div>

          {/* Summary Counts */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            <div className="bg-nick-teal/10 border border-nick-teal/20 rounded-md p-4 text-center">
              <span className="font-heading font-bold text-3xl text-nick-teal">{summary.green}</span>
              <span className="block font-mono text-xs text-nick-teal/80 mt-1">Good</span>
            </div>
            <div className="bg-nick-yellow/10 border border-nick-yellow/20 rounded-md p-4 text-center">
              <span className="font-heading font-bold text-3xl text-nick-yellow">{summary.yellow}</span>
              <span className="block font-mono text-xs text-nick-yellow/80 mt-1">Monitor</span>
            </div>
            <div className="bg-red-400/10 border border-red-400/20 rounded-md p-4 text-center">
              <span className="font-heading font-bold text-3xl text-red-400">{summary.red}</span>
              <span className="block font-mono text-xs text-red-400/80 mt-1">Needs Repair</span>
            </div>
          </div>
        </div>
      </section>

      {/* Inspection Items */}
      <section className="section-darker py-12 lg:py-16">
        <div className="container max-w-3xl space-y-4">
          {inspection.items?.map((item: any) => {
            const cond = CONDITION_CONFIG[item.condition as keyof typeof CONDITION_CONFIG] || CONDITION_CONFIG.yellow;
            return (
              <div key={item.id} className={`card-vibrant bg-card/80 rounded-lg p-5 border-l-4 ${cond.border}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${cond.bg} ${cond.color}`}>
                      {cond.icon}
                    </div>
                    <div>
                      <h3 className="font-heading font-bold text-foreground tracking-wider text-sm">{item.component}</h3>
                      <span className="font-mono text-xs text-foreground/40 flex items-center gap-1">
                        {CATEGORY_ICONS[item.category] || CATEGORY_ICONS.other}
                        {item.category}
                      </span>
                    </div>
                  </div>
                  <span className={`font-mono text-xs font-bold px-2 py-1 rounded ${cond.bg} ${cond.color}`}>
                    {cond.label.toUpperCase()}
                  </span>
                </div>

                {item.notes && (
                  <p className="text-foreground/70 text-sm mb-3 pl-11">{item.notes}</p>
                )}

                {item.photoUrl && (
                  <div className="pl-11 mb-3">
                    <img loading="lazy" src={item.photoUrl} alt={item.component} className="w-full max-w-sm rounded-md border border-border/30 object-contain" />
                  </div>
                )}

                {(item.recommendedAction || item.estimatedCost) && (
                  <div className="pl-11 flex flex-wrap gap-4 text-sm">
                    {item.recommendedAction && (
                      <div className="flex items-center gap-1 text-foreground/60">
                        <Wrench className="w-3.5 h-3.5 text-nick-teal" />
                        <span>{item.recommendedAction}</span>
                      </div>
                    )}
                    {item.estimatedCost > 0 && (
                      <div className="flex items-center gap-1 text-nick-yellow font-mono">
                        Est. ${item.estimatedCost}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Summary Notes & CTA */}
      <section className="section-dark py-12 lg:py-16">
        <div className="container max-w-3xl">
          {inspection.summaryNotes && (
            <div className="card-vibrant bg-card/80 rounded-lg p-6 mb-8">
              <h3 className="font-heading font-bold text-foreground tracking-wider text-sm mb-3">TECHNICIAN NOTES</h3>
              <p className="text-foreground/70 leading-relaxed">{inspection.summaryNotes}</p>
            </div>
          )}

          {summary.totalCost > 0 && (
            <div className="card-vibrant bg-card/80 rounded-lg p-6 mb-8 text-center">
              <span className="font-mono text-foreground/40 text-xs uppercase">Estimated Total for Recommended Repairs</span>
              <p className="font-heading font-bold text-4xl text-nick-yellow mt-2">${summary.totalCost.toLocaleString()}</p>
              <p className="text-foreground/50 text-sm mt-2">Final pricing confirmed after approval. No work starts without your OK.</p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/book"
              className="inline-flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors"
            >
              BOOK RECOMMENDED REPAIRS
            </a>
            <a
              href={BUSINESS.phone.href}
              className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:border-nick-yellow hover:text-nick-yellow transition-colors"
            >
              <Phone className="w-4 h-4" />
              CALL WITH QUESTIONS
            </a>
          </div>

          <p className="text-center text-foreground/40 font-mono text-xs mt-6">
            {`${BUSINESS.name} — ${BUSINESS.address.full} — ${BUSINESS.phone.display}`}
          </p>
        </div>
      </section>
    </PageLayout>
  );
}
