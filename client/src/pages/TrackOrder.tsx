/**
 * TrackOrder — Pizza-tracker style real-time job status
 * Route: /track/:orderId
 * Shows 7-stage progress from check-in to pickup.
 */

import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import PageLayout from "@/components/PageLayout";
import { SEOHead } from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import { CheckCircle, Clock, Wrench, Search, ClipboardCheck, Car, Phone } from "lucide-react";
import { motion } from "framer-motion";
import { BUSINESS } from "@shared/business";

const STAGES = [
  { key: "checked_in", label: "Checked In", icon: Car },
  { key: "diagnosing", label: "Diagnosing", icon: Search },
  { key: "quoted", label: "Estimate Ready", icon: ClipboardCheck },
  { key: "approved", label: "Approved", icon: CheckCircle },
  { key: "in_progress", label: "In Progress", icon: Wrench },
  { key: "quality_check", label: "Quality Check", icon: ClipboardCheck },
  { key: "ready", label: "Ready for Pickup!", icon: Car },
];

function getStageIndex(status: string): number {
  const idx = STAGES.findIndex((s) => s.key === status);
  return idx >= 0 ? idx : 0;
}

export default function TrackOrder() {
  const [, params] = useRoute("/track/:orderId");
  const orderId = params?.orderId || "";
  const [currentStatus, setCurrentStatus] = useState("checked_in");

  // Try to fetch order status from tRPC
  const { data: order } = trpc.booking.statusByRef.useQuery(
    { ref: orderId },
    { enabled: !!orderId, retry: 1 }
  );

  useEffect(() => {
    if (order?.status) {
      // Map booking status to tracker stages
      const statusMap: Record<string, string> = {
        new: "checked_in",
        confirmed: "checked_in",
        received: "checked_in",
        inspecting: "diagnosing",
        "waiting-parts": "quoted",
        "in-progress": "in_progress",
        "quality-check": "quality_check",
        ready: "ready",
        completed: "ready",
      };
      setCurrentStatus(statusMap[order.status] || "checked_in");
    }
  }, [order?.status]);

  // SSE for real-time updates
  useEffect(() => {
    if (!orderId) return;

    const eventSource = new EventSource(`/api/v1/sse/track/${orderId}`);

    eventSource.addEventListener("status-update", (event) => {
      const data = JSON.parse(event.data);
      if (data.status) setCurrentStatus(data.status);
    });

    eventSource.onerror = () => {
      // Silently reconnect — SSE auto-reconnects
    };

    return () => eventSource.close();
  }, [orderId]);

  const activeIndex = getStageIndex(currentStatus);
  const isComplete = currentStatus === "ready";

  return (
    <PageLayout>
      <SEOHead
        title="Track Your Vehicle | Nick's Tire & Auto"
        description="Track the real-time status of your vehicle at Nick's Tire & Auto."
        canonicalPath={`/track/${orderId}`}
      />

      <section className="min-h-[80vh] py-16 lg:py-24 section-dark">
        <div className="container max-w-2xl">
          <div className="text-center mb-12">
            <h1 className="font-heading text-3xl lg:text-4xl font-extrabold text-foreground uppercase tracking-tight">
              {isComplete ? "Your Vehicle is Ready!" : "Tracking Your Vehicle"}
            </h1>
            <p className="mt-3 text-muted-foreground">
              {isComplete
                ? "Come pick up your vehicle anytime during business hours."
                : "We'll update this page in real-time as work progresses."}
            </p>
          </div>

          {/* Progress Tracker */}
          <div className="space-y-0">
            {STAGES.map((stage, i) => {
              const isActive = i === activeIndex;
              const isCompleted = i < activeIndex;
              const isFuture = i > activeIndex;
              const Icon = stage.icon;

              return (
                <motion.div
                  key={stage.key}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-start gap-4"
                >
                  {/* Connector line + circle */}
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all duration-500 ${
                        isCompleted
                          ? "bg-[#27AE60] text-white"
                          : isActive
                          ? "bg-primary text-[#0B0E14] ring-4 ring-primary/30"
                          : "bg-[#21262D] text-muted-foreground"
                      }`}
                    >
                      {isCompleted ? (
                        <CheckCircle className="w-5 h-5" />
                      ) : (
                        <Icon className="w-5 h-5" />
                      )}
                    </div>
                    {i < STAGES.length - 1 && (
                      <div
                        className={`w-0.5 h-12 transition-all duration-500 ${
                          isCompleted ? "bg-[#27AE60]" : "bg-[#21262D]"
                        }`}
                      />
                    )}
                  </div>

                  {/* Label */}
                  <div className={`pt-2 pb-6 ${isFuture ? "opacity-40" : ""}`}>
                    <p
                      className={`font-heading text-sm font-bold uppercase tracking-wide ${
                        isActive ? "text-primary" : isCompleted ? "text-[#27AE60]" : "text-muted-foreground"
                      }`}
                    >
                      {stage.label}
                    </p>
                    {isActive && (
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-xs text-muted-foreground mt-1 flex items-center gap-1"
                      >
                        <Clock className="w-3 h-3" />
                        In progress...
                      </motion.p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Contact CTA */}
          <div className="mt-12 text-center">
            <a
              href={BUSINESS.phone.href}
              className="btn-gold inline-flex items-center gap-2"
            >
              <Phone className="w-5 h-5" />
              Call {BUSINESS.phone.display}
            </a>
            <p className="mt-3 text-muted-foreground text-xs">
              Questions about your service? We're here to help.
            </p>
          </div>
        </div>
      </section>
    </PageLayout>
  );
}
