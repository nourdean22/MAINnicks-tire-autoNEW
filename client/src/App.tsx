import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import ServicePage from "./pages/ServicePage";
import Admin from "./pages/Admin";
import AdminContent from "./pages/AdminContent";
import Blog from "./pages/Blog";
import BlogPost from "./pages/BlogPost";
import Contact from "./pages/Contact";
import About from "./pages/About";
import CityPage from "./pages/CityPage";
import FAQ from "./pages/FAQ";
import SeasonalPage from "./pages/SeasonalPage";
import SEOServicePage from "./pages/SEOServicePage";
import VehicleMakePage from "./pages/VehicleMakePage";
import ProblemPage from "./pages/ProblemPage";
import ReviewsPage from "./pages/ReviewsPage";
import DiagnosePage from "./pages/DiagnosePage";
import SpecialsPage from "./pages/SpecialsPage";
import MyGaragePage from "./pages/MyGaragePage";
import ReferralPage from "./pages/ReferralPage";
import AskMechanicPage from "./pages/AskMechanicPage";
import CarCareGuidePage from "./pages/CarCareGuidePage";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      {/* Individual service pages for SEO */}
      <Route path={"/tires"} component={ServicePage} />
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
      {/* Problem-specific pages */}
      <Route path={"/car-shaking-while-driving"} component={ProblemPage} />
      <Route path={"/brakes-grinding"} component={ProblemPage} />
      <Route path={"/check-engine-light-flashing"} component={ProblemPage} />
      <Route path={"/car-overheating"} component={ProblemPage} />
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
      {/* FAQ page */}
      <Route path={"/faq"} component={FAQ} />
      {/* Blog / Tips */}
      <Route path={"/blog"} component={Blog} />
      <Route path={"/blog/:slug"} component={BlogPost} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
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
