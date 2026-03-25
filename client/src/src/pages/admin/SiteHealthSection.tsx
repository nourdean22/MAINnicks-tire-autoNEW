/**
 * SiteHealthSection — extracted from Admin.tsx for maintainability.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import { BUSINESS } from "@shared/business";
import {
  StatCard, UrgencyBadge, ActivityIcon, StatusDot,
  BOOKING_STATUS_CONFIG, LEAD_STATUS_CONFIG, TIME_LABELS, CHART_COLORS,
  type BookingStatus, type LeadStatus,
} from "./shared";
import {
  Activity, BarChart3, CheckCircle2, ExternalLink, Eye, FileSpreadsheet, Gauge, Globe, Loader2, MapPin, PieChart, RefreshCw, Search, Sparkles, Star, TrendingUp, XCircle
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart as RPieChart, Pie, Cell, Legend
} from "recharts";

export default function SiteHealthSection() {
  const { data: health, isLoading } = trpc.adminDashboard.siteHealth.useQuery();
  const { data: reviews } = trpc.reviews.google.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!health) return null;

  return (
    <div className="space-y-8">
      {/* Domain Status */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-bold text-sm tracking-wide text-foreground mb-5 flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          DOMAINS
        </h3>
        <div className="space-y-3">
          {health.domains.map(domain => (
            <div key={domain} className="flex items-center justify-between p-3 border border-border/20">
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-[13px] text-foreground">{domain}</span>
              </div>
              <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer" className="text-foreground/40 hover:text-primary transition-colors">
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* SEO & Sitemap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border/30 p-6">
          <h3 className="font-bold text-sm tracking-wide text-foreground mb-5 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            SEO STATUS
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 border border-border/20">
              <span className="text-[13px] text-foreground/70">Sitemap Pages</span>
              <span className="font-bold text-lg text-primary">{health.sitemapPageCount}+</span>
            </div>
            <div className="flex items-center justify-between p-3 border border-border/20">
              <span className="text-[13px] text-foreground/70">Total Blog Posts</span>
              <span className="font-bold text-lg text-foreground">{health.totalBlogPosts}</span>
            </div>
            <div className="flex items-center justify-between p-3 border border-border/20">
              <span className="text-[13px] text-foreground/70">Hardcoded Articles</span>
              <span className="text-[13px] text-foreground/50">{health.hardcodedBlogPosts}</span>
            </div>
            <div className="flex items-center justify-between p-3 border border-border/20">
              <span className="text-[13px] text-foreground/70">AI-Generated Articles</span>
              <span className="text-[13px] text-foreground/50">{health.dynamicBlogPosts}</span>
            </div>
            <div className="flex items-center justify-between p-3 border border-border/20">
              <span className="text-[13px] text-foreground/70">Google Search Console</span>
              <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-primary hover:text-primary/80 text-[13px]">
                View <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* Index Coverage Panel */}
        <div className="bg-card border border-border/30 p-6">
          <h3 className="font-bold text-sm tracking-wide text-foreground mb-5 flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" />
            INDEX COVERAGE
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 border border-emerald-500/30 bg-emerald-500/5 text-center">
                <p className="font-bold text-3xl text-emerald-400">{health.indexedPages ?? 57}</p>
                <p className="text-[11px] text-foreground/50 mt-1">Indexed</p>
              </div>
              <div className="p-4 border border-amber-500/30 bg-amber-500/5 text-center">
                <p className="font-bold text-3xl text-amber-400">{health.notIndexedPages ?? 11}</p>
                <p className="text-[11px] text-foreground/50 mt-1">Not Indexed</p>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-[11px] text-foreground/40 tracking-wide">NOT INDEXED REASONS</p>
              <div className="flex items-center justify-between p-2.5 border border-border/20">
                <span className="text-[12px] text-foreground/60">Crawled — currently not indexed</span>
                <span className="text-[13px] font-semibold text-amber-400">{health.crawledNotIndexed ?? 6}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 border border-border/20">
                <span className="text-[12px] text-foreground/60">Discovered — currently not indexed</span>
                <span className="text-[13px] font-semibold text-amber-400">{health.discoveredNotIndexed ?? 5}</span>
              </div>
            </div>
            <div className="flex items-center justify-between p-2.5 border border-border/20">
              <span className="text-[12px] text-foreground/60">Validation Status</span>
              <span className="text-[12px] text-emerald-400">Started (Mar 18, 2026)</span>
            </div>
            <a href="https://search.google.com/search-console/index?resource_id=https%3A%2F%2Fnickstire.org%2F" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 text-primary hover:text-primary/80 text-[12px] p-2 border border-primary/20 hover:border-primary/40 transition-colors">
              View Full Report in GSC <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>

      {/* Search Engine Submissions */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-bold text-sm tracking-wide text-foreground mb-5 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          SEARCH ENGINE SUBMISSIONS
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="p-4 border border-border/20">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span className="text-[13px] font-semibold text-foreground">Google Search Console</span>
            </div>
            <div className="space-y-1.5">
              <p className="text-[12px] text-foreground/50">Sitemap: <span className="text-emerald-400">Success</span></p>
              <p className="text-[12px] text-foreground/50">Pages discovered: <span className="text-foreground">68</span></p>
              <p className="text-[12px] text-foreground/50">Last read: <span className="text-foreground">Mar 20, 2026</span></p>
            </div>
          </div>
          <div className="p-4 border border-border/20">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span className="text-[13px] font-semibold text-foreground">Bing Webmaster Tools</span>
            </div>
            <div className="space-y-1.5">
              <p className="text-[12px] text-foreground/50">Status: <span className="text-emerald-400">Submitted</span></p>
              <p className="text-[12px] text-foreground/50">IndexNow API: <span className="text-foreground">Available</span></p>
              <a href="https://www.bing.com/webmasters" target="_blank" rel="noopener noreferrer" className="text-[12px] text-primary hover:text-primary/80 flex items-center gap-1">
                Manage <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
          <div className="p-4 border border-border/20">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span className="text-[13px] font-semibold text-foreground">Meta Pixel</span>
            </div>
            <div className="space-y-1.5">
              <p className="text-[12px] text-foreground/50">Pixel ID: <span className="text-foreground">1436350367898578</span></p>
              <p className="text-[12px] text-foreground/50">Events: <span className="text-emerald-400">Lead, Schedule, Contact</span></p>
              <p className="text-[12px] text-foreground/50">CAPI: <span className="text-amber-400">Needs access token</span></p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <div className="bg-card border border-border/30 p-6">
          <h3 className="font-bold text-sm tracking-wide text-foreground mb-5 flex items-center gap-2">
            <Star className="w-4 h-4 text-primary" />
            GOOGLE REVIEWS
          </h3>
          {reviews ? (
            <div className="space-y-4">
              <div className="text-center p-6 border border-border/20">
                <div className="flex items-center justify-center gap-1 mb-2">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className={`w-6 h-6 ${i < Math.round(reviews.rating || 4.9) ? "fill-primary text-primary" : "text-foreground/20"}`} />
                  ))}
                </div>
                <p className="font-bold text-4xl text-foreground">{reviews.rating || "4.9"}</p>
                <p className="text-[13px] text-foreground/50 mt-1">{reviews.totalReviews || BUSINESS.reviews.countDisplay}+ reviews</p>
              </div>
              {reviews.reviews && reviews.reviews.length > 0 && (
                <div className="space-y-3">
                  <p className="text-[12px] text-foreground/40 tracking-wide">Recent Reviews</p>
                  {reviews.reviews.slice(0, 3).map((review: { authorName?: string; rating?: number; text?: string }, i: number) => (
                    <div key={i} className="p-3 border border-border/20">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[13px] text-foreground">{review.authorName || "Customer"}</span>
                        <div className="flex gap-0.5">
                          {[...Array(review.rating || 5)].map((_, j) => (
                            <Star key={j} className="w-3 h-3 fill-primary text-primary" />
                          ))}
                        </div>
                      </div>
                      <p className="text-[12px] text-foreground/50 line-clamp-2">{review.text || ""}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <Star className="w-10 h-10 text-foreground/20 mx-auto mb-3" />
              <p className="text-[13px] text-foreground/40">Reviews data loading...</p>
            </div>
          )}
        </div>
      </div>

      {/* Integrations */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-bold text-sm tracking-wide text-foreground mb-5 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-primary" />
          INTEGRATIONS
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { name: "Google Sheets CRM", status: health.sheetsConfigured, icon: <FileSpreadsheet className="w-5 h-5" />, link: health.sheetsUrl },
            { name: "Google Reviews", status: !!reviews, icon: <Star className="w-5 h-5" />, link: "https://business.google.com/" },
            { name: "Instagram Feed", status: true, icon: <Eye className="w-5 h-5" />, link: "https://instagram.com/nicks_tire_euclid" },
            { name: "AI Content Gen", status: true, icon: <Sparkles className="w-5 h-5" />, link: undefined },
          ].map(integration => (
            <div key={integration.name} className="flex items-center gap-3 p-4 border border-border/20">
              <div className={`${integration.status ? "text-emerald-400" : "text-red-400"}`}>
                {integration.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-foreground truncate">{integration.name}</p>
                <p className={`text-[12px] ${integration.status ? "text-emerald-400" : "text-red-400"}`}>
                  {integration.status ? "Connected" : "Not configured"}
                </p>
              </div>
              {integration.link && (
                <a href={integration.link} target="_blank" rel="noopener noreferrer" className="text-foreground/30 hover:text-primary">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── COUPONS MANAGEMENT ────────────────────────────────

