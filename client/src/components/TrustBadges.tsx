/**
 * TrustBadges — Social proof badges for conversion optimization.
 * Shows key trust signals in a compact horizontal strip.
 */
import { Shield, Star, Clock, Award, Users, MapPin } from "lucide-react";

const BADGES = [
  { icon: Star, label: "4.9 Stars", detail: "1,685+ Reviews" },
  { icon: Shield, label: "Licensed & Insured", detail: "Ohio Certified" },
  { icon: Clock, label: "Same-Day Service", detail: "Walk-ins Welcome" },
  { icon: Award, label: "ASE Standards", detail: "Expert Technicians" },
  { icon: Users, label: "Family Owned", detail: "Cleveland Local" },
  { icon: MapPin, label: "Easy Access", detail: "17625 Euclid Ave" },
];

export default function TrustBadges() {
  return (
    <section className="border-y border-border/20 bg-nick-dark/50 py-8">
      <div className="container">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6">
          {BADGES.map((badge) => (
            <div key={badge.label} className="flex items-center gap-3">
              <badge.icon className="w-5 h-5 text-nick-yellow shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground leading-tight">{badge.label}</p>
                <p className="text-xs text-foreground/40">{badge.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
