/**
 * Snap-to-Quote — Camera → Upload → Twilio MMS pipeline
 * Per PIT CREW OS directive: "GOT A FLAT? SNAP A PHOTO."
 * Opens phone camera, uploads tire sidewall photo, sends MMS to shop.
 */

import { useState, useRef } from "react";
import { Camera, Upload, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";

type SnapState = "idle" | "uploading" | "success" | "error";

export default function SnapToQuote() {
  const [state, setState] = useState<SnapState>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = trpc.booking.uploadPhoto.useMutation();

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file
    if (!file.type.startsWith("image/")) {
      setErrorMsg("Please select an image file.");
      setState("error");
      return;
    }
    if (file.size > 7.5 * 1024 * 1024) {
      setErrorMsg("Image too large. Max 7.5MB.");
      setState("error");
      return;
    }

    setState("uploading");
    setProgress(0);

    // Simulate progress while uploading (actual upload is single request)
    const progressInterval = setInterval(() => {
      setProgress((prev) => Math.min(prev + Math.random() * 15, 85));
    }, 200);

    try {
      // Convert to base64
      const buffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );

      await uploadMutation.mutateAsync({
        base64,
        filename: file.name,
        mimeType: file.type,
      });

      clearInterval(progressInterval);
      setProgress(100);

      // Brief pause at 100% then show success
      setTimeout(() => setState("success"), 300);
    } catch (err) {
      clearInterval(progressInterval);
      setErrorMsg("Upload failed. Try again or call us directly.");
      setState("error");
    }

    // Reset input so same file can be re-selected
    if (inputRef.current) inputRef.current.value = "";
  };

  const reset = () => {
    setState("idle");
    setProgress(0);
    setErrorMsg("");
  };

  return (
    <section className="py-16 lg:py-24 section-dark">
      <div className="container">
        <div className="max-w-2xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="font-heading text-3xl lg:text-5xl font-extrabold text-foreground uppercase tracking-tight">
              Got a Flat?{" "}
              <span className="text-primary">Snap a Photo.</span>
            </h2>
            <p className="mt-4 text-muted-foreground text-lg max-w-md mx-auto">
              Take a picture of your tire sidewall. We'll check the used rack and text you a quote in under 2 minutes.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-10"
          >
            <AnimatePresence mode="wait">
              {state === "idle" && (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <label className="btn-gold inline-flex items-center justify-center gap-3 text-lg px-10 py-5 cursor-pointer">
                    <Camera className="w-6 h-6" />
                    Snap Tire Sidewall
                    <input
                      ref={inputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleCapture}
                      className="hidden"
                    />
                  </label>
                  <p className="mt-4 text-muted-foreground text-sm">
                    Opens your camera. Photo goes directly to our team.
                  </p>
                </motion.div>
              )}

              {state === "uploading" && (
                <motion.div
                  key="uploading"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="glass-card p-8 max-w-sm mx-auto"
                >
                  <Loader2 className="w-8 h-8 text-secondary animate-spin mx-auto mb-4" />
                  <p className="text-foreground font-medium mb-4">Uploading your photo...</p>
                  {/* Progress bar with cobalt fill */}
                  <div className="w-full h-2 bg-[#21262D] rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-secondary rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                  <p className="mt-2 text-muted-foreground text-xs">{Math.round(progress)}%</p>
                </motion.div>
              )}

              {state === "success" && (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="glass-card p-8 max-w-sm mx-auto"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                  >
                    <CheckCircle className="w-12 h-12 text-[#27AE60] mx-auto mb-4" />
                  </motion.div>
                  <p className="text-foreground font-bold text-lg mb-2">Photo Received!</p>
                  <p className="text-muted-foreground text-sm mb-6">
                    Nick's got your photo. We're checking the used rack now. Expect a text within 2 minutes.
                  </p>
                  <div className="flex flex-col gap-3">
                    <a
                      href={BUSINESS.phone.href}
                      className="btn-gold inline-flex items-center justify-center gap-2"
                    >
                      Call for Faster Quote
                    </a>
                    <button
                      onClick={reset}
                      className="text-muted-foreground text-sm hover:text-foreground transition-colors"
                    >
                      Send Another Photo
                    </button>
                  </div>
                </motion.div>
              )}

              {state === "error" && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="glass-card p-8 max-w-sm mx-auto"
                >
                  <AlertCircle className="w-12 h-12 text-[#FF3B30] mx-auto mb-4" />
                  <p className="text-foreground font-bold text-lg mb-2">Something went wrong</p>
                  <p className="text-muted-foreground text-sm mb-6">{errorMsg}</p>
                  <div className="flex flex-col gap-3">
                    <button onClick={reset} className="btn-cobalt inline-flex items-center justify-center gap-2">
                      Try Again
                    </button>
                    <a
                      href={BUSINESS.phone.href}
                      className="text-primary text-sm font-medium hover:underline"
                    >
                      Or call us: {BUSINESS.phone.display}
                    </a>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
