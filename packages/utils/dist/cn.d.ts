/**
 * Tailwind class-name composition utility.
 *
 * Identical implementation previously duplicated in
 * `apps/statenour/lib/utils.ts` + `apps/nickstire/client/src/lib/utils.ts`
 * (248 import sites across both apps).
 *
 * Centralized as part of Tier-2-E monorepo extraction (2026-05-19 PM).
 *
 * `clsx` handles conditional / array / object shorthand. `twMerge` then
 * resolves conflicting Tailwind classes (e.g. `p-2` + `p-4` → `p-4`)
 * so the last-wins rule is honored even with conditional chains.
 */
import { type ClassValue } from "clsx";
export declare function cn(...inputs: ClassValue[]): string;
//# sourceMappingURL=cn.d.ts.map