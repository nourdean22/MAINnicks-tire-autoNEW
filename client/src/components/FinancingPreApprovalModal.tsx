/**
 * FinancingPreApprovalModal — "Check If You Qualify" flow.
 * Collects name, phone, email, estimated amount.
 * Submits as a lead with source "financing_preapproval".
 * Server-side handles SMS confirmation + Telegram alert.
 */

import { useState, useCallback } from "react";
import { X, CreditCard, CheckCircle, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";

interface FinancingPreApprovalModalProps {
  open: boolean;
  onClose: () => void;
}

export default function FinancingPreApprovalModal({ open, onClose }: FinancingPreApprovalModalProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submitMutation = trpc.lead.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
    },
  });

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim() || !phone.trim()) return;

      submitMutation.mutate({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        source: "financing_preapproval",
        problem: `Financing pre-approval interest. Estimated amount: $${amount || "unknown"}`,
        vehicle: undefined,
      });
    },
    [name, phone, email, amount, submitMutation]
  );

  const handleClose = useCallback(() => {
    setName("");
    setPhone("");
    setEmail("");
    setAmount("");
    setSubmitted(false);
    onClose();
  }, [onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed inset-0 flex items-center justify-center z-50 p-4"
          >
            <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-r from-[#FDB913]/20 to-transparent px-6 py-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#FDB913]/15 flex items-center justify-center">
                    <CreditCard className="w-5 h-5 text-[#FDB913]" />
                  </div>
                  <div>
                    <h2 className="font-heading text-lg font-bold text-white tracking-wide">
                      Check If You Qualify
                    </h2>
                    <p className="text-white/50 text-xs">No credit check required</p>
                  </div>
                </div>
                <button
                  onClick={handleClose}
                  className="text-white/40 hover:text-white/70 transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="px-6 py-5">
                {submitted ? (
                  <div className="text-center py-6">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-4">
                      <CheckCircle className="w-8 h-8 text-emerald-400" />
                    </div>
                    <h3 className="font-heading text-xl font-bold text-white mb-2">
                      You May Qualify!
                    </h3>
                    <p className="text-white/60 text-sm leading-relaxed mb-4">
                      We sent you a text with next steps. Bring your ID when you drop off your vehicle
                      and we will get you set up with $0 down financing.
                    </p>
                    <p className="text-[#FDB913] font-bold text-sm">
                      (216) 862-0005
                    </p>
                    <button
                      onClick={handleClose}
                      className="mt-6 bg-[#FDB913] text-black px-6 py-2.5 rounded-lg font-bold text-sm tracking-wide hover:bg-[#FDB913]/90 transition-colors"
                    >
                      DONE
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <p className="text-white/50 text-sm mb-4">
                      Fill out the form below and we will let you know your options.
                      No hard credit check, no obligation.
                    </p>

                    {/* Name */}
                    <div>
                      <label className="block text-white/60 text-xs font-medium mb-1.5">
                        Full Name *
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        placeholder="John Smith"
                        className="w-full bg-[#141414] border border-[#2A2A2A] rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-white/25 focus:border-[#FDB913]/50 focus:outline-none transition-colors"
                      />
                    </div>

                    {/* Phone */}
                    <div>
                      <label className="block text-white/60 text-xs font-medium mb-1.5">
                        Phone Number *
                      </label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        required
                        placeholder="(216) 555-1234"
                        className="w-full bg-[#141414] border border-[#2A2A2A] rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-white/25 focus:border-[#FDB913]/50 focus:outline-none transition-colors"
                      />
                    </div>

                    {/* Email */}
                    <div>
                      <label className="block text-white/60 text-xs font-medium mb-1.5">
                        Email (optional)
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="john@example.com"
                        className="w-full bg-[#141414] border border-[#2A2A2A] rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-white/25 focus:border-[#FDB913]/50 focus:outline-none transition-colors"
                      />
                    </div>

                    {/* Estimated Amount */}
                    <div>
                      <label className="block text-white/60 text-xs font-medium mb-1.5">
                        Estimated Service Amount
                      </label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 text-sm">$</span>
                        <input
                          type="number"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="1,500"
                          min="0"
                          max="10000"
                          className="w-full bg-[#141414] border border-[#2A2A2A] rounded-lg pl-8 pr-4 py-2.5 text-white text-sm placeholder:text-white/25 focus:border-[#FDB913]/50 focus:outline-none transition-colors"
                        />
                      </div>
                    </div>

                    {/* Trust signals */}
                    <div className="flex flex-wrap gap-3 text-xs text-white/40 pt-1">
                      <span className="flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-[#FDB913]" />
                        No credit check
                      </span>
                      <span className="flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-[#FDB913]" />
                        $0 down options
                      </span>
                      <span className="flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-[#FDB913]" />
                        Up to $7,500
                      </span>
                    </div>

                    {/* Submit */}
                    <button
                      type="submit"
                      disabled={submitMutation.isPending || !name.trim() || !phone.trim()}
                      className="w-full bg-[#FDB913] text-black py-3 rounded-lg font-bold text-sm tracking-wide hover:bg-[#FDB913]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {submitMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          CHECKING...
                        </>
                      ) : (
                        "CHECK IF YOU QUALIFY"
                      )}
                    </button>

                    {submitMutation.isError && (
                      <p className="text-red-400 text-xs text-center">
                        Something went wrong. Please call us at (216) 862-0005.
                      </p>
                    )}
                  </form>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
