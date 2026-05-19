// Re-exports from @nour/utils (Tier-2-E shared package · 2026-05-19).
// Existing import sites continue to import `cn` from "@/lib/utils";
// the implementation now lives once at packages/utils/src/cn.ts.
//
// New code should prefer importing from "@nour/utils" directly · this
// shim exists for backward compat with ~197 existing import sites.
export { cn } from "@nour/utils";
