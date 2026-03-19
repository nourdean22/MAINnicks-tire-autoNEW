import { useState } from "react";
import PageLayout from "@/components/PageLayout";
import { SEOHead } from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import {
  Search, Phone, Hash, Clock, CheckCircle, Wrench, AlertTriangle,
  Package, Eye, Truck,
} from "lucide-react";

const STAGES = [
  { key: "received", label: "Received", icon: <Package className="w-5 h-5" />, desc: "Your vehicle is in our queue" },
  { key: "inspecting", label: "Inspecting", icon: <Eye className="w-5 h-5" />, desc: "Our technicians are diagnosing the issue" },
  { key: "waiting-parts", label: "Parts", icon: <Truck className="w-5 h-5" />, desc: "Waiting for parts to arrive" },
  { key: "in-progress", label: "Repairing", icon: <Wrench className="w-5 h-5" />, desc: "Actively being repaired" },
  { key: "quality-check", label: "QC", icon: <CheckCircle className="w-5 h-5" />, desc: "Going through quality check" },
  { key: "ready", label: "Ready", icon: <CheckCircle className="w-5 h-5" />, desc: "Ready for pickup!" },
];

function getStageIndex(stage: string | null): number {
  if (!stage) return 0;
  const idx = STAGES.findIndex(s => s.key === stage);
  return idx >= 0 ? idx : 0;
}

function timeAgo(date: Date | string | null): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function StatusTracker() {
  const [searchType, setSearchType] = useState<"phone" | "ref">("phone");
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);

  const phoneQuery = trpc.booking.statusByPhone.useQuery(
    { phone: query },
    { enabled: searched && searchType === "phone" && query.length >= 7 }
  );
  const refQuery = trpc.booking.statusByRef.useQuery(
    { ref: query },
    { enabled: searched && searchType === "ref" && query.length >= 3 }
  );

  const results = searchType === "phone" ? phoneQuery.data : refQuery.data;
  const isLoading = searchType === "phone" ? phoneQuery.isLoading : refQuery.isLoading;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearched(true);
  };

  return (
    <PageLayout activeHref="/status">
      <SEOHead
        title="Check Your Vehicle Status | Nick's Tire & Auto"
        description="Track your vehicle repair progress in real time. Enter your phone number or reference code to see where your car is in the repair process."
        canonicalPath="/status"
      />

      {/* Hero */}
      <section className="section-dark pt-28 pb-16 lg:pt-36 lg:pb-20">
        <div className="container max-w-3xl text-center">
          <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">Vehicle Status</span>
          <h1 className="font-heading font-bold text-4xl lg:text-5xl text-foreground mt-3 tracking-tight">
            CHECK YOUR <span className="text-gradient-yellow">REPAIR STATUS</span>
          </h1>
          <p className="mt-4 text-foreground/70 text-lg max-w-xl mx-auto">
            Enter your phone number or reference code to see where your vehicle is in the repair process.
          </p>

          {/* Search Form */}
          <form onSubmit={handleSearch} className="mt-8 card-vibrant bg-card/80 rounded-lg p-6 lg:p-8">
            {/* Toggle */}
            <div className="flex justify-center gap-2 mb-6">
              <button
                type="button"
                onClick={() => { setSearchType("phone"); setSearched(false); setQuery(""); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-md font-mono text-sm transition-all ${
                  searchType === "phone"
                    ? "bg-nick-yellow text-nick-dark font-bold"
                    : "bg-border/20 text-foreground/60 hover:text-foreground"
                }`}
              >
                <Phone className="w-4 h-4" /> Phone Number
              </button>
              <button
                type="button"
                onClick={() => { setSearchType("ref"); setSearched(false); setQuery(""); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-md font-mono text-sm transition-all ${
                  searchType === "ref"
                    ? "bg-nick-yellow text-nick-dark font-bold"
                    : "bg-border/20 text-foreground/60 hover:text-foreground"
                }`}
              >
                <Hash className="w-4 h-4" /> Reference Code
              </button>
            </div>

            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-nick-teal/40" />
                <input
                  type={searchType === "phone" ? "tel" : "text"}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setSearched(false); }}
                  placeholder={searchType === "phone" ? "(216) 555-0000" : "NT-XXXXXX"}
                  className="w-full bg-background/60 border border-border/50 rounded-md text-foreground pl-11 pr-4 py-3.5 font-mono text-base focus:border-nick-yellow focus:ring-1 focus:ring-nick-yellow/30 focus:outline-none transition-all"
                />
              </div>
              <button
                type="submit"
                className="bg-nick-yellow text-nick-dark px-6 py-3.5 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors shrink-0"
              >
                SEARCH
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Results */}
      {searched && (
        <section className="section-darker py-12 lg:py-16">
          <div className="container max-w-3xl">
            {isLoading ? (
              <div className="text-center py-12">
                <div className="w-10 h-10 border-2 border-nick-yellow border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-foreground/60 font-mono text-sm">Searching...</p>
              </div>
            ) : !results || results.length === 0 ? (
              <div className="text-center py-12 card-vibrant bg-card/80 rounded-lg p-8">
                <AlertTriangle className="w-12 h-12 text-nick-yellow/60 mx-auto mb-4" />
                <h3 className="font-heading font-bold text-xl text-foreground mb-2">No Results Found</h3>
                <p className="text-foreground/60 max-w-md mx-auto">
                  We could not find any active bookings matching that {searchType === "phone" ? "phone number" : "reference code"}.
                  If you recently booked, it may take a few minutes to appear. You can also call us at{" "}
                  <a href="tel:2168620005" className="text-nick-yellow hover:underline">(216) 862-0005</a>.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <h2 className="font-heading font-bold text-2xl text-foreground">
                  {results.length} Active {results.length === 1 ? "Booking" : "Bookings"}
                </h2>
                {results.map((booking: any) => {
                  const stageIdx = getStageIndex(booking.stage);
                  const currentStage = STAGES[stageIdx];
                  const isReady = booking.stage === "ready";

                  return (
                    <div key={booking.id} className={`card-vibrant rounded-lg p-6 lg:p-8 ${isReady ? "ring-2 ring-nick-teal" : "bg-card/80"}`}>
                      {/* Header */}
                      <div className="flex items-start justify-between mb-6">
                        <div>
                          <div className="flex items-center gap-3 mb-1">
                            <h3 className="font-heading font-bold text-lg text-foreground">{booking.service}</h3>
                            {booking.referenceCode && (
                              <span className="font-mono text-xs bg-border/30 text-foreground/60 px-2 py-0.5 rounded">
                                {booking.referenceCode}
                              </span>
                            )}
                          </div>
                          {booking.vehicle && (
                            <p className="text-foreground/60 font-mono text-sm">{booking.vehicle}</p>
                          )}
                        </div>
                        <div className={`px-3 py-1.5 rounded-md font-mono text-xs font-bold tracking-wider ${
                          isReady
                            ? "bg-nick-teal/20 text-nick-teal"
                            : "bg-nick-yellow/20 text-nick-yellow"
                        }`}>
                          {isReady ? "READY FOR PICKUP" : "IN PROGRESS"}
                        </div>
                      </div>

                      {/* Stage Progress */}
                      <div className="mb-6">
                        <div className="flex items-center justify-between mb-3">
                          {STAGES.map((stage, i) => (
                            <div key={stage.key} className="flex items-center">
                              <div className={`flex flex-col items-center ${
                                i <= stageIdx
                                  ? i === stageIdx ? "text-nick-yellow" : "text-nick-teal"
                                  : "text-foreground/20"
                              }`}>
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 ${
                                  i <= stageIdx
                                    ? i === stageIdx
                                      ? "border-nick-yellow bg-nick-yellow/20"
                                      : "border-nick-teal bg-nick-teal/20"
                                    : "border-border/30"
                                }`}>
                                  {stage.icon}
                                </div>
                                <span className="text-[10px] font-mono mt-1.5 hidden sm:block">{stage.label}</span>
                              </div>
                              {i < STAGES.length - 1 && (
                                <div className={`w-6 sm:w-10 h-0.5 mx-1 ${
                                  i < stageIdx ? "bg-nick-teal" : "bg-border/20"
                                }`} />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Current Status */}
                      <div className={`rounded-md p-4 ${isReady ? "bg-nick-teal/10 border border-nick-teal/30" : "bg-background/40 border border-border/30"}`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isReady ? "bg-nick-teal/20" : "bg-nick-yellow/20"}`}>
                            {currentStage.icon}
                          </div>
                          <div>
                            <p className={`font-heading font-bold text-sm tracking-wider ${isReady ? "text-nick-teal" : "text-nick-yellow"}`}>
                              {currentStage.label.toUpperCase()}
                            </p>
                            <p className="text-foreground/60 text-sm">{currentStage.desc}</p>
                          </div>
                          {booking.stageUpdatedAt && (
                            <span className="ml-auto text-foreground/40 font-mono text-xs flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {timeAgo(booking.stageUpdatedAt)}
                            </span>
                          )}
                        </div>
                      </div>

                      {isReady && (
                        <div className="mt-4 text-center">
                          <a
                            href="tel:2168620005"
                            className="inline-flex items-center gap-2 bg-nick-teal text-white px-6 py-3 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-teal/90 transition-colors"
                          >
                            <Phone className="w-4 h-4" />
                            CALL TO ARRANGE PICKUP
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Info Section */}
      <section className="section-dark py-12 lg:py-16">
        <div className="container max-w-3xl">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { icon: <Phone className="w-6 h-6" />, title: "Questions?", desc: "Call us at (216) 862-0005 for any questions about your repair." },
              { icon: <Clock className="w-6 h-6" />, title: "Hours", desc: "Mon–Sat 9AM–6PM. Updates posted during business hours." },
              { icon: <Wrench className="w-6 h-6" />, title: "Walk-Ins Welcome", desc: "No appointment needed. First come, first served." },
            ].map((item) => (
              <div key={item.title} className="text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-nick-yellow/10 flex items-center justify-center text-nick-yellow">
                  {item.icon}
                </div>
                <h3 className="font-heading font-bold text-sm text-foreground tracking-wider mb-1">{item.title}</h3>
                <p className="text-foreground/60 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PageLayout>
  );
}
