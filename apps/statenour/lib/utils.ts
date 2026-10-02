// `cn` for statenour · UI v2 (2026-10-02).
//
// The shared `@nour/utils` cn uses stock tailwind-merge, which does not know the v2
// radius (`rounded-micro|control|surface|float|overlay`) or shadow (`shadow-l1|l2`)
// scales registered in app/styles/tokens.css. With the stock merger a caller's
// `rounded-full` passed over a primitive's `rounded-control` COEXISTS instead of
// replacing it, and stylesheet order decides which paints (found by the PR #2878
// hostile review). This merger extends the theme so last-wins holds for those
// scales too. Everything else is identical to the shared implementation.
// Pinned by tests/lib/cn-v2-tokens.test.ts.
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMergeV2 = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["micro", "control", "surface", "float", "overlay"],
      shadow: ["l1", "l2"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMergeV2(clsx(inputs));
}
