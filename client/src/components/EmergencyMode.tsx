/**
 * EmergencyMode — Emergency request UI shown when shop is closed
 * Global component displayed when business hours check shows closed
 * Features emergency request form and floating action button
 */

import { useState } from "react";
import { AlertTriangle, Phone, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useBusinessHours } from "@/hooks/useBusinessHours";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

interface EmergencyFormData {
  name: string;
  phone: string;
  vehicle: string;
  issue: string;
  urgency: "emergency" | "next-day";
}

export function EmergencyMode() {
  const { isOpen, nextOpenTime } = useBusinessHours();
  const [location] = useLocation();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<EmergencyFormData>({
    name: "",
    phone: "",
    vehicle: "",
    issue: "",
    urgency: "emergency",
  });
  const [submitted, setSubmitted] = useState(false);

  const submitEmergency = trpc.emergency.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setTimeout(() => {
        setShowForm(false);
        setSubmitted(false);
        setFormData({ name: "", phone: "", vehicle: "", issue: "", urgency: "emergency" });
      }, 3000);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.phone || !formData.issue) {
      alert("Please fill in all required fields");
      return;
    }
    submitEmergency.mutate({
      name: formData.name,
      phone: formData.phone,
      vehicle: formData.vehicle || undefined,
      problem: formData.issue,
      urgency: formData.urgency,
    });
  };

  // Never show on admin pages; only show on customer-facing pages when closed
  if (isOpen || location.startsWith("/admin")) {
    return null;
  }

  return (
    <>
      {/* Emergency Banner */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="fixed top-0 left-0 right-0 z-[60] bg-gradient-to-r from-red-950 to-orange-900 border-b border-red-500/50 backdrop-blur-md"
      >
        <div className="container flex items-center justify-between py-4 px-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-red-200 text-sm tracking-wide">WE'RE CLOSED RIGHT NOW</p>
              <p className="text-red-300/80 text-xs mt-1">Submit an emergency request and be FIRST in line when we open at {nextOpenTime}</p>
            </div>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded font-semibold font-bold text-sm tracking-wide transition-colors flex-shrink-0 ml-4"
          >
            EMERGENCY REQUEST
          </button>
        </div>
      </motion.div>

      {/* Emergency Modal Form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => !submitted && setShowForm(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-background border border-border/50 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto p-6 lg:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-red-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  </div>
                  <h2 className="font-semibold font-bold text-foreground text-lg tracking-wide">EMERGENCY REQUEST</h2>
                </div>
                <button
                  onClick={() => setShowForm(false)}
                  className="text-foreground/40 hover:text-foreground transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {submitted ? (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-8">
                  <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-green-400 text-2xl">✓</span>
                  </div>
                  <h3 className="font-semibold font-bold text-foreground mb-2">REQUEST SUBMITTED!</h3>
                  <p className="text-foreground/60 text-sm">
                    We'll contact you first thing at {nextOpenTime} to confirm your appointment.
                  </p>
                </motion.div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-foreground/60 text-sm font-semibold mb-2">
                      Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                      className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none text-sm"
                      placeholder="Your name"
                    />
                  </div>

                  <div>
                    <label className="block text-foreground/60 text-sm font-semibold mb-2">
                      Phone <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      required
                      className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none text-sm"
                      placeholder="(555) 123-4567"
                    />
                  </div>

                  <div>
                    <label className="block text-foreground/60 text-sm font-semibold mb-2">Vehicle (optional)</label>
                    <input
                      type="text"
                      value={formData.vehicle}
                      onChange={(e) => setFormData({ ...formData, vehicle: e.target.value })}
                      className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none text-sm"
                      placeholder="e.g. 2018 Honda Civic"
                    />
                  </div>

                  <div>
                    <label className="block text-foreground/60 text-sm font-semibold mb-2">
                      What's happening? <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      value={formData.issue}
                      onChange={(e) => setFormData({ ...formData, issue: e.target.value })}
                      required
                      className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none text-sm resize-none"
                      placeholder="Describe your issue..."
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-foreground/60 text-sm font-semibold">Urgency</label>
                    <div className="space-y-2">
                      <label className="flex items-center gap-3 cursor-pointer p-3 border border-border/50 rounded hover:bg-card/50 transition-colors">
                        <input
                          type="radio"
                          name="urgency"
                          value="emergency"
                          checked={formData.urgency === "emergency"}
                          onChange={(e) => setFormData({ ...formData, urgency: e.target.value as "emergency" | "next-day" })}
                          className="w-4 h-4"
                        />
                        <span className="flex-1">
                          <span className="font-semibold text-foreground text-sm">🔴 Emergency — need help ASAP</span>
                          <p className="text-foreground/50 text-xs">Critical issue, vehicle not drivable</p>
                        </span>
                      </label>

                      <label className="flex items-center gap-3 cursor-pointer p-3 border border-border/50 rounded hover:bg-card/50 transition-colors">
                        <input
                          type="radio"
                          name="urgency"
                          value="next-day"
                          checked={formData.urgency === "next-day"}
                          onChange={(e) => setFormData({ ...formData, urgency: e.target.value as "emergency" | "next-day" })}
                          className="w-4 h-4"
                        />
                        <span className="flex-1">
                          <span className="font-semibold text-foreground text-sm">🟡 Can wait until tomorrow</span>
                          <p className="text-foreground/50 text-xs">Non-critical, can schedule for next business day</p>
                        </span>
                      </label>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submitEmergency.isPending}
                    className="w-full bg-red-500 hover:bg-red-600 text-white py-3 font-semibold font-bold text-sm tracking-wide transition-colors disabled:opacity-50 mt-6"
                  >
                    {submitEmergency.isPending ? "SUBMITTING..." : "SUBMIT EMERGENCY REQUEST"}
                  </button>

                  <p className="text-foreground/40 text-xs text-center">
                    We'll contact you as soon as possible to confirm your request.
                  </p>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Emergency Button */}
      <motion.button
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={() => setShowForm(true)}
        className="fixed bottom-6 right-6 z-40 bg-red-500 hover:bg-red-600 text-white p-4 rounded-full font-semibold font-bold text-sm tracking-wide transition-colors shadow-lg flex items-center gap-2 lg:bottom-8 lg:right-8"
      >
        <motion.span
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="inline-block"
        >
          🚨
        </motion.span>
        <span className="hidden sm:inline">EMERGENCY</span>
      </motion.button>
    </>
  );
}

export default EmergencyMode;
