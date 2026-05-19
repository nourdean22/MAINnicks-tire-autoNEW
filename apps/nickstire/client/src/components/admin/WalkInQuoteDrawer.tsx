/**
 * WalkInQuoteDrawer — global event-bus mounted drawer for the front-desk
 * pricing tool.
 *
 * 2026-05-19 · audit verdict: WalkIn-Quote is a tool, not a destination.
 * Operator opens it for 30 seconds when a walk-in is at the counter, then
 * closes it. Doesn't deserve a sidebar slot OR a top-level route.
 *
 * Pattern matches `CustomerDrawer` + `DrilldownDrawer` — mounted globally
 * in Admin.tsx, opened by dispatching `admin:open-walkin-quote` on window.
 * The helper `openWalkInQuote()` below is the canonical fire path.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { SideDrawer } from "./SideDrawer";

const WalkInCalculatorSection = lazy(() => import("../../pages/admin/WalkInCalculatorSection"));

const OPEN_EVENT = "admin:open-walkin-quote";

/** Fire from anywhere · opens the Walk-In Quote drawer. */
export function openWalkInQuote() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export default function WalkInQuoteDrawer() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, []);

  return (
    <SideDrawer
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      title="Walk-In Quote"
      width="lg"
    >
      <Suspense fallback={
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      }>
        <WalkInCalculatorSection />
      </Suspense>
    </SideDrawer>
  );
}
