/**
 * Customer-facing job tracker — public page at /track.
 * Customers enter order number + phone to see real-time status.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { SEOHead } from "@/components/SEO";
import { QueryError } from "@/components/QueryState";
import { Loader2, CheckCircle2, Clock, Wrench, Truck, Search, ArrowRight } from "lucide-react";
import { BUSINESS } from "@shared/business";

const STATUS_STEPS = [
  { key: "approved", label: "Checked In", icon: CheckCircle2 },
  { key: "in_progress", label: "In Progress", icon: Wrench },
  { key: "qc_review", label: "Quality Check", icon: Search },
  { key: "ready_for_pickup", label: "Ready!", icon: Truck },
];

const STATUS_ORDER: Record<string, number> = {
  draft: 0, approved: 1, parts_needed: 1, parts_ordered: 1, parts_partial: 1,
  parts_received: 1, ready_for_bay: 1, assigned: 2, in_progress: 2,
  qc_review: 3, ready_for_pickup: 4, customer_notified: 4, picked_up: 5,
  invoiced: 5, closed: 5,
};

export default function TrackJob() {
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [searched, setSearched] = useState(false);

  const { data, isLoading, isError, isSuccess, fetchStatus, refetch } = trpc.dispatch.track.useQuery(
    { orderNumber, phone },
    { enabled: searched && orderNumber.length > 0 && phone.length >= 10 }
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearched(true);
    refetch();
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <SEOHead
        title="Track Your Vehicle Repair | Nick's Tire & Auto Cleveland"
        description="Track your vehicle repair status in real-time at Nick's Tire & Auto. Enter your order number and phone to see live updates on your service."
        canonicalPath="/track"
        robots="noindex, follow"
      />
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">Track Your Vehicle</h1>
          <p className="text-sm text-muted-foreground mt-1">Nick's Tire & Auto Service</p>
        </div>

        {/* Search form */}
        <form onSubmit={handleSearch} className="space-y-3">
          <input
            type="text"
            placeholder="Order Number (e.g. WO-2026-123456)"
            aria-label="Order number"
            value={orderNumber}
            onChange={e => { setOrderNumber(e.target.value); setSearched(false); }}
            className="w-full px-4 py-3 bg-foreground/5 border border-foreground/10 rounded-lg text-foreground placeholder:text-foreground/30 focus:border-primary/50 focus:outline-none"
          />
          <input
            type="tel"
            placeholder="Phone Number"
            aria-label="Phone number"
            value={phone}
            onChange={e => { setPhone(e.target.value); setSearched(false); }}
            className="w-full px-4 py-3 bg-foreground/5 border border-foreground/10 rounded-lg text-foreground placeholder:text-foreground/30 focus:border-primary/50 focus:outline-none"
          />
          <button
            type="submit"
            disabled={isLoading || !orderNumber || phone.length < 10}
            className="w-full py-3 bg-primary text-black font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Track My Vehicle
          </button>
        </form>

        {/* Four states, never two. A failed OR offline-paused lookup must not
            read as "your order number is wrong" — and with the default
            networkMode:"online" an offline query is neither error nor
            success nor loading, so without this branch the offline PWA gave
            no feedback at all. */}
        {searched && fetchStatus === "paused" && (
          <QueryError
            message="You appear to be offline — we couldn't check your order. Reconnect and try again."
            onRetry={() => refetch()}
            className="py-8"
          />
        )}
        {searched && isError && (
          <QueryError
            message="We couldn't check your order right now — that's a connection problem on our end, not a wrong order number."
            onRetry={() => refetch()}
            className="py-8"
          />
        )}
        {searched && isSuccess && !data && (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No matching order found. Please check your order number and phone number.</p>
          </div>
        )}

        {data && (
          <div className="border border-foreground/10 rounded-xl p-5 bg-foreground/5 space-y-5">
            {/* Vehicle */}
            <div className="text-center">
              <div className="text-lg font-semibold text-foreground">{data.vehicle || "Your Vehicle"}</div>
              <div className="text-sm text-muted-foreground">Order #{data.orderNumber}</div>
            </div>

            {/* Status badge */}
            <div className="text-center">
              <span className={`inline-block px-4 py-2 rounded-full text-sm font-semibold ${
                data.statusKey === "ready_for_pickup" || data.statusKey === "customer_notified"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : data.statusKey === "on_hold"
                  ? "bg-amber-500/20 text-amber-400"
                  : "bg-primary/20 text-primary"
              }`}>
                {data.status}
              </span>
            </div>

            {/* Progress steps */}
            <div className="flex items-center justify-between px-2">
              {STATUS_STEPS.map((step, i) => {
                const currentStep = STATUS_ORDER[data.statusKey] || 0;
                const stepNum = i + 1;
                const active = currentStep >= stepNum;
                const Icon = step.icon;

                return (
                  <div key={step.key} className="flex items-center">
                    <div className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        active ? "bg-primary text-black" : "bg-foreground/10 text-foreground/30"
                      }`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className={`text-[9px] mt-1 ${active ? "text-foreground" : "text-foreground/30"}`}>
                        {step.label}
                      </span>
                    </div>
                    {i < STATUS_STEPS.length - 1 && (
                      <div className={`w-8 h-0.5 mx-1 ${active ? "bg-primary" : "bg-foreground/10"}`} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Service details */}
            {data.services && data.services.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Services</div>
                <div className="space-y-1">
                  {data.services.map((s: string, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-foreground/80">
                      <ArrowRight className="w-3 h-3 text-primary" />
                      {s}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Promise time */}
            {data.promisedAt && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2 border-t border-foreground/10">
                <Clock className="w-4 h-4" />
                <span>Estimated ready: {new Date(data.promisedAt).toLocaleDateString()} at {new Date(data.promisedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground">
          Questions? Call <a href={BUSINESS.phone.href} className="text-primary hover:underline">{BUSINESS.phone.display}</a>
        </div>
      </div>
    </div>
  );
}
