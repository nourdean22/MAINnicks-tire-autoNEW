/**
 * FastPaths — Self-identification section below TrustStrip on homepage.
 * "What brought you in today?" — 6 problem paths that link directly to
 * the right service page, matching the visitor's own language.
 * Zero JS required. Pure anchor links. No CLS. Mobile-first grid.
 */
import { Link } from "wouter";
import { AlertTriangle, Gauge, Wrench, CheckSquare, Zap, DollarSign, ArrowRight } from "lucide-react";

const PATHS = [
  {
    icon: AlertTriangle,
    label: "My check engine light is on",
    sub: "We'll tell you exactly what it means",
    href: "/diagnostics",
    accent: "border-amber-500/30 hover:border-amber-500/60 hover:bg-amber-950/15",
    iconClass: "text-amber-400",
  },
  {
    icon: Gauge,
    label: "My brakes are squealing or grinding",
    sub: "Free inspection · Most jobs same day",
    href: "/brakes",
    accent: "border-rose-500/30 hover:border-rose-500/60 hover:bg-rose-950/15",
    iconClass: "text-rose-400",
  },
  {
    icon: Wrench,
    label: "I need tires",
    sub: "New + used · All sizes · Walk-ins welcome",
    href: "/tires",
    accent: "border-border/25 hover:border-primary/40 hover:bg-primary/5",
    iconClass: "text-primary",
  },
  {
    icon: CheckSquare,
    label: "I failed my E-Check",
    sub: "We diagnose and repair emissions failures",
    href: "/emissions",
    accent: "border-border/25 hover:border-primary/40 hover:bg-primary/5",
    iconClass: "text-primary",
  },
  {
    icon: Zap,
    label: "Something just feels wrong",
    sub: "Full diagnostic · Plain English results",
    href: "/diagnostics",
    accent: "border-border/25 hover:border-primary/40 hover:bg-primary/5",
    iconClass: "text-primary",
  },
  {
    icon: DollarSign,
    label: "I can't afford the repair right now",
    sub: "$10 down · All credit · Approved in minutes",
    href: "/financing",
    accent: "border-emerald-500/30 hover:border-emerald-500/60 hover:bg-emerald-950/15",
    iconClass: "text-emerald-400",
  },
];

export default function FastPaths() {
  return (
    <section className="bg-[oklch(0.065_0.004_260)] py-16 lg:py-20">
      <div className="container">
        {/* Heading */}
        <div className="mb-8">
          <p className="text-xs font-semibold tracking-[0.12em] uppercase text-foreground/40 mb-2">
            Quick answers
          </p>
          <h2 className="font-heading text-3xl lg:text-4xl font-extrabold uppercase text-foreground leading-tight">
            What brought you in today?
          </h2>
        </div>

        {/* Path grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PATHS.map((path) => {
            const Icon = path.icon;
            return (
              <Link
                key={path.href + path.label}
                href={path.href}
                className={`group flex items-center gap-4 rounded-xl border bg-[oklch(0.07_0.004_260)] p-4 transition-all duration-150 ${path.accent}`}
              >
                <div className="shrink-0 w-9 h-9 rounded-lg bg-background/50 flex items-center justify-center">
                  <Icon className={`w-4 h-4 ${path.iconClass}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground/90 leading-snug">
                    {path.label}
                  </p>
                  <p className="mt-0.5 text-xs text-foreground/45">{path.sub}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-foreground/20 group-hover:text-foreground/50 shrink-0 transition-colors" />
              </Link>
            );
          })}
        </div>

        {/* Local anchor */}
        <p className="mt-6 text-xs text-foreground/30 text-center">
          17625 Euclid Ave, Cleveland · Mon–Sat 8–6, Sun 9–4 · Walk-ins welcome
        </p>
      </div>
    </section>
  );
}
