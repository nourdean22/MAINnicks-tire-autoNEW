import { Suspense, lazy, useEffect } from "react";
import EmergencyMode from "./components/EmergencyMode";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useLocation, Redirect } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { captureUtmParams } from "@/lib/utm";
import { initCwvCollector } from "@/lib/cwv";
import { NEIGHBORHOODS } from "@shared/neighborhoods";
import { TIRE_SIZE_PAGES } from "@shared/tireSizes";
// VEHICLE_SERVICE_PAGES removed 2026-04-24 per T5 audit
import { SkipToContent } from "@/components/SEO";
// 2026-05-19 · QuickAccessDock deleted · superseded by the unified
// SiteMobileCTA bar (mounted via PageLayout) which now carries CALL ·
// TEXT · DIRECTIONS at thumb height. The dock was floating pills that
// competed with the bar.
// @vercel/analytics removed — this runs on Railway, not Vercel

// ─── LOADING FALLBACK ─────────────────────────────────
function PageLoader() {
  return (
    <div className="min-h-screen bg-nick-dark flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-nick-yellow border-t-transparent rounded-full animate-spin" />
        <span className="text-[#A0A0A0] text-sm tracking-wider">
          LOADING...
        </span>
      </div>
    </div>
  );
}

// ─── LAZY PAGE IMPORTS ────────────────────────────────
// Critical path: Home loads eagerly for fastest FCP
import Home from "./pages/Home";

// All other pages load on demand
// ServicePage (1,173 LOC generic template) deleted 2026-04-24 per
// service-page consolidation. Long-tail services now use GenericServicePage
// which reads shared/services.ts and renders via FocusedServicePage.
const GenericServicePage = lazy(() => import("./pages/GenericServicePage"));
const Admin = lazy(() => import("./pages/Admin"));

const AdminAdStudio = lazy(() => import("./pages/admin/AdStudio"));
const Blog = lazy(() => import("./pages/Blog"));
const BlogPost = lazy(() => import("./pages/BlogPost"));
const Contact = lazy(() => import("./pages/Contact"));
const About = lazy(() => import("./pages/About"));
const CityPage = lazy(() => import("./pages/CityPage"));
const FAQ = lazy(() => import("./pages/FAQ"));
const SeasonalPage = lazy(() => import("./pages/SeasonalPage"));
// SEOServicePage deleted 2026-04-24 — /*-cleveland alias URLs now
// 301-redirect server-side to canonical service URLs. See redirects.ts.
// VehicleMakePage removed 2026-04-24 per T5 audit
const ProblemPage = lazy(() => import("./pages/ProblemPage"));
const ReviewsPage = lazy(() => import("./pages/ReviewsPage"));
const DiagnosePage = lazy(() => import("./pages/DiagnosePage"));
const SpecialsPage = lazy(() => import("./pages/SpecialsPage"));
const MyGaragePage = lazy(() => import("./pages/MyGaragePage"));
const ReferralPage = lazy(() => import("./pages/ReferralPage"));
const AskMechanicPage = lazy(() => import("./pages/AskMechanicPage"));
const CarCareGuidePage = lazy(() => import("./pages/CarCareGuidePage"));
// wave-181.38: ReviewPage merged into ReviewsPage. /review now redirects.
const StatusTracker = lazy(() => import("./pages/StatusTracker"));
const PriceEstimator = lazy(() => import("./pages/PriceEstimator"));
const LaborEstimator = lazy(() => import("./pages/LaborEstimator"));
const InspectionReport = lazy(() => import("./pages/InspectionReport"));
const Fleet = lazy(() => import("./pages/Fleet"));
const Financing = lazy(() => import("./pages/Financing"));
const Loyalty = lazy(() => import("./pages/Loyalty"));
const CustomerPortal = lazy(() => import("./pages/CustomerPortal"));
const TireFinder = lazy(() => import("./pages/TireFinder"));
const ServicesOverview = lazy(() => import("./pages/ServicesOverview"));
const AlignmentPage = lazy(() => import("./pages/AlignmentPage"));
const SyntheticOilChangePage = lazy(() => import("./pages/SyntheticOilChangePage"));
const BrakeRepairPage = lazy(() => import("./pages/BrakeRepairPage"));
// wave-181.5 · keyword-led SERP-fix pages (competitor-analyzer findings)
const NoCreditCheckTiresPage = lazy(() => import("./pages/NoCreditCheckTiresPage"));
const TireShopOpenSundayPage = lazy(() => import("./pages/TireShopOpenSundayPage"));
// wave-181.7 · keyword-led SERP-fix pages (Ahrefs/GSC audit moves #5, #6)
const TireRepairPage = lazy(() => import("./pages/TireRepairPage"));
const WheelAlignmentClevelandPage = lazy(() => import("./pages/WheelAlignmentClevelandPage"));
const DiagnosticsPage = lazy(() => import("./pages/DiagnosticsPage"));
const CheckEngineLightDiagnosticPage = lazy(() => import("./pages/CheckEngineLightDiagnosticPage"));
const UsedTiresClevelandPage = lazy(() => import("./pages/UsedTiresClevelandPage"));
const NewTiresClevelandPage = lazy(() => import("./pages/NewTiresClevelandPage"));
const TireBrandPage = lazy(() => import("./pages/TireBrandPage"));
const TireShopNearMePage = lazy(() => import("./pages/TireShopNearMePage"));
const NonstopNickPage = lazy(() => import("./pages/NonstopNickPage"));
const AutoRepairNearMePage = lazy(() => import("./pages/AutoRepairNearMePage"));
const TrackJob = lazy(() => import("./pages/TrackJob"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const Terms = lazy(() => import("./pages/Terms"));
const NotFound = lazy(() => import("./pages/NotFound"));

// ─── Phase 5 Pages ──────────────────────────────────
const CostEstimator = lazy(() => import("./pages/CostEstimator"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const SharePage = lazy(() => import("./pages/SharePage"));
const NeighborhoodPage = lazy(() => import("./pages/NeighborhoodPage"));
// 2026-05-19 · IntersectionPage DELETED · 154 orphan SEO pages with 0
// schema, 1 inbound link, and 3-way keyword cannibalization with the
// City + Neighborhood templates. Audit-confirmed structural dead weight.
// Restore from git history at wave-181.97 if rankings drop signal real value.
const Careers = lazy(() => import("./pages/Careers"));
const BookingPage = lazy(() => import("./pages/BookingPage"));
const GuidesIndex = lazy(() => import("./pages/GuidesIndex"));
const GuidePage = lazy(() => import("./pages/GuidePage"));
const AreasServed = lazy(() => import("./pages/AreasServed"));
const SiteMap = lazy(() => import("./pages/SiteMap"));
const PayInvoice = lazy(() => import("./pages/PayInvoice"));
const TireSizePage = lazy(() => import("./pages/TireSizePage"));
// VehicleServicePage removed 2026-04-24 per T5 audit
const WomensSafetyPage = lazy(() => import("./pages/WomensSafetyPage"));
// Bridge page for legacy "Moe's Tire" brand traffic on Euclid Ave (GSC-driven, May 2026)
const MoesTireBridgePage = lazy(() => import("./pages/MoesTireBridgePage"));
// Sunday muffler/exhaust niche capture (GSC-driven, May 2026)
const SundayMufflerPage = lazy(() => import("./pages/SundayMufflerPage"));

const Warranties = lazy(() => import("./pages/Warranties"));
const TireRebates = lazy(() => import("./pages/TireRebates"));
const TireStorage = lazy(() => import("./pages/TireStorage"));
const Wheels = lazy(() => import("./pages/Wheels"));
const HybridEvRepair = lazy(() => import("./pages/HybridEvRepair"));

// 2026-05-06 wave-33 · Competitor comparison pages (high-intent
// SEO capture for "[chain] alternative" + "vs" + roundup searches).
// Honest comparisons in brand voice; FAQPage + LocalBusiness schema
// on every page for AI-search citation.
const ConradsAlternative = lazy(() => import("./pages/compare/ConradsAlternative"));
const MavisAlternative = lazy(() => import("./pages/compare/MavisAlternative"));
const DiscountTireAlternative = lazy(() => import("./pages/compare/DiscountTireAlternative"));
const FirestoneAlternative = lazy(() => import("./pages/compare/FirestoneAlternative"));
const MonroAlternative = lazy(() => import("./pages/compare/MonroAlternative"));
const BigOAlternative = lazy(() => import("./pages/compare/BigOAlternative"));
const NtbAlternative = lazy(() => import("./pages/compare/NtbAlternative"));
const NicksVsConrads = lazy(() => import("./pages/compare/NicksVsConrads"));
const NicksVsMavis = lazy(() => import("./pages/compare/NicksVsMavis"));
const NicksVsFirestone = lazy(() => import("./pages/compare/NicksVsFirestone"));
const BestTireShopsCleveland = lazy(() => import("./pages/compare/BestTireShopsCleveland"));
const BestConradsAlternativesCleveland = lazy(() => import("./pages/compare/BestConradsAlternativesCleveland"));
const ConradsVsMavis = lazy(() => import("./pages/compare/ConradsVsMavis"));
const FirestoneVsDiscountTire = lazy(() => import("./pages/compare/FirestoneVsDiscountTire"));
const CompareHub = lazy(() => import("./pages/compare/CompareHub"));

function Router() {
  const [location, setLocation] = useLocation();

  // Normalize URL path to lowercase — wouter is case-sensitive so /ADMIN
  // wouldn't match /admin. Redirect uppercase paths to their lowercase
  // equivalents while preserving query string.
  useEffect(() => {
    const [path] = location.split("?");
    if (path !== path.toLowerCase()) {
      const lowerPath = path.toLowerCase();
      const search = typeof window !== "undefined" ? window.location.search : "";
      setLocation(lowerPath + search, { replace: true });
    }
  }, [location, setLocation]);

  return (
    // PSI fix (2026-05-31, trace-measured) · initial={false} suppresses the
    // enter animation on the FIRST render only. Without it, on hydration
    // framer applies this motion.div's initial={opacity:0,y:10} — hiding the
    // already-painted prerendered content, then fading it back in. That threw
    // away the prerender's LCP win: measured mobile LCP was 2707ms, 99.7% of
    // it "render delay" (TTFB was 9ms), because Chrome recorded LCP at the
    // post-hydration re-show, not the 9ms prerender paint. The y:10 translate
    // was also the top forced-reflow source (793ms in vendor-react). Route
    // TRANSITIONS still animate — initial={false} only affects first mount.
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
      >
        <Suspense fallback={<PageLoader />}>
          <Switch>
            <Route path={"/"} component={Home} />
            {/* Services overview page */}
            <Route path={"/services"} component={ServicesOverview} />
            {/* Individual service pages for SEO */}
            <Route path={"/tires"} component={TireFinder} />
            {/* High-traffic / bespoke pages (hand-written copy + config) */}
            <Route path={"/brakes"} component={BrakeRepairPage} />
            <Route path={"/no-credit-check-tires-cleveland"} component={NoCreditCheckTiresPage} />
            <Route path={"/tire-shop-open-sunday-cleveland"} component={TireShopOpenSundayPage} />
            <Route path={"/tire-repair-cleveland"} component={TireRepairPage} />
            <Route path={"/wheel-alignment-cleveland"} component={WheelAlignmentClevelandPage} />
            <Route path={"/diagnostics"} component={DiagnosticsPage} />
            {/* v1.7 Grounded&Reliable strategy · diagnostic-authority silo */}
            <Route path={"/check-engine-light-diagnostic"} component={CheckEngineLightDiagnosticPage} />
            {/* High-volume tire-intent silos — used vs new buyer journeys */}
            <Route path={"/used-tires-cleveland"} component={UsedTiresClevelandPage} />
            <Route path={"/new-tires-cleveland"} component={NewTiresClevelandPage} />
            {/* Legacy-brand bridge page — captures "Moe's Tire" search traffic
                from the previous occupant of 17625 Euclid Ave. ~200 imps/yr. */}
            <Route path={"/moes-tire-euclid"} component={MoesTireBridgePage} />
            <Route path={"/moes-tire"} component={MoesTireBridgePage} />
            <Route path={"/moes-tires"} component={MoesTireBridgePage} />
            <Route path={"/moes-auto"} component={MoesTireBridgePage} />
            {/* Sunday-niche capture — "muffler shop open on sunday" GSC pos 3.7, 20% CTR */}
            <Route path={"/muffler-shop-open-sunday-cleveland"} component={SundayMufflerPage} />
            <Route path={"/muffler-shop-sunday"} component={SundayMufflerPage} />
            <Route path={"/sunday-mechanic-cleveland"} component={SundayMufflerPage} />
            {/* Tire-brand silos — single template (TireBrandPage) reading shared/tireBrands.ts */}
            <Route path={"/michelin-tires-cleveland"} component={TireBrandPage} />
            <Route path={"/goodyear-tires-cleveland"} component={TireBrandPage} />
            <Route path={"/bridgestone-tires-cleveland"} component={TireBrandPage} />
            <Route path={"/firestone-tires-cleveland"} component={TireBrandPage} />
            <Route path={"/continental-tires-cleveland"} component={TireBrandPage} />
            <Route path={"/tire-shop-near-me"} component={TireShopNearMePage} />
            <Route path={"/nonstop-nick"} component={NonstopNickPage} />
            <Route path={"/auto-repair-near-me"} component={AutoRepairNearMePage} />
            {/* /general-repair INTENTIONALLY routes to AutoRepairNearMePage,
                not GenericServicePage. AutoRepairNearMePage targets the
                "auto repair near me" / "mechanic near me" SEO cluster
                (~5,400 monthly impressions) and explicitly replaced
                /general-repair as the landing for that intent. The
                canonical `general-repair` entry in shared/services.ts
                exists to feed Home.tsx + ServicesOverview metadata, but
                the rendered detail page is the near-me variant. */}
            <Route path={"/general-repair"} component={AutoRepairNearMePage} />
            {/* Long-tail services — GenericServicePage reads shared/services.ts */}
            <Route path={"/oil-change"} component={GenericServicePage} />
            <Route path={"/emissions"} component={GenericServicePage} />
            <Route path={"/ac-repair"} component={GenericServicePage} />
            <Route path={"/transmission"} component={GenericServicePage} />
            <Route path={"/electrical"} component={GenericServicePage} />
            <Route path={"/battery"} component={GenericServicePage} />
            <Route path={"/exhaust"} component={GenericServicePage} />
            <Route path={"/cooling"} component={GenericServicePage} />
            <Route path={"/pre-purchase-inspection"} component={GenericServicePage} />
            <Route path={"/belts-hoses"} component={GenericServicePage} />
            <Route path={"/starter-alternator"} component={GenericServicePage} />
            <Route path={"/alignment"} component={AlignmentPage} />
            <Route path={"/synthetic-oil-change"} component={SyntheticOilChangePage} />
            <Route path={"/warranties"} component={Warranties} />
            <Route path={"/tire-rebates"} component={TireRebates} />
            <Route path={"/tire-storage"} component={TireStorage} />
            <Route path={"/wheels"} component={Wheels} />
            <Route path={"/hybrid-ev-repair"} component={HybridEvRepair} />
            {/* Booking / Appointment */}
            <Route path={"/appointment"} component={BookingPage} />
            <Route path={"/booking"} component={BookingPage} />
            {/* Standalone pages */}
            <Route path={"/contact"} component={Contact} />
            <Route path={"/about"} component={About} />
            {/* Admin dashboard */}
            <Route path={"/admin"} component={Admin} />
            <Route path={"/admin/content"}>{() => <Redirect to="/admin?tab=content" />}</Route>
            {/* 2026-07-11 · was ?tab=instagram — not a registry id OR alias,
                so both studio buttons landed on Overview. The Instagram
                studio lives at growth → inner tab "instagram". */}
            <Route path={"/admin/ig-studio"}>{() => <Redirect to="/admin?tab=growth&growthTab=instagram" />}</Route>
            <Route path={"/admin/reel-studio"}>{() => <Redirect to="/admin?tab=growth&growthTab=instagram" />}</Route>
            <Route path={"/admin/ad-studio"} component={AdminAdStudio} />
            {/* City-specific landing pages for local SEO */}
            <Route path={"/cleveland-auto-repair"} component={CityPage} />
            <Route path={"/euclid-auto-repair"} component={CityPage} />
            <Route path={"/lakewood-auto-repair"} component={CityPage} />
            <Route path={"/parma-auto-repair"} component={CityPage} />
            <Route path={"/parma-heights-auto-repair"} component={CityPage} />
            <Route path={"/east-cleveland-auto-repair"} component={CityPage} />
            <Route path={"/shaker-heights-auto-repair"} component={CityPage} />
            <Route
              path={"/cleveland-heights-auto-repair"}
              component={CityPage}
            />
            <Route path={"/mentor-auto-repair"} component={CityPage} />
            <Route path={"/strongsville-auto-repair"} component={CityPage} />
            <Route path={"/south-euclid-auto-repair"} component={CityPage} />
            <Route
              path={"/garfield-heights-auto-repair"}
              component={CityPage}
            />
            <Route
              path={"/richmond-heights-auto-repair"}
              component={CityPage}
            />
            <Route path={"/lyndhurst-auto-repair"} component={CityPage} />
            <Route path={"/willoughby-auto-repair"} component={CityPage} />
            <Route path={"/maple-heights-auto-repair"} component={CityPage} />
            <Route path={"/bedford-auto-repair"} component={CityPage} />
            <Route
              path={"/warrensville-heights-auto-repair"}
              component={CityPage}
            />
            {/* v1.7 audit fix · these 3 city URLs were declared in
                shared/routes.ts (priority 0.8, prerender:true) and have
                full data in shared/cities.ts, but App.tsx had no Route
                wiring — they fell through to <Route component={NotFound}>
                and rendered "Page Not Found" titles. Production was
                serving 404 to Google + customers for these high-intent
                URLs. CityPage uses useRoute("/:slug") to look up
                cities.ts so no other changes needed. */}
            <Route path={"/beachwood-auto-repair"} component={CityPage} />
            <Route
              path={"/mayfield-heights-auto-repair"}
              component={CityPage}
            />
            <Route
              path={"/university-heights-auto-repair"}
              component={CityPage}
            />
            {/* Seasonal landing pages */}
            <Route
              path={"/winter-car-care-cleveland"}
              component={SeasonalPage}
            />
            <Route
              path={"/summer-car-care-cleveland"}
              component={SeasonalPage}
            />
            {/* /*-cleveland SEO aliases now 301-redirect server-side to
                canonical URLs. See server/_core/redirects.ts for the full
                list. Previously each rendered a slight variant of the
                service page, splitting Google rank juice. Consolidation
                now means /brakes etc. get the full rank signal. */}
            {/* Vehicle make pages removed 2026-04-24 per T5 audit */}
            {/* Problem-specific pages */}
            <Route
              path={"/car-shaking-while-driving"}
              component={ProblemPage}
            />
            <Route path={"/brakes-grinding"} component={ProblemPage} />
            <Route
              path={"/check-engine-light-flashing"}
              component={ProblemPage}
            />
            <Route path={"/car-overheating"} component={ProblemPage} />
            <Route path={"/car-wont-start"} component={ProblemPage} />
            <Route path={"/steering-wheel-shaking"} component={ProblemPage} />
            <Route path={"/car-pulling-to-one-side"} component={ProblemPage} />
            <Route path={"/transmission-slipping"} component={ProblemPage} />
            <Route path={"/ac-not-blowing-cold"} component={ProblemPage} />
            <Route path={"/battery-keeps-dying"} component={ProblemPage} />
            <Route path={"/oil-leak-under-car"} component={ProblemPage} />
            <Route
              path={"/grinding-noise-when-braking"}
              component={ProblemPage}
            />
            <Route path={"/check-engine-light-on"} component={ProblemPage} />
            {/* Reviews page */}
            <Route path={"/reviews"} component={ReviewsPage} />
            {/* Diagnostic tool */}
            <Route path={"/diagnose"} component={DiagnosePage} />
            {/* Specials & Coupons */}
            <Route path={"/specials"} component={SpecialsPage} />
            {/* My Garage */}
            <Route path={"/my-garage"} component={MyGaragePage} />
            {/* Referral Program */}
            <Route path={"/refer"} component={ReferralPage} />
            {/* Ask a Mechanic */}
            <Route path={"/ask"} component={AskMechanicPage} />
            {/* Car Care Guide */}
            <Route path={"/car-care-guide"} component={CarCareGuidePage} />
            {/* wave-181.38 · /review merged into /reviews — redirect for bookmarks/old links */}
            <Route path={"/review"}>{() => <Redirect to="/reviews" />}</Route>
            {/* Status Tracker */}
            <Route path={"/status"} component={StatusTracker} />
            <Route path={"/track"} component={TrackJob} />
            {/* Price Estimator */}
            <Route path={"/pricing"} component={PriceEstimator} />
            <Route path={"/estimate"} component={LaborEstimator} />
            {/* Digital Inspection Reports */}
            <Route path={"/inspection/:token"} component={InspectionReport} />
            {/* Fleet & Commercial */}
            <Route path={"/fleet"} component={Fleet} />
            {/* Financing */}
            <Route path={"/financing"} component={Financing} />
            {/* Loyalty Rewards */}
            <Route path={"/rewards"} component={Loyalty} />
            {/* Customer Portal */}
            <Route path={"/portal"} component={CustomerPortal} />
            {/* Tire Info (service page) */}
            <Route path={"/tires/info"} component={GenericServicePage} />
            {/* Tire size pages (30 pages — programmatic SEO) */}
            <Route path={"/tires/:size"} component={TireSizePage} />
            {/* FAQ page */}
            <Route path={"/faq"} component={FAQ} />
            {/* Blog / Tips */}
            <Route path={"/blog"} component={Blog} />
            <Route path={"/blog/:slug"} component={BlogPost} />
            {/* Guides */}
            <Route path={"/guides"} component={GuidesIndex} />
            <Route path={"/guides/:slug"} component={GuidePage} />
            {/* Phase 5: Cost Estimator */}
            <Route path={"/cost-estimator"} component={CostEstimator} />
            {/* Phase 5: Google Ads Landing Pages (no nav, conversion-only) */}
            <Route path={"/lp/brakes"} component={LandingPage} />
            <Route path={"/lp/tires"} component={LandingPage} />
            <Route path={"/lp/diagnostics"} component={LandingPage} />
            <Route path={"/lp/emergency"} component={LandingPage} />
            {/* Phase 5: Share My Repair card */}
            <Route path={"/share/:token"} component={SharePage} />
            {/* Areas Served hub — links to all city/neighborhood/intersection pages */}
            <Route path={"/areas-served"} component={AreasServed} />
            <Route path={"/site-map"} component={SiteMap} />
            <Route path={"/pay"} component={PayInvoice} />
            {/* Vehicle+service combo pages removed 2026-04-24 per T5 audit */}
            {/* Neighborhood micro-pages — dynamic from NEIGHBORHOODS data (61 pages) */}
            {NEIGHBORHOODS.map(n => (
              <Route
                key={n.slug}
                path={`/${n.slug}`}
                component={NeighborhoodPage}
              />
            ))}
            {/* 2026-05-19 · /near/:slug route DELETED · see lazy-import
                comment above. AreasServed page no longer renders the
                intersection grid. */}
            {/* Careers */}
            <Route path={"/careers"} component={Careers} />
            {/* Women's Safety & Pit Stop Experience */}
            <Route path={"/womens-safety"} component={WomensSafetyPage} />
            {/* Legal pages */}
            <Route path={"/privacy-policy"} component={PrivacyPolicy} />
            <Route path={"/terms"} component={Terms} />
            {/* 2026-05-06 wave-33 · 14 competitor comparison pages */}
            <Route path={"/conrads-tire-alternative-cleveland"} component={ConradsAlternative} />
            <Route path={"/mavis-tire-alternative-cleveland"} component={MavisAlternative} />
            <Route path={"/discount-tire-alternative-cleveland"} component={DiscountTireAlternative} />
            <Route path={"/firestone-alternative-cleveland"} component={FirestoneAlternative} />
            <Route path={"/monro-mr-tire-alternative-cleveland"} component={MonroAlternative} />
            <Route path={"/big-o-tires-alternative-cleveland"} component={BigOAlternative} />
            <Route path={"/ntb-alternative-cleveland"} component={NtbAlternative} />
            <Route path={"/nicks-tire-vs-conrads-cleveland"} component={NicksVsConrads} />
            <Route path={"/nicks-tire-vs-mavis-cleveland"} component={NicksVsMavis} />
            <Route path={"/nicks-tire-vs-firestone-cleveland"} component={NicksVsFirestone} />
            <Route path={"/best-tire-shops-cleveland"} component={BestTireShopsCleveland} />
            <Route path={"/best-conrads-tire-alternatives-cleveland"} component={BestConradsAlternativesCleveland} />
            <Route path={"/conrads-vs-mavis-tire-cleveland"} component={ConradsVsMavis} />
            <Route path={"/firestone-vs-discount-tire-cleveland"} component={FirestoneVsDiscountTire} />
            <Route path={"/compare"} component={CompareHub} />

            <Route path={"/404"} component={NotFound} />
            {/* Final fallback route */}
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
}

function App() {
  // Capture UTM params on first load for attribution
  useEffect(() => {
    captureUtmParams();
    // Core Web Vitals real-user telemetry → /api/cwv → admin report
    initCwvCollector();
  }, []);

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        <TooltipProvider>
          <SkipToContent />
          <Toaster />
          <Router />
          <EmergencyMode />
          {/* Analytics removed — runs on Railway, not Vercel */}
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
