import { Suspense } from "react";
import { Ultron } from "@/components/ultron/ultron";

/**
 * /cockpit · v10.0.529.83 · Wave 27 · Ultron dissolution alias.
 *
 * The full Ultron apex surface used to live at `/` · Wave 27 made
 * the root the conversational interface (chat) with a tight HomeStrip
 * above. The full dashboard view is preserved here for operators who
 * want it on a single page · deep-links + bookmarks pointed at the
 * old root continue to work via the FloatingHome QUICK NAV.
 *
 * No behavior change vs the pre-Wave-27 root · same components ·
 * same fetch lifecycle · same Suspense boundary.
 */
export default function CockpitPage() {
  return (
    <Suspense fallback={null}>
      <Ultron />
    </Suspense>
  );
}
