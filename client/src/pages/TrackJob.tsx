/**
 * Customer-facing job tracker — public page at /track.
 * Customers enter order number + phone to see real-time status.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Loader2, CheckCircle2, Clock, Wrench, Truck, Search, ArrowRight } from "lucide-react";

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

  const { data, isLoading, refetch } = trpc.dispatch.track.useQuery(
    { orderNumber, phone },
    { enabled: searched && orderNumber.length > 0 && phone.length >= 10 }
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearched(true);
    refetch();
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">Track Your Vehicle</h1>
          <p className="text-sm text-[#A0A0A0] mt-1">Nick's Tire & Auto Service</p>
        </div>

        {/* Search form */}
        <form onSubmit={handleSearch} className="space-y-3">
          <input
            type="text"
            placeholder="Order Number (e.g. WO-2026-123456)"
            value={orderNumber}
            onChange={e => { setOrderNumber(e.target.value); setSearched(false); }}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:border-[#FDB913]/50 focus:outline-none"
          />
          <input
            type="tel"
            placeholder="Phone Number"
            value={phone}
            onChange={e => { setPhone(e.target.value); setSearched(false); }}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:border-[#FDB913]/50 focus:outline-none"
          />
          <button
            type="submit"
            disabled={isLoading || !orderNumber || phone.length < 10}
            className="w-full py-3 bg-[#FDB913] text-black font-semibold rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Track My Vehicle
          </button>
        </form>

        {/* Results */}
        {searched && !isLoading && !data && (
          <div className="text-center py-8">
            <p className="text-[#A0A0A0]">No matching order found. Please check your order number and phone number.</p>
          </div>
        )}

        {data && (
          <div className="border border-white/10 rounded-xl p-5 bg-white/5 space-y-5">
            {/* Vehicle */}
            <div className="text-center">
              <div className="text-lg font-semibold text-white">{data.vehicle || "Your Vehicle"}</div>
              <div className="text-sm text-[#A0A0A0]">Order #{data.orderNumber}</div>
            </div>

            {/* Status badge */}
            <div className="text-center">
              <span className={`inline-block px-4 py-2 rounded-full text-sm font-semibold ${
                data.statusKey === "ready_for_pickup" || data.statusKey === "customer_notified"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : data.statusKey === "on_hold"
                  ? "bg-amber-500/20 text-amber-400"
                  : "bg-[#FDB913]/20 text-[#FDB913]"
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
                        active ? "bg-[#FDB913] text-black" : "bg-white/10 text-white/30"
                      }`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className={`text-[9px] mt-1 ${active ? "text-white" : "text-white/30"}`}>
                        {step.label}
                      </span>
                    </div>
                    {i < STATUS_STEPS.length - 1 && (
                      <div className={`w-8 h-0.5 mx-1 ${active ? "bg-[#FDB913]" : "bg-white/10"}`} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Service details */}
            {data.services && data.services.length > 0 && (
              <div>
                <div className="text-xs text-[#A0A0A0] mb-1">Services</div>
                <div className="space-y-1">
                  {data.services.map((s: string, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-white/80">
                      <ArrowRight className="w-3 h-3 text-[#FDB913]" />
                      {s}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Promise time */}
            {data.promisedAt && (
              <div className="flex items-center gap-2 text-sm text-[#A0A0A0] pt-2 border-t border-white/10">
                <Clock className="w-4 h-4" />
                <span>Estimated ready: {new Date(data.promisedAt).toLocaleDateString()} at {new Date(data.promisedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-[#A0A0A0]">
          Questions? Call <a href="tel:+12162711600" className="text-[#FDB913] hover:underline">(216) 271-1600</a>
        </div>
      </div>
    </div>
  );
}
