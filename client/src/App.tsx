import { Suspense, lazy, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { captureUtmParams } from "@/lib/utm";

// ─── LOADING FALLBACK ─────────────────────────────────
function PageLoader() {
  return (
    <div className="min-h-screen bg-nick-dark flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-nick-yellow border-t-transparent rounded-full animate-spin" />
        <span className="text-foreground/50 text-sm tracking-wider">LOADING...</span>
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
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const Terms = lazy(() => import("./pages/Terms"));
const NotFound = lazy(() => import("./pages/NotFound"));

function Router() {
  return (
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
        {/* Standalone pages */}
        <Route path={"/contact"} component={Contact} />
        <Route path={"/about"} component={About} />
        {/* Admin dashboard */}
        <Route path={"/admin"} component={Admin} />
        <Route path={"/admin/content"} component={AdminContent} />
        {/* City-specific landing pages for local SEO */}
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
        {/* FAQ page */}
        <Route path={"/faq"} component={FAQ} />
        {/* Blog / Tips */}
        <Route path={"/blog"} component={Blog} />
        <Route path={"/blog/:slug"} component={BlogPost} />
        {/* Legal pages */}
        <Route path={"/privacy-policy"} component={PrivacyPolicy} />
        <Route path={"/terms"} component={Terms} />
        <Route path={"/404"} component={NotFound} />
        {/* Final fallback route */}
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  // Capture UTM params on first load for attribution
  useEffect(() => {
    captureUtmParams();
  }, []);

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
