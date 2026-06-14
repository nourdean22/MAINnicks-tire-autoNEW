/**
 * MembershipsSection — Nonstop Nick counter tool (admin).
 *
 * The operational make-or-break: staff verify "is this phone an active member?"
 * and bind the one covered vehicle at first use. Reachable at /admin?tab=memberships.
 * No sidebar nav slot yet (zero members today — YAGNI; promote when usage proves it).
 *
 * Real <input>s, not window.prompt — the admin runs as an iOS PWA where prompt()
 * is silently suppressed (nickstire-ios-pwa-primitives).
 */
import { useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";

type FoundLookup = Extract<RouterOutputs["memberships"]["lookupByPhone"], { found: true }>;
type MemberRow = FoundLookup["members"][number];
import { CheckCircle2, XCircle, Search, Loader2, Car, BadgeCheck } from "lucide-react";
import { PageHeader } from "./shared";

// Friendly labels for the non-active membership statuses — raw enums
// (PAST_DUE / INCOMPLETE) leaked the underscore into the badge.
const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  incomplete: "Incomplete",
};
const statusLabel = (status: string): string =>
  STATUS_LABELS[status] ?? status;

export default function MembershipsSection() {
  const [query, setQuery] = useState("");
  const [searchPhone, setSearchPhone] = useState<string | null>(null);
  const [bindFor, setBindFor] = useState<number | null>(null);
  const [plate, setPlate] = useState("");
  const [desc, setDesc] = useState("");

  const lookup = trpc.memberships.lookupByPhone.useQuery(
    { phone: searchPhone ?? "" },
    { enabled: !!searchPhone && searchPhone.length >= 4 },
  );

  const bind = trpc.memberships.bindVehicle.useMutation({
    onSuccess: () => {
      toast.success("Vehicle bound to membership.");
      setBindFor(null);
      setPlate("");
      setDesc("");
      lookup.refetch();
    },
    onError: () => toast.error("Couldn't bind the vehicle. Try again."),
  });

  const runSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = query.replace(/\D/g, "");
    if (digits.length < 4) {
      toast.error("Enter at least the last 4 digits of the phone.");
      return;
    }
    setSearchPhone(digits);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nonstop Nick"
        subtitle="Counter lookup — verify a member by phone, bind their vehicle"
        icon={<BadgeCheck className="w-5 h-5" />}
      />

      {/* Search */}
      <form onSubmit={runSearch} className="flex gap-3">
        <input
          type="tel"
          inputMode="tel"
          placeholder="Phone (or last 4 digits)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 max-w-sm rounded-md border border-border bg-background px-4 py-2.5 text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary"
          aria-label="Member phone number"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-5 py-2.5 rounded-md font-semibold hover:opacity-90 transition-opacity"
        >
          <Search className="w-4 h-4" /> Look up
        </button>
      </form>

      {/* Results */}
      {lookup.isFetching && (
        <div className="flex items-center gap-2 text-foreground/50 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Searching…
        </div>
      )}

      {searchPhone && !lookup.isFetching && lookup.data && !lookup.data.found && (
        <div className="border border-border/40 bg-card p-6 text-center">
          <XCircle className="w-7 h-7 text-foreground/25 mx-auto mb-2" />
          <p className="text-foreground/70 font-medium">No member found for that number.</p>
          <p className="text-foreground/40 text-sm mt-1">They can join at nickstire.org/nonstop-nick or at the counter.</p>
        </div>
      )}

      {lookup.data?.found && lookup.data.members.map((m: MemberRow) => (
        <div key={m.id} className="border border-border/40 bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-bold text-foreground">{m.name || "Member"}</p>
              <p className="font-mono text-sm text-foreground/60">{m.phone}</p>
            </div>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
              m.isActive ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-400"
            }`}>
              {m.isActive ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              {m.isActive ? "Active" : statusLabel(m.status)}
            </span>
          </div>

          {/* Repair-discount banner — the $9.99 tier's benefit. Only active members
              get it; the counter applies the % manually on the invoice. */}
          {m.isActive && m.repairDiscountPct > 0 && (
            <div className="mt-3 rounded-md bg-primary/10 border border-primary/30 px-3 py-2 text-sm font-semibold text-primary flex items-center gap-2">
              <BadgeCheck className="w-4 h-4 text-primary" />
              {m.repairDiscountPct}% OFF this repair — apply it on the invoice (Nonstop Nick+)
            </div>
          )}

          {/* Covered vehicle */}
          <div className="mt-4 pt-4 border-t border-border/20">
            {m.vehiclePlate ? (
              <p className="flex items-center gap-2 text-sm text-foreground/70">
                <Car className="w-4 h-4 text-primary" />
                Covered vehicle: <span className="font-mono font-semibold text-foreground">{m.vehiclePlate}</span>
                {m.vehicleDesc && <span className="text-foreground/50">· {m.vehicleDesc}</span>}
              </p>
            ) : bindFor === m.id ? (
              <div className="space-y-2">
                <p className="text-[12px] text-foreground/50">Vehicle not bound yet — bind at first use. One vehicle per membership.</p>
                <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  placeholder="Plate"
                  value={plate}
                  onChange={(e) => setPlate(e.target.value)}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm uppercase focus:outline-none focus:border-primary"
                  aria-label="License plate"
                />
                <input
                  type="text"
                  placeholder="Vehicle (e.g. silver Civic) — optional"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  aria-label="Vehicle description"
                />
                <button
                  onClick={() => {
                    if (!plate.trim()) { toast.error("Enter the plate."); return; }
                    bind.mutate({ membershipId: m.id, vehiclePlate: plate.trim(), vehicleDesc: desc.trim() || undefined });
                  }}
                  disabled={bind.isPending}
                  className="inline-flex items-center justify-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-60"
                >
                  {bind.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Bind"}
                </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setBindFor(m.id); setPlate(""); setDesc(""); }}
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <Car className="w-4 h-4" /> Bind the covered vehicle (first use)
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Counter quick reference — what the membership does and doesn't cover,
          so staff never have to guess (and never overpromise) at the counter. */}
      <div className="border border-border/40 bg-card p-5 text-sm">
        <p className="font-bold text-foreground mb-3">Counter quick reference</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="font-semibold text-emerald-500 mb-1.5">Covered (active member · bound vehicle · rims up to 19")</p>
            <ul className="space-y-1 text-foreground/70">
              <li>Tread-area flat repairs (plug + patch)</li>
              <li>Rubber valve stems</li>
              <li>Tire rotation</li>
              <li>Rim cleans</li>
              <li>Air top-off + tread check</li>
              <li>Wiper &amp; bulb swaps — member brings the part</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-red-400 mb-1.5">Not covered (quote as regular work)</p>
            <ul className="space-y-1 text-foreground/70">
              <li>Towing</li>
              <li>Sidewall damage (that's a new tire, not a repair)</li>
              <li>TPMS sensors + TPMS valve stems</li>
              <li>Rims over 19"</li>
              <li>The wiper/bulb part itself</li>
            </ul>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-border/20 space-y-1 text-foreground/60">
          <p><span className="font-semibold text-foreground/80">Nonstop Nick+ members:</span> 15% off repairs (parts + labor) — the lookup card shows the banner; apply it on the invoice.</p>
          <p><span className="font-semibold text-foreground/80">Status not Active</span> (past due / canceled / incomplete): no covered work — they can rejoin online or at the counter.</p>
          <p><span className="font-semibold text-foreground/80">Anything outside the plan:</span> tell the member and quote it before work starts.</p>
        </div>
      </div>
    </div>
  );
}
