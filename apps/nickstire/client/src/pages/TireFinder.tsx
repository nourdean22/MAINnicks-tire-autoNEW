// The public /tires route. Production AND tests now resolve to the same
// component (TireFinderV2) — the earlier `MODE === "test"` fork meant the
// regression suite exercised the retired Legacy page while customers got V2,
// so the shipped funnel had ZERO coverage. V2 is now tested directly
// (TireFinderV2.test.tsx); the legacy page is kept as a byte-for-byte
// rollback + the home of the shared OrderModal, and its own regressions
// import TireFinderLegacy explicitly.
import TireFinderV2 from "./TireFinderV2";
import { OrderModal } from "@/components/order/TireOrderModal";

export { OrderModal };
export default TireFinderV2;
