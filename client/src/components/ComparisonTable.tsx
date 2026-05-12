/**
 * ComparisonTable — Nick's vs Dealership vs Chain comparison.
 * Desktop: full table. Mobile: card-based layout.
 * Dark background, gold accent for Nick's column.
 */
import { Check, X, AlertTriangle, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { BUSINESS } from "@shared/business";

type Status = "yes" | "no" | "warn";

interface Row {
  feature: string;
  nicks: Status;
  dealership: Status;
  chain: Status;
}

// Voice-led row labels — same data, but each line sounds like a friend
// telling you the difference. 2026-05-05 brand-voice pass.
const ROWS: Row[] = [
  { feature: "Tells you the price before doing the work",        nicks: "yes", dealership: "no",   chain: "warn" },
  { feature: "Shows you the worn part on a lift",                nicks: "yes", dealership: "warn", chain: "no"   },
  { feature: "Done before your Uber driver gets bored",          nicks: "yes", dealership: "no",   chain: "warn" },
  { feature: "Works on whatever you drive",                       nicks: "yes", dealership: "no",   chain: "yes"  },
  { feature: "$10 down financing — no credit check",              nicks: "yes", dealership: "warn", chain: "no"   },
  { feature: "Open Sunday — exhaust never breaks Tuesday",       nicks: "yes", dealership: "no",   chain: "warn" },
  { feature: `${BUSINESS.reviews.countDisplay} Cleveland drivers think so`, nicks: "yes", dealership: "warn", chain: "no" },
  { feature: "Won't sell you what you don't need",               nicks: "yes", dealership: "no",   chain: "no"   },
  { feature: "Mechanics actually trained on this stuff",         nicks: "yes", dealership: "yes",  chain: "warn" },
  { feature: "Tells you what's wrong for free, in writing",      nicks: "yes", dealership: "no",   chain: "no"   },
];

const COLUMNS = ["Nick's", "Dealership", "Chain Shop"] as const;

function StatusIcon({ status }: { status: Status }) {
  if (status === "yes") return <Check className="w-5 h-5 text-[#FDB913]" />;
  if (status === "no") return <X className="w-5 h-5 text-red-500" />;
  return <AlertTriangle className="w-4 h-4 text-orange-400" />;
}

function StatusLabel({ status }: { status: Status }) {
  if (status === "yes") return <span className="text-[#FDB913] text-xs font-semibold">YES</span>;
  if (status === "no") return <span className="text-red-500 text-xs font-semibold">NO</span>;
  return <span className="text-orange-400 text-xs font-semibold">SOMETIMES</span>;
}

/* ── Desktop Table ─────────────────────────────────────────── */
function DesktopTable() {
  return (
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left py-4 px-5 text-white/40 font-medium text-xs uppercase tracking-wider">
              Feature
            </th>
            {/* Nick's column — gold header */}
            <th className="text-center py-4 px-5 bg-[#FDB913] text-black font-bold text-xs uppercase tracking-wider rounded-t-lg">
              Nick's
            </th>
            <th className="text-center py-4 px-5 text-white/40 font-medium text-xs uppercase tracking-wider">
              Dealership
            </th>
            <th className="text-center py-4 px-5 text-white/40 font-medium text-xs uppercase tracking-wider">
              Chain Shop
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row, i) => (
            <tr
              key={row.feature}
              className={`border-b border-[#2A2A2A] ${i === ROWS.length - 1 ? "border-b-0" : ""}`}
            >
              <td className="py-4 px-5 text-white/70 font-medium">{row.feature}</td>
              {/* Nick's column — subtle gold left border */}
              <td className="py-4 px-5 text-center border-l-2 border-l-[#FDB913]/30 bg-[#FDB913]/[0.03]">
                <div className="flex justify-center"><StatusIcon status={row.nicks} /></div>
              </td>
              <td className="py-4 px-5 text-center">
                <div className="flex justify-center"><StatusIcon status={row.dealership} /></div>
              </td>
              <td className="py-4 px-5 text-center">
                <div className="flex justify-center"><StatusIcon status={row.chain} /></div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Mobile Cards ──────────────────────────────────────────── */
function MobileCards() {
  return (
    <div className="md:hidden space-y-4">
      {ROWS.map((row) => (
        <div
          key={row.feature}
          className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-4"
        >
          <h3 className="text-white font-semibold text-sm mb-3">{row.feature}</h3>
          <div className="grid grid-cols-3 gap-2">
            {(["nicks", "dealership", "chain"] as const).map((col, i) => (
              <div
                key={col}
                className={`flex flex-col items-center gap-1.5 py-2 rounded-lg ${
                  col === "nicks" ? "bg-[#FDB913]/[0.06] border border-[#FDB913]/20" : "bg-[#141414]"
                }`}
              >
                <span className={`text-[10px] font-bold uppercase tracking-wider ${
                  col === "nicks" ? "text-[#FDB913]" : "text-white/40"
                }`}>
                  {COLUMNS[i]}
                </span>
                <StatusIcon status={row[col]} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Main Export ────────────────────────────────────────────── */
export default function ComparisonTable() {
  return (
    <section className="bg-[#141414] py-20">
      <div className="container">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-3">
            Why Choose Us
          </p>
          <h2 className="font-heading text-3xl sm:text-4xl font-bold text-white tracking-tight uppercase">
            How We Compare
          </h2>
        </div>

        <div className="max-w-3xl mx-auto bg-[#141414] border border-[#2A2A2A] rounded-2xl p-4 lg:p-6">
          <DesktopTable />
          <MobileCards />
        </div>

        {/* 2026-05-06 wave-39 · funnel home-page visitors to the named
            comparison hub. The table above is generic (Nick's vs
            Dealership vs Chain Shop). The hub names the actual chains —
            Conrad's, Mavis, Firestone, NTB, Discount Tire, Monro, Big O
            — and runs head-to-head on each. Highest-traffic surface on
            the site → 14 high-intent comparison pages. */}
        <div className="max-w-3xl mx-auto mt-8 text-center">
          <p className="text-foreground/55 text-sm sm:text-base mb-4 body-pretty">
            Want the named matchup? See how Nick's compares to Conrad's, Mavis,
            Firestone, NTB, Discount Tire, Monro, and Big O — head-to-head, no spin.
          </p>
          <Link
            href="/best-tire-shops-cleveland"
            className="group inline-flex items-center gap-2 bg-[#FDB913] text-[#0A0A0A] px-6 py-3 rounded-lg font-bold text-sm transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-[0_4px_20px_rgba(253,185,19,0.4)] active:scale-[0.98]"
          >
            See the named comparison
            <ArrowRight className="w-4 h-4 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1" />
          </Link>
        </div>
      </div>
    </section>
  );
}
