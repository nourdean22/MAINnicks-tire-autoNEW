import { useState, useEffect, useCallback } from "react";

export default function ExitIntentPopup() {
  const [show, setShow] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const triggerPopup = useCallback(() => {
    // Don't show if already dismissed or submitted
    if (sessionStorage.getItem("exit_popup_dismissed")) return;
    setShow(true);
  }, []);

  useEffect(() => {
    // Desktop: mouse leaving viewport
    const handleMouseLeave = (e: MouseEvent) => {
      if (e.clientY <= 0) triggerPopup();
    };

    // Mobile: timer-based (30s)
    const isMobile = window.innerWidth < 768;
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (isMobile) {
      timer = setTimeout(triggerPopup, 30000);
    } else {
      document.addEventListener("mouseleave", handleMouseLeave);
    }

    return () => {
      document.removeEventListener("mouseleave", handleMouseLeave);
      if (timer) clearTimeout(timer);
    };
  }, [triggerPopup]);

  const dismiss = () => {
    setShow(false);
    sessionStorage.setItem("exit_popup_dismissed", "1");
  };

  const submit = async () => {
    if (!phone || phone.length < 7) return;
    setSubmitting(true);
    try {
      // Submit lead to API
      await fetch("https://autonicks.com/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name || "Website Visitor",
          customerPhone: phone,
          vehicleYear: 0,
          vehicleMake: "TBD",
          vehicleModel: "TBD",
          source: "exit_popup",
          status: "draft",
          items: [],
        }),
      });
      setSubmitted(true);
      sessionStorage.setItem("exit_popup_dismissed", "1");
    } catch {
      // Fail silently — still show thank you
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={dismiss}>
      <div
        className="bg-[#1A1A1A] border border-[#FDB913]/40 rounded-2xl p-8 max-w-md w-full relative animate-in fade-in zoom-in-95 duration-300"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={dismiss} className="absolute top-4 right-4 text-[#666] hover:text-white text-xl">{"\u2715"}</button>

        {submitted ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4">{"\uD83C\uDF89"}</div>
            <h3 className="text-xl font-bold text-white mb-2">We'll Call You!</h3>
            <p className="text-[#A0A0A0]">A team member will reach out within 24 hours with your personalized quote.</p>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <div className="text-3xl mb-2">{"\u26A1"}</div>
              <h3 className="text-xl font-bold text-white mb-1">Wait! Get 10% Off</h3>
              <p className="text-[#A0A0A0] text-sm">Leave your number and we'll call you with a special discount on your next service.</p>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-[#0A0A0A] border border-[#333] rounded-lg px-4 py-3 text-white placeholder-[#666] focus:border-[#FDB913] focus:outline-none"
              />
              <input
                type="tel"
                placeholder="Phone number *"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full bg-[#0A0A0A] border border-[#333] rounded-lg px-4 py-3 text-white placeholder-[#666] focus:border-[#FDB913] focus:outline-none"
                required
              />
              <button
                onClick={submit}
                disabled={submitting || phone.length < 7}
                className="w-full bg-[#FDB913] text-black font-bold py-3 rounded-lg hover:bg-[#FDB913]/90 transition disabled:opacity-50"
              >
                {submitting ? "Sending..." : "Get My Discount \u2192"}
              </button>
            </div>

            <p className="text-[#555] text-xs text-center mt-4">No spam. We'll only call about your quote.</p>
          </>
        )}
      </div>
    </div>
  );
}
