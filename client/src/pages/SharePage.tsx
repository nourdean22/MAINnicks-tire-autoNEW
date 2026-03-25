/**
 * Share Page (Feature 6)
 * Public shareable vehicle health summary card
 * Route: /share/:token
 * Displays branded service completion card with health score gauge
 */

import { useMemo } from "react";
import { useRoute } from "wouter";
import { SEOHead } from "@/components/SEO";
import PageLayout from "@/components/PageLayout";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Share2,
  Copy,
  MessageCircle,
  Facebook,
  AlertCircle,
  Loader,
} from "lucide-react";

function HealthScoreGauge({ score }: { score: number }) {
  // Clamp score to 0-100
  const clamped = Math.min(Math.max(score, 0), 100);
  const percentage = clamped / 100;
  const circumference = 2 * Math.PI * 45; // radius = 45
  const strokeDashoffset = circumference * (1 - percentage);

  // Color based on score
  let color = "#22c55e"; // green
  let label = "Excellent";
  if (clamped < 40) {
    color = "#ef4444"; // red
    label = "Needs Attention";
  } else if (clamped < 70) {
    color = "#eab308"; // yellow
    label = "Good";
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-40 h-40">
        <svg className="w-full h-full transform -rotate-90">
          {/* Background circle */}
          <circle
            cx="80"
            cy="80"
            r="45"
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="8"
          />
          {/* Progress circle */}
          <circle
            cx="80"
            cy="80"
            r="45"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>

        {/* Score text in center */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold text-white">{clamped}</span>
          <span className="text-xs text-white/60">out of 100</span>
        </div>
      </div>

      <div className="text-center">
        <p className="font-semibold text-white">{label}</p>
        <p className="text-sm text-white/70">Vehicle Health Score</p>
      </div>
    </div>
  );
}

export default function SharePage() {
  const [match, params] = useRoute("/share/:token");
  const token = params?.token || "";

  const query = trpc.shareCards.get.useQuery(
    { token },
    { enabled: !!token }
  );

  const cardData = query.data;

  const pageTitle = useMemo(() => {
    if (!cardData) return "Service Summary";
    if (cardData.customerName) {
      return `${cardData.customerName}'s Service at Nick's Tire & Auto`;
    }
    if (cardData.vehicleInfo) {
      return `${cardData.vehicleInfo} Service Summary`;
    }
    return "Service Completed | Nick's Tire & Auto";
  }, [cardData]);

  const pageDescription = useMemo(() => {
    if (!cardData) return "Service completion summary";
    const parts: string[] = [];
    if (cardData.vehicleInfo) parts.push(`Vehicle: ${cardData.vehicleInfo}`);
    if (cardData.serviceType) parts.push(`Service: ${cardData.serviceType}`);
    if (cardData.completedDate) {
      parts.push(`Completed: ${new Date(cardData.completedDate).toLocaleDateString()}`);
    }
    if (cardData.healthScore) {
      parts.push(`Health Score: ${cardData.healthScore}/100`);
    }
    return parts.length > 0
      ? parts.join(" • ")
      : "Service completion summary from Nick's Tire & Auto";
  }, [cardData]);

  const copyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
  };

  const shareOnFacebook = () => {
    if (!token) return;
    const url = `https://nickstire.org/share/${token}`;
    const fbShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    window.open(fbShareUrl, "facebook-share", "width=600,height=400");
  };

  const shareViaText = () => {
    if (!token) return;
    const url = `https://nickstire.org/share/${token}`;
    const message = `Check out my vehicle health report from Nick's Tire & Auto: ${url}`;
    const smsUrl = `sms:?body=${encodeURIComponent(message)}`;
    window.location.href = smsUrl;
  };

  if (query.isPending) {
    return (
      <PageLayout>
        <SEOHead
          title="Service Summary"
          description="Service completion summary"
          canonicalPath={`/share/${token}`}
        />
        <div className="container min-h-screen flex items-center justify-center">
          <div className="text-center space-y-4">
            <Loader className="w-12 h-12 mx-auto text-yellow-400 animate-spin" />
            <p className="text-white">Loading service summary...</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (query.isError || !cardData) {
    return (
      <PageLayout>
        <SEOHead
          title="Service Summary Not Found"
          description="Service summary not available"
          canonicalPath={`/share/${token}`}
        />
        <div className="container min-h-screen flex items-center justify-center">
          <div className="text-center space-y-6 max-w-md">
            <AlertCircle className="w-16 h-16 mx-auto text-orange-400" />
            <h1 className="text-2xl font-bold text-white">
              Service Summary Not Found
            </h1>
            <p className="text-white/70">
              This service summary may have expired or is no longer available.
            </p>
            <a
              href="/"
              className="inline-block bg-yellow-400 hover:bg-yellow-300 text-black font-bold py-3 px-6 rounded-lg transition-colors"
            >
              Back to Home
            </a>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <SEOHead
        title={pageTitle}
        description={pageDescription}
        canonicalPath={`/share/${token}`}
      />

      {/* Hero - Branded Background */}
      <section className="bg-gradient-to-br from-[#0A0A0A] to-[#1a1a1a] py-12 lg:py-16">
        <div className="container max-w-2xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center space-y-2"
          >
            <div className="text-3xl font-bold text-white">
              Nick's Tire & Auto
            </div>
            <p className="text-yellow-400 font-semibold">Service Completion Summary</p>
          </motion.div>
        </div>
      </section>

      {/* Card */}
      <section className="bg-[#0A0A0A] py-12 lg:py-16">
        <div className="container max-w-2xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white/5 border border-white/10 rounded-2xl p-8 lg:p-10 space-y-8 backdrop-blur-sm"
          >
            {/* Vehicle Info */}
            {cardData.vehicleInfo && (
              <div>
                <p className="text-xs text-yellow-400 tracking-wide font-semibold mb-2">
                  VEHICLE
                </p>
                <p className="text-2xl font-bold text-white">{cardData.vehicleInfo}</p>
              </div>
            )}

            {/* Service Completed */}
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <CheckCircle2 className="w-8 h-8 text-green-400" />
              </div>
              <div>
                <p className="text-xs text-yellow-400 tracking-wide font-semibold mb-1">
                  SERVICE COMPLETED
                </p>
                {cardData.serviceType && (
                  <p className="text-xl font-bold text-white">{cardData.serviceType}</p>
                )}
                {cardData.completedDate && (
                  <p className="text-sm text-white/70">
                    {new Date(cardData.completedDate).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                )}
              </div>
            </div>

            {/* Health Score */}
            {cardData.healthScore !== null && cardData.healthScore !== undefined && (
              <div className="flex flex-col items-center py-6">
                <HealthScoreGauge score={cardData.healthScore} />
              </div>
            )}

            {/* Health Details */}
            {cardData.healthDetails && (
              <div className="bg-white/5 border border-white/10 rounded-lg p-6 space-y-3">
                <p className="text-xs text-yellow-400 tracking-wide font-semibold">
                  HEALTH DETAILS
                </p>
                <div className="text-white/80 text-sm whitespace-pre-wrap">
                  {cardData.healthDetails}
                </div>
              </div>
            )}

            {/* Badge */}
            <div className="flex items-center justify-center gap-2 text-green-400 font-semibold">
              <CheckCircle2 className="w-5 h-5" />
              <span>Nick's Tire & Auto fixed it ✅</span>
            </div>

            {/* Share Buttons */}
            <div className="space-y-3 pt-6 border-t border-white/10">
              <p className="text-xs text-white/60 text-center tracking-wide">
                SHARE THIS WITH SOMEONE
              </p>

              <button
                onClick={shareViaText}
                className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                <MessageCircle className="w-5 h-5" />
                Text to Someone
              </button>

              <button
                onClick={shareOnFacebook}
                className="w-full flex items-center justify-center gap-3 bg-blue-900 hover:bg-blue-950 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                <Facebook className="w-5 h-5" />
                Share on Facebook
              </button>

              <button
                onClick={copyLink}
                className="w-full flex items-center justify-center gap-3 bg-white/10 hover:bg-white/20 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                <Copy className="w-5 h-5" />
                Copy Link
              </button>
            </div>

            {/* CTA */}
            <div className="space-y-3 pt-6 border-t border-white/10">
              <p className="text-center text-white/60 text-sm">
                Need auto repair?
              </p>
              <a
                href="/"
                className="block w-full bg-yellow-400 hover:bg-yellow-300 text-black font-bold py-3 rounded-lg transition-colors text-center"
              >
                Visit Nick's Tire & Auto
              </a>
              <a
                href={`tel:${BUSINESS.phone.href}`}
                className="block w-full border-2 border-yellow-400 text-yellow-400 font-bold py-3 rounded-lg transition-colors text-center hover:bg-yellow-400/10"
              >
                Call {BUSINESS.phone.display}
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <section className="bg-[#0A0A0A] border-t border-white/10 py-8 text-center">
        <div className="container text-white/60 text-sm space-y-1">
          <p>{BUSINESS.address.full}</p>
          <p>{BUSINESS.phone.display}</p>
          <p className="text-xs pt-3">{BUSINESS.hours.fullDisplay}</p>
        </div>
      </section>
    </PageLayout>
  );
}
