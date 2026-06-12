import { Star, Shield, MapPin, Heart } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { trpc } from "@/lib/trpc";

export default function TrustBlock({ className = "" }: { className?: string }) {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const reviewCount = googleData?.totalReviews 
    ? `${googleData.totalReviews.toLocaleString()}+` 
    : BUSINESS.reviews.countDisplay;

  return (
    <div className={`bg-card/30 border border-border/30 rounded-2xl p-8 backdrop-blur-md relative overflow-hidden ${className}`}>
      {/* Visual background accents */}
      <div className="absolute -top-12 -right-12 w-48 h-48 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-nick-blue/5 rounded-full blur-3xl pointer-events-none" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 relative z-10">
        {/* Rating Block */}
        <div className="flex flex-col items-center sm:items-start text-center sm:text-left">
          <div className="flex gap-1 text-[#FDB913] mb-3">
            {[...Array(5)].map((_, i) => (
              <Star key={i} className="w-5 h-5 fill-current" />
            ))}
          </div>
          <span className="font-heading font-extrabold text-2xl text-foreground">
            {BUSINESS.reviews.rating} STAR REPUTATION
          </span>
          <span className="text-xs text-foreground/60 mt-1">
            Over {reviewCount} verified Google reviews
          </span>
        </div>

        {/* Local Shop Block */}
        <div className="flex flex-col items-center sm:items-start text-center sm:text-left">
          <div className="w-10 h-10 bg-nick-blue/10 flex items-center justify-center rounded-lg mb-3">
            <MapPin className="w-5 h-5 text-nick-blue-light" />
          </div>
          <span className="font-heading font-extrabold text-lg text-foreground">
            LOCAL & CONVENIENT
          </span>
          <span className="text-xs text-foreground/60 mt-1">
            Right on Euclid Ave, serving Cleveland & Euclid since 2018
          </span>
        </div>

        {/* Family-Owned Block */}
        <div className="flex flex-col items-center sm:items-start text-center sm:text-left">
          <div className="w-10 h-10 bg-primary/10 flex items-center justify-center rounded-lg mb-3">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <span className="font-heading font-extrabold text-lg text-foreground">
            RUN BY MOE SINCE 2018
          </span>
          <span className="text-xs text-foreground/60 mt-1">
            Independent shop, clean standards, and no franchise runaround
          </span>
        </div>

        {/* Customer First Block */}
        <div className="flex flex-col items-center sm:items-start text-center sm:text-left">
          <div className="w-10 h-10 bg-emerald-500/10 flex items-center justify-center rounded-lg mb-3">
            <Heart className="w-5 h-5 text-emerald-400" />
          </div>
          <span className="font-heading font-extrabold text-lg text-foreground">
            OUR NO-PRESSURE VALUE
          </span>
          <span className="text-xs text-foreground/60 mt-1">
            Free quick checks, written quotes, you don't pay until you say yes
          </span>
        </div>
      </div>
    </div>
  );
}
