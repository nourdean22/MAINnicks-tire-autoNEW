import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { Helmet } from "react-helmet-async";

const POPULAR_SIZES = [
  "205/55R16", "215/60R16", "225/65R17", "235/65R18", "245/60R18",
  "255/55R19", "265/70R17", "275/55R20", "215/55R17", "225/60R18",
];

export default function TireSizePage() {
  const [, params] = useRoute("/tires/:size");
  const rawSize = params?.size ?? "";
  // Convert URL format (225-65r17) back to tire format (225/65R17)
  const tireSize = rawSize.replace(/-/g, "/").replace(/r/i, "R");

  const { data: result, isLoading: loading } = trpc.nourOsQuote.searchTires.useQuery(
    { size: tireSize },
    { enabled: !!tireSize, retry: 1 }
  );
  const tires: any[] = (result as any)?.data?.tires ?? (result as any)?.tires ?? [];

  const title = `${tireSize} Tires in Cleveland | Nick's Tire & Auto`;
  const desc = `Find ${tireSize} tires at the best prices in Cleveland. ${tires.length} options in stock. Free quotes, expert installation. Call (216) 862-0005.`;

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={desc} />
        <link rel="canonical" href={`https://nickstire.org/tires/${rawSize}`} />
      </Helmet>

      <div className="min-h-screen bg-[#0A0A0A] py-12 px-4">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-2">{tireSize} Tires</h1>
          <p className="text-[#A0A0A0] mb-8">
            {tires.length} options available • Professional installation • Cleveland, OH
          </p>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-[#1A1A1A] rounded-xl p-6 animate-pulse h-48" />
              ))}
            </div>
          ) : tires.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                {tires.map((tire: any, i: number) => (
                  <div key={i} className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 hover:border-[#FDB913] transition-colors">
                    <div className="text-xs text-[#FDB913] font-semibold mb-1">{tire.brand}</div>
                    <div className="text-white font-medium mb-2">{tire.model}</div>
                    <div className="text-[#A0A0A0] text-sm mb-4">{tire.size}</div>
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-2xl font-bold text-white">${tire.retailPrice?.toFixed(2)}</div>
                        <div className="text-xs text-[#666]">per tire</div>
                      </div>
                      {tire.inStock && (
                        <span className="text-xs bg-green-900/30 text-green-400 px-2 py-1 rounded-full">In Stock</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <div className="bg-gradient-to-r from-[#FDB913]/10 to-transparent border border-[#FDB913]/30 rounded-xl p-8 text-center">
                <h2 className="text-2xl font-bold text-white mb-2">Ready to Get Your {tireSize} Tires?</h2>
                <p className="text-[#A0A0A0] mb-6">Get an instant quote with installation included.</p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <a href="/instant-quote" className="bg-[#FDB913] text-black font-bold py-3 px-8 rounded-lg hover:bg-[#FDB913]/90 transition">
                    Get Instant Quote
                  </a>
                  <a href="tel:+12168620005" className="border border-[#FDB913] text-[#FDB913] font-bold py-3 px-8 rounded-lg hover:bg-[#FDB913]/10 transition">
                    Call (216) 862-0005
                  </a>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-16">
              <p className="text-[#A0A0A0] text-lg mb-4">No {tireSize} tires found in our current inventory.</p>
              <p className="text-[#666] mb-6">We can special-order any size. Call us for availability!</p>
              <a href="tel:+12168620005" className="bg-[#FDB913] text-black font-bold py-3 px-8 rounded-lg">
                Call for Special Order
              </a>
            </div>
          )}

          {/* Popular sizes cross-link for SEO */}
          <div className="mt-16">
            <h3 className="text-lg font-semibold text-white mb-4">Popular Tire Sizes</h3>
            <div className="flex flex-wrap gap-2">
              {POPULAR_SIZES.filter(s => s !== tireSize).map(size => (
                <a
                  key={size}
                  href={`/tires/${size.replace(/\//g, "-").replace(/R/i, "r")}`}
                  className="bg-[#1A1A1A] text-[#A0A0A0] px-3 py-1.5 rounded-lg text-sm hover:text-[#FDB913] hover:border-[#FDB913] border border-[#2A2A2A] transition"
                >
                  {size}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
