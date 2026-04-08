/**
 * SmsSection — extracted from Admin.tsx for maintainability.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { BUSINESS } from "@shared/business";
import {
  Loader2, Phone, Send, CheckCircle2, AlertTriangle, RefreshCw
} from "lucide-react";

export default function SmsSection() {
  const { data: smsStatus } = trpc.sms.status.useQuery();
  const sendTest = trpc.sms.sendTest.useMutation();
  const sendManual = trpc.sms.sendManual.useMutation();
  const [testPhone, setTestPhone] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualMsg, setManualMsg] = useState("");
  const [lastResult, setLastResult] = useState<{ success: boolean; sid?: string; error?: string } | null>(null);

  const handleSendTest = async () => {
    if (!testPhone) return;
    try {
      const res = await sendTest.mutateAsync({ phone: testPhone });
      setLastResult(res);
      if (res.success) toast.success("Test SMS sent successfully!");
      else toast.error(res.error || "Failed to send test SMS");
    } catch (err: any) {
      toast.error(err.message || "Failed to send");
    }
  };

  const handleSendManual = async () => {
    if (!manualPhone || !manualMsg) return;
    try {
      const res = await sendManual.mutateAsync({ phone: manualPhone, message: manualMsg });
      setLastResult(res);
      if (res.success) {
        toast.success("SMS sent!");
        setManualMsg("");
      } else {
        toast.error(res.error || "Failed to send");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to send");
    }
  };

  return (
    <div className="space-y-8">
      {/* Status Card */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-bold text-lg text-foreground tracking-[-0.01em] mb-4">TWILIO STATUS</h3>
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${smsStatus?.configured ? "bg-emerald-400" : "bg-red-400"}`} />
          <span className="text-foreground/80">
            {smsStatus?.configured ? "Connected & Active" : "Not Configured"}
          </span>
        </div>
        {smsStatus?.fromNumber && (
          <p className="mt-2 text-foreground/50 text-[13px]">From: {smsStatus.fromNumber}</p>
        )}
        <div className="mt-4 bg-foreground/5 p-4 border border-border/20">
          <p className="text-foreground/60 text-sm leading-relaxed">
            <strong className="text-foreground/80">SMS is automatically sent for:</strong><br />
            • Booking confirmations (when customer books online)<br />
            • Status updates (when you change job stage in Job Board)<br />
            • Callback confirmations (when customer requests a callback)<br />
            • 24-hour thank-you follow-ups (automated)<br />
            • 7-day review request follow-ups (automated)
          </p>
        </div>
      </div>

      {/* Send Test SMS */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-bold text-lg text-foreground tracking-[-0.01em] mb-4">SEND TEST SMS</h3>
        <p className="text-foreground/50 text-sm mb-4">Send a test message to verify Twilio is working correctly.</p>
        <div className="flex gap-3">
          <input
            type="tel"
            placeholder={`Phone number (e.g. ${BUSINESS.phone.dashed})`}
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            className="flex-1 bg-foreground/5 border border-border/30 px-4 py-2.5 text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
          />
          <button
            onClick={handleSendTest}
            disabled={sendTest.isPending || !testPhone}
            className="bg-primary text-primary-foreground px-6 py-2.5 font-bold text-sm tracking-wide hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {sendTest.isPending ? "SENDING..." : "SEND TEST"}
          </button>
        </div>
      </div>

      {/* Send Manual SMS */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-bold text-lg text-foreground tracking-[-0.01em] mb-4">SEND MANUAL SMS</h3>
        <p className="text-foreground/50 text-sm mb-4">Send a custom message to any phone number.</p>
        <div className="space-y-3">
          <input
            type="tel"
            placeholder="Phone number"
            value={manualPhone}
            onChange={(e) => setManualPhone(e.target.value)}
            className="w-full bg-foreground/5 border border-border/30 px-4 py-2.5 text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50"
          />
          <textarea
            placeholder="Type your message..."
            value={manualMsg}
            onChange={(e) => setManualMsg(e.target.value)}
            rows={4}
            maxLength={1600}
            className="w-full bg-foreground/5 border border-border/30 px-4 py-2.5 text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-foreground/30 text-xs">{manualMsg.length}/1600</span>
            <button
              onClick={handleSendManual}
              disabled={sendManual.isPending || !manualPhone || !manualMsg}
              className="bg-primary text-primary-foreground px-6 py-2.5 font-bold text-sm tracking-wide hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {sendManual.isPending ? "SENDING..." : "SEND MESSAGE"}
            </button>
          </div>
        </div>
      </div>

      {/* Last Result */}
      {lastResult && (
        <div className={`p-4 border ${lastResult.success ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
          <p className={`text-[13px] ${lastResult.success ? "text-emerald-400" : "text-red-400"}`}>
            {lastResult.success ? `Sent successfully (SID: ${lastResult.sid})` : `Failed: ${lastResult.error}`}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── MAIN ADMIN COMPONENT ───────────────────────────────

