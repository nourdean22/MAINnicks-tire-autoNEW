/**
 * UsedTireTrustProtocol — the 4-point inspection checklist that breaks
 * used-tire skepticism. Every claim here is an actual shop gate: if a
 * tire fails any point it never reaches the rack. Keep the numbers in
 * sync with what the crew actually enforces — this block is only worth
 * anything because it is literally true.
 */
import { Ruler, ScanLine, CalendarX2, ShieldCheck } from "lucide-react";

const PROTOCOL = [
  {
    icon: Ruler,
    title: "1 · Deep Tread",
    body: "Absolute minimum of 5/32″ to 7/32″ verified depth — measured with a gauge, not eyeballed. New tires start at 10/32″; Ohio's legal bald limit is 2/32″. Our floor sits far above it.",
  },
  {
    icon: ScanLine,
    title: "2 · Sidewall Scan",
    body: "Manual and ultrasonic inspection of both sidewalls for bubbles, dry rot, and tire-bead tearing. A sidewall defect can't be repaired — one flaw and the tire is scrapped.",
  },
  {
    icon: CalendarX2,
    title: "3 · DOT Production Gate",
    body: "We read the DOT date code on every casing. Zero tires accepted if the code is older than 5 years — rubber oxidizes from the inside out no matter how much tread is left.",
  },
  {
    icon: ShieldCheck,
    title: "4 · Internal Plug Integrity",
    body: "We dismount and inspect the inner liner directly. Prior punctures must be proper plug-patch repairs in the tread zone. No sidewall patches, ever — those tires don't get sold.",
  },
] as const;

export default function UsedTireTrustProtocol() {
  return (
    <div aria-label="Used tire 4-point inspection protocol">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PROTOCOL.map((p) => (
          <div key={p.title} className="bg-background/50 border border-border/20 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <p.icon className="w-4 h-4 text-primary shrink-0" />
              <p className="text-sm font-semibold text-foreground">{p.title}</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{p.body}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-foreground/55 leading-relaxed">
        Fail any one point and the tire never touches your car. Ask the counter to show you the
        tread gauge reading and DOT code on your set before we mount it — we'll walk you through it.
      </p>
    </div>
  );
}
