/**
 * Branded 404 page for Nick's Tire & Auto
 * Matches the site's dark industrial design and provides helpful navigation
 */

import { Link } from "wouter";
import { SEOHead } from "@/components/SEO";
import { Phone, ArrowLeft, Wrench } from "lucide-react";
import { BUSINESS } from "@shared/business";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEOHead
        title="Page Not Found | Nick's Tire & Auto Cleveland"
        description="The page you're looking for doesn't exist. Visit Nick's Tire & Auto for trusted auto repair in Cleveland, Ohio."
        canonicalPath="/404"
      />

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-2xl w-full text-center">
          {/* Big 404 */}
          <div className="relative mb-8">
            <span className="font-bold text-[10rem] sm:text-[14rem] leading-none text-border/30 select-none">
              404
            </span>
            <div className="absolute inset-0 flex items-center justify-center">
              <Wrench className="w-16 h-16 sm:w-24 sm:h-24 text-primary" />
            </div>
          </div>

          <h1 className="font-bold text-3xl sm:text-4xl text-foreground tracking-tight mb-4">
            PAGE NOT FOUND
          </h1>

          <p className="text-foreground/60 text-lg max-w-md mx-auto mb-10 leading-relaxed">
            The page you are looking for may have been moved or no longer exists. Let us help you find what you need.
          </p>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-bold text-sm tracking-wide hover:opacity-90 transition-colors hover:opacity-90 transition-opacity"
            >
              <ArrowLeft className="w-4 h-4" />
              BACK TO HOME
            </Link>
            <a
              href={BUSINESS.phone.href}
              className="inline-flex items-center justify-center gap-2 border-2 border-nick-teal/50 text-nick-teal px-8 py-4 rounded-md font-bold text-sm tracking-wide hover:bg-nick-teal/10 hover:border-nick-teal transition-colors"
              aria-label={`Call Nick's Tire and Auto at ${BUSINESS.phone.dashed}`}
            >
              <Phone className="w-4 h-4" />
              CALL {BUSINESS.phone.display}
            </a>
          </div>

          {/* Quick links */}
          <div className="border-t border-border/50 pt-8">
            <p className="font-heading text-sm tracking-wide text-foreground/40 mb-4">
              POPULAR PAGES
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              {[
                { label: "Tires", href: "/tires" },
                { label: "Brakes", href: "/brakes" },
                { label: "Diagnostics", href: "/diagnostics" },
                { label: "Emissions", href: "/emissions" },
                { label: "Oil Change", href: "/oil-change" },
                { label: "Contact", href: "/contact" },
                { label: "Blog", href: "/blog" },
              ].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="px-4 py-2 bg-card/50 border border-border/50 rounded-md text-sm text-foreground/70 hover:text-primary hover:border-primary/30 transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
