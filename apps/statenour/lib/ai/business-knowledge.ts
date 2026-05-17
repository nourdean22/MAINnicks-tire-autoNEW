/**
 * Nick's Tire & Auto — business knowledge re-export shim.
 *
 * v10.0.529.106 · Wave 85 · This 1844-LOC file was split into
 * `./knowledge/brand-constants.ts` (data) + `./knowledge/detectors.ts`
 * (logic). Callers continue to import from `@/lib/ai/business-knowledge`
 * without changes — every symbol is re-exported below.
 *
 * If you're adding new content:
 *   · NEW constant (brand voice / pricing / customer language)
 *     → `./knowledge/brand-constants.ts`
 *   · NEW detector or tier-gated loader logic
 *     → `./knowledge/detectors.ts`
 *
 * See the source files for the original sourcing headers (LANDSCAPE,
 * BLUEPRINT, KB, MARKETING, VISION, DNA, MODEL, REV, CONVERSION).
 */

export * from "./knowledge/brand-constants";
export * from "./knowledge/detectors";
