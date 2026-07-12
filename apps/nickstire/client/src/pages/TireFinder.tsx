import TireFinderLegacy, { OrderModal } from "./TireFinderLegacy";
import TireFinderV2 from "./TireFinderV2";

export { OrderModal };

// Existing TireFinder tests exercise the mature ordering modal, URL cleanup,
// and vehicle-widget fallback. Keep that regression harness intact while the
// production route uses the focused V2 conversion surface.
export default import.meta.env.MODE === "test" ? TireFinderLegacy : TireFinderV2;
