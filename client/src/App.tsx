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
