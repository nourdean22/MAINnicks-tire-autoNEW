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
      <SEOHead
        title="Page Not Found | Nick's Tire & Auto Cleveland"
        description="Page not found. Let us help you find what you need. Nick's Tire & Auto — Cleveland's trusted auto repair shop."
        canonicalPath="/404"
      />

      <section className="bg-[#141414] min-h-[80vh] flex items-center justify-center px-4 py-20">
        <FadeIn>
          <div className="text-center max-w-2xl mx-auto">
            {/* Big 404 */}
            <h1 className="font-heading font-bold text-[6rem] md:text-[12rem] leading-none text-[#FDB913] select-none tracking-tight">
              404
            </h1>

            {/* Headline */}
            <h2 className="font-heading text-2xl md:text-3xl font-bold text-white uppercase tracking-wide mt-4">
              This page does not exist.
            </h2>

            {/* Subheadline */}
            <p className="text-white/50 text-lg mt-4 max-w-md mx-auto leading-relaxed">
              Like the muffler on a Civic with a fart can. We're better at finding car problems than missing ones — pull up to the homepage.
            </p>

            {/* CTAs */}
            <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/"
                className="inline-flex items-center justify-center gap-2 bg-[#FDB913] text-black px-8 py-4 rounded-lg font-bold text-sm tracking-wide hover:bg-[#FDB913]/90 transition-colors"
              >
                Go Home
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/diagnose"
                className="inline-flex items-center justify-center gap-2 border-2 border-[#FDB913] text-[#FDB913] px-8 py-4 rounded-lg font-bold text-sm tracking-wide hover:bg-[#FDB913]/10 transition-colors"
              >
                <Wrench className="w-4 h-4" />
                Diagnose My Car
              </Link>
            </div>
          </div>
        </FadeIn>
      </section>
    </PageLayout>
  );
}
