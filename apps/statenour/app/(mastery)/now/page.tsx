import { notFound } from "next/navigation";
import { isIntentSurfaceOn } from "@/lib/intent/compose";
import { IntentSurface } from "@/components/now/intent-surface";

// W6 intent surface: 404 until W6_INTENT_SURFACE is on (docs/design/ui-v3/W6-INTENT-SURFACE.md).
export const dynamic = "force-dynamic";

export default async function NowPage() {
  if (!(await isIntentSurfaceOn())) notFound();
  return <IntentSurface />;
}
