import { Suspense, lazy, useEffect, useRef } from "react";
import EmergencyMode from "./components/EmergencyMode";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { captureUtmParams } from "@/lib/utm";
import { captureAttribution } from "@/lib/attribution";
import ExitIntentPopup from "./components/ExitIntentPopup";
import { useWebVitals } from "@/hooks/useWebVitals";
import RouteAnnouncer from "@/components/RouteAnnouncer";
import CookieConsent from "@/components/CookieConsent";
import { initConsent, onConsentChange, hasConsent } from "@/lib/consent-manager";
import { initGA4, trackPageView } from "@/lib/ga4";
import { installErrorHandlers, addBreadcrumb } from "@/lib/error-tracker";

// ─── LOADING FALLBACK ─────────────────────────────────
function PageLoader() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-[#FDB913] border-t-transparent rounded-full animate-spin" />
        <span className="text-[#A0A0A0] text-sm tracking-wider">LOADING...</span>
      </div>
    </div>
  );
}

// ─── LAZY PAGE IMPORTS ────────────────────────────────
// Critical path: Home loads eagerly for fastest FCP
import Home from "./pages/Home";

// All other pages load on demand
const ServicePage = lazy(() => import("./pages/ServicePage"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminContent = lazy(() => import("./pages/AdminContent"));
const Blog = lazy(() => import("./pages/Blog"));
const BlogPost = lazy(() => import("./pages/BlogPost"));
const Contact = lazy(() => import("./pages/Contact"));
const About = lazy(() => import("./pages/About"));
const CityPage = lazy(() => import("./pages/CityPage"));
const FAQ = lazy(() => import("./pages/FAQ"));
const SeasonalPage = lazy(() => import("./pages/SeasonalPage"));
const SEOServicePage = lazy(() => import("./pages/SEOServicePage"));
const IntersectionPage = lazy(() => import("./pages/IntersectionPage"));
const TrackOrder = lazy(() => import("./pages/TrackOrder"));
const ServiceCityPage = lazy(() => import("./pages/ServiceCityPage"));
const VehicleMakePage = lazy(() => import("./pages/VehicleMakePage"));
const ProblemPage = lazy(() => import("./pages/ProblemPage"));
const ReviewsPage = lazy(() => import("./pages/ReviewsPage"));
const DiagnosePage = lazy(() => import("./pages/DiagnosePage"));
const SpecialsPage = lazy(() => import("./pages/SpecialsPage"));
const MyGaragePage = lazy(() => import("./pages/MyGaragePage"));
const ReferralPage = lazy(() => import("./pages/ReferralPage"));
const AskMechanicPage = lazy(() => import("./pages/AskMechanicPage"));
const CarCareGuidePage = lazy(() => import("./pages/CarCareGuidePage"));
const ReviewPage = lazy(() => import("./pages/ReviewPage"));
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
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const Terms = lazy(() => import("./pages/Terms"));
const NotFound = lazy(() => import("./pages/NotFound"));
const ControlCenter = lazy(() => import("./pages/ControlCenter"));

// ─── Phase 5 Pages ──────────────────────────────────
const CostEstimator = lazy(() => import("./pages/CostEstimator"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const SharePage = lazy(() => import("./pages/SharePage"));
const NeighborhoodPage = lazy(() => import("./pages/NeighborhoodPage"));
const InstantQuote = lazy(() => import("./pages/InstantQuote"));
const TireSizePage = lazy(() => import("./pages/TireSizePage"));
const CareersPage = lazy(() => import("./pages/CareersPage"));
const AppointmentPage = lazy(() => import("./pages/AppointmentPage"));

function Router() {
  const [location] = useLocation();

  return (
    <AnimatePresence mode="wait">
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
        <Route path={"/brakes"} component={ServicePage} />
        <Route path={"/diagnostics"} component={ServicePage} />
        <Route path={"/emissions"} component={ServicePage} />
        <Route path={"/oil-change"} component={ServicePage} />
        <Route path={"/general-repair"} component={ServicePage} />
        <Route path={"/ac-repair"} component={ServicePage} />
        <Route path={"/transmission"} component={ServicePage} />
        <Route path={"/electrical"} component={ServicePage} />
        <Route path={"/battery"} component={ServicePage} />
        <Route path={"/exhaust"} component={ServicePage} />
        <Route path={"/cooling"} component={ServicePage} />
        <Route path={"/pre-purchase-inspection"} component={ServicePage} />
        <Route path={"/belts-hoses"} component={ServicePage} />
        <Route path={"/starter-alternator"} component={ServicePage} />
        <Route path={"/alignment"} component={AlignmentPage} />
        {/* Standalone pages */}
        <Route path={"/contact"} component={Contact} />
        <Route path={"/about"} component={About} />
        {/* Admin dashboard */}
        <Route path={"/admin"} component={Admin} />
        <Route path={"/admin/content"} component={AdminContent} />
        <Route path={"/admin/control-center"} component={ControlCenter} />
        {/* City-specific landing pages for local SEO */}
        <Route path={"/cleveland-auto-repair"} component={CityPage} />
        <Route path={"/euclid-auto-repair"} component={CityPage} />
        <Route path={"/lakewood-auto-repair"} component={CityPage} />
        <Route path={"/parma-auto-repair"} component={CityPage} />
        <Route path={"/east-cleveland-auto-repair"} component={CityPage} />
        <Route path={"/shaker-heights-auto-repair"} component={CityPage} />
        <Route path={"/cleveland-heights-auto-repair"} component={CityPage} />
        <Route path={"/mentor-auto-repair"} component={CityPage} />
        <Route path={"/strongsville-auto-repair"} component={CityPage} />
        <Route path={"/south-euclid-auto-repair"} component={CityPage} />
        <Route path={"/garfield-heights-auto-repair"} component={CityPage} />
        <Route path={"/richmond-heights-auto-repair"} component={CityPage} />
        <Route path={"/lyndhurst-auto-repair"} component={CityPage} />
        <Route path={"/willoughby-auto-repair"} component={CityPage} />
        <Route path={"/maple-heights-auto-repair"} component={CityPage} />
        <Route path={"/bedford-auto-repair"} component={CityPage} />
        <Route path={"/warrensville-heights-auto-repair"} component={CityPage} />
        <Route path={"/parma-heights-auto-repair"} component={CityPage} />
        <Route path={"/wickliffe-auto-repair"} component={CityPage} />
        {/* Intersection SEO pages */}
        <Route path={"/near/:slug"} component={IntersectionPage} />
        {/* Real-time job tracker */}
        <Route path={"/track/:orderId"} component={TrackOrder} />
        {/* Seasonal landing pages */}
        <Route path={"/winter-car-care-cleveland"} component={SeasonalPage} />
        <Route path={"/summer-car-care-cleveland"} component={SeasonalPage} />
        {/* Dedicated SEO service pages (long-tail keywords) */}
        <Route path={"/brake-repair-cleveland"} component={SEOServicePage} />
        <Route path={"/check-engine-light-cleveland"} component={SEOServicePage} />
        <Route path={"/tire-repair-cleveland"} component={SEOServicePage} />
        <Route path={"/suspension-repair-cleveland"} component={SEOServicePage} />
        <Route path={"/ac-repair-cleveland"} component={SEOServicePage} />
        <Route path={"/diagnostics-cleveland"} component={SEOServicePage} />
        {/* Vehicle make pages */}
        <Route path={"/toyota-repair-cleveland"} component={VehicleMakePage} />
        <Route path={"/honda-repair-cleveland"} component={VehicleMakePage} />
        <Route path={"/ford-repair-cleveland"} component={VehicleMakePage} />
        <Route path={"/chevy-repair-cleveland"} component={VehicleMakePage} />
        <Route path={"/nissan-repair-cleveland"} component={VehicleMakePage} />
        <Route path={"/hyundai-repair-cleveland"} component={VehicleMakePage} />
        <Route path={"/kia-repair-cleveland"} component={VehicleMakePage} />
        <Route path={"/jeep-repair-cleveland"} component={VehicleMakePage} />
        <Route path={"/bmw-repair-cleveland"} component={VehicleMakePage} />
        <Route path={"/dodge-ram-repair-cleveland"} component={VehicleMakePage} />
        {/* Problem-specific pages */}
        <Route path={"/car-shaking-while-driving"} component={ProblemPage} />
        <Route path={"/brakes-grinding"} component={ProblemPage} />
        <Route path={"/check-engine-light-flashing"} component={ProblemPage} />
        <Route path={"/car-overheating"} component={ProblemPage} />
        <Route path={"/car-wont-start"} component={ProblemPage} />
        <Route path={"/steering-wheel-shaking"} component={ProblemPage} />
        <Route path={"/car-pulling-to-one-side"} component={ProblemPage} />
        <Route path={"/transmission-slipping"} component={ProblemPage} />
        <Route path={"/ac-not-blowing-cold"} component={ProblemPage} />
        <Route path={"/battery-keeps-dying"} component={ProblemPage} />
        <Route path={"/oil-leak-under-car"} component={ProblemPage} />
        <Route path={"/grinding-noise-when-braking"} component={ProblemPage} />
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
        {/* Review Generation */}
        <Route path={"/review"} component={ReviewPage} />
        {/* Status Tracker */}
        <Route path={"/status"} component={StatusTracker} />
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
        <Route path={"/tires/info"} component={ServicePage} />
        {/* Tire size SEO pages */}
        <Route path={"/tires/:size"} component={TireSizePage} />
        {/* FAQ page */}
        <Route path={"/faq"} component={FAQ} />
        {/* Blog / Tips */}
        <Route path={"/blog"} component={Blog} />
        <Route path={"/blog/:slug"} component={BlogPost} />
        {/* Phase 5: Cost Estimator */}
        <Route path={"/cost-estimator"} component={CostEstimator} />
        <Route path={"/instant-quote"} component={InstantQuote} />
        {/* Phase 5: Google Ads Landing Pages (no nav, conversion-only) */}
        <Route path={"/lp/brakes"} component={LandingPage} />
        <Route path={"/lp/tires"} component={LandingPage} />
        <Route path={"/lp/diagnostics"} component={LandingPage} />
        <Route path={"/lp/emergency"} component={LandingPage} />
        {/* Phase 5: Share My Repair card */}
        <Route path={"/share/:token"} component={SharePage} />
        {/* Phase 5: Neighborhood micro-pages (hyper-local SEO) */}
        <Route path={"/east-185th-street-auto-repair"} component={NeighborhoodPage} />
        <Route path={"/euclid-square-mall-area"} component={NeighborhoodPage} />
        <Route path={"/richmond-heights-mechanic"} component={NeighborhoodPage} />
        <Route path={"/collinwood"} component={NeighborhoodPage} />
        <Route path={"/nottingham"} component={NeighborhoodPage} />
        <Route path={"/five-points"} component={NeighborhoodPage} />
        <Route path={"/waterloo-arts-district"} component={NeighborhoodPage} />
        <Route path={"/shore-cultural-centre"} component={NeighborhoodPage} />
        <Route path={"/severance-town-center"} component={NeighborhoodPage} />
        <Route path={"/university-circle"} component={NeighborhoodPage} />
        <Route path={"/wickliffe"} component={NeighborhoodPage} />
        <Route path={"/willowick"} component={NeighborhoodPage} />
        <Route path={"/eastlake"} component={NeighborhoodPage} />
        <Route path={"/south-euclid-mechanic"} component={NeighborhoodPage} />
        <Route path={"/lyndhurst-mechanic"} component={NeighborhoodPage} />
        <Route path={"/mayfield-heights"} component={NeighborhoodPage} />
        <Route path={"/highland-heights"} component={NeighborhoodPage} />
        <Route path={"/beachwood"} component={NeighborhoodPage} />
        {/* Appointments / Booking */}
        <Route path={"/appointment"} component={AppointmentPage} />
        <Route path={"/schedule"} component={AppointmentPage} />
        <Route path={"/book"} component={AppointmentPage} />
        <Route path={"/booking"} component={AppointmentPage} />
        {/* Careers / Apply */}
        <Route path={"/careers"} component={CareersPage} />
        <Route path={"/apply"} component={CareersPage} />
        {/* Legal pages */}
        <Route path={"/privacy-policy"} component={PrivacyPolicy} />
        <Route path={"/terms"} component={Terms} />
        {/* Programmatic SEO: 260 service+city pages (e.g., /tires-euclid-oh) */}
        <Route path={"/:slug"} component={ServiceCityPage} />
        <Route path={"/404"} component={NotFound} />
        {/* Final fallback route */}
        <Route component={NotFound} />
      </Switch>
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
}

/** Load Umami analytics script (consent-gated, called from useEffect) */
let umamiLoaded = false;
function loadUmami() {
  if (umamiLoaded) return;
  const endpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT;
  const websiteId = import.meta.env.VITE_ANALYTICS_WEBSITE_ID;
  if (!endpoint || !websiteId) return;
  umamiLoaded = true;
  const s = document.createElement("script");
  s.defer = true;
  s.src = endpoint;
  s.setAttribute("data-website-id", websiteId);
  document.head.appendChild(s);
}

function App() {
  const [location] = useLocation();
  const prevLocation = useRef(location);

  // Capture UTM params on first load for attribution
  useEffect(() => {
    captureUtmParams();
    captureAttribution();
    installErrorHandlers();
    initConsent();
    // If analytics consent already granted from a previous visit, init GA4 now
    if (hasConsent("analytics")) {
      initGA4();
      loadUmami();
    }
    // Listen for future consent changes
    onConsentChange((state) => {
      if (state.analytics) {
        initGA4();
        loadUmami();
      }
    });
  }, []);

  // Track page views on route change (gated behind consent in ga4.ts)
  useEffect(() => {
    if (location !== prevLocation.current) {
      prevLocation.current = location;
      trackPageView(location);
    }
  }, [location]);

  // Track Core Web Vitals (LCP, CLS, TTFB, INP)
  useWebVitals();

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[9999] focus:bg-[#FDB913] focus:text-black focus:px-4 focus:py-2 focus:rounded"
          >
            Skip to main content
          </a>
          <Toaster />
          <RouteAnnouncer />
          <div id="main-content">
            <Router />
          </div>
          <EmergencyMode />
          {/* Mobile sticky bottom bar — always visible on mobile */}
          <div className="mobile-action-bar md:hidden">
            <a href="tel:2168620005" className="action-call touch-feedback">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
              CALL
            </a>
            <a href="/book" className="action-book touch-feedback">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              BOOK
            </a>
            <a href="tel:2168620005" className="action-emergency touch-feedback">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              SOS
            </a>
          </div>
          <CookieConsent />
          <ExitIntentPopup />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
