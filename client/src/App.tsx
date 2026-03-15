import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import ServicePage from "./pages/ServicePage";
import Admin from "./pages/Admin";
import Blog from "./pages/Blog";
import BlogPost from "./pages/BlogPost";

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
      {/* Admin dashboard */}
      <Route path={"/admin"} component={Admin} />
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
