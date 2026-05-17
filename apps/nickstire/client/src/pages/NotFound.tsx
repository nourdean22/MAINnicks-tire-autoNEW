/**
 * Custom 404 Page
 * Dark background, gold "404", clean centered layout.
 */
import { Link } from "wouter";
import PageLayout from "@/components/PageLayout";
import { SEOHead } from "@/components/SEO";
import { ArrowRight, Wrench } from "lucide-react";
import FadeIn from "@/components/FadeIn";

export default function NotFound() {
  return (
    <PageLayout>
      {/* wave-147 — was canonicalPath="/404" + no robots, which let Google
          index a "Page Not Found" page as legitimate content. Now: noindex,
          nofollow + canonical pointing to "/" so any link equity that did
          land here flows back to the homepage. */}
      <SEOHead
        title="Page Not Found | Nick's Tire & Auto Cleveland"
        description="Page not found. Pull up to the homepage. Nick's Tire & Auto — Cleveland auto repair on Euclid Ave."
        canonicalPath="/"
        robots="noindex, nofollow"
      />

      <section className="bg-[#141414] min-h-[80vh] flex items-center justify-center px-4 py-20">
        <FadeIn>
          <div className="text-center max-w-2xl mx-auto">
            {/* Big 404 */}
            <h1 className="font-heading font-bold text-[6rem] md:text-[12rem] leading-none text-[#FDB913] select-none tracking-tight">
              404
            </h1>

            {/* 2026-05-07 wave-46 copy engineering — copywriting-
                psychologist + loss-aversion frame applied. Names the
                friction the user just hit (wrong page = wasted click)
                AND immediately offers two ways to recover (homepage or
                symptom-based diagnose). Concrete + specific + memorable;
                Cleveland-tough register preserved. */}
            <h2 className="font-heading text-2xl md:text-3xl font-bold text-white uppercase tracking-wide mt-4">
              Wrong page. Same shop.
            </h2>

            <p className="text-white/50 text-lg mt-4 max-w-md mx-auto leading-relaxed">
              We can't find this URL. We can probably find what's wrong with your car, though. Pull up to the homepage — or describe your symptom and we'll match it to a likely fix.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/"
                className="group inline-flex items-center justify-center gap-2 bg-[#FDB913] text-black px-8 py-4 rounded-lg font-bold text-sm tracking-wide shadow-[0_4px_20px_rgba(253,185,19,0.35)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-[0_6px_28px_rgba(253,185,19,0.55)] active:scale-[0.98]"
              >
                Pull up to home
                <ArrowRight className="w-4 h-4 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1" />
              </Link>
              <Link
                href="/diagnose"
                className="group inline-flex items-center justify-center gap-2 border-2 border-[#FDB913] text-[#FDB913] px-8 py-4 rounded-lg font-bold text-sm tracking-wide transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#FDB913]/10 active:scale-[0.98]"
              >
                <Wrench className="w-4 h-4 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:rotate-[12deg]" />
                Diagnose my car
              </Link>
            </div>
          </div>
        </FadeIn>
      </section>
    </PageLayout>
  );
}
