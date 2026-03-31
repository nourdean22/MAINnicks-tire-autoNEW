/**
 * CustomerPortal — Public page where customers log in with their phone number
 * to view vehicle history, upcoming maintenance, and invoices.
 * AUDIT-FIXED: Resend code, loading skeletons, better error states, service history.
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import { SEOHead } from "@/components/SEO";
import NotificationBar from "@/components/NotificationBar";
import {
  Phone, Shield, Car, FileText, Clock, ChevronRight, Loader2,
  ArrowLeft, Wrench, DollarSign, Calendar, CheckCircle2, AlertTriangle,
  RefreshCw, History, CreditCard
} from "lucide-react";

export default function CustomerPortal() {
  const [step, setStep] = useState<"phone" | "verify" | "dashboard">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Check for existing session
  useEffect(() => {
    const saved = sessionStorage.getItem("portal_token");
    if (saved) {
      setToken(saved);
      setStep("dashboard");
    }
  }, []);

  const requestCode = trpc.portal.requestCode.useMutation({
    onSuccess: () => {
      toast.success("Verification code sent to your phone");
      setStep("verify");
      setIsSubmitting(false);
    },
    onError: (err) => {
      toast.error(err.message || "Could not send code. Please try again.");
      setIsSubmitting(false);
    },
  });

  const verifyCode = trpc.portal.verifyCode.useMutation({
    onSuccess: (data) => {
      if (data.token) {
        setToken(data.token);
        sessionStorage.setItem("portal_token", data.token);
        setStep("dashboard");
        toast.success("Welcome back!");
      }
      setIsSubmitting(false);
    },
    onError: () => {
      toast.error("Invalid or expired code. Please try again.");
      setIsSubmitting(false);
    },
  });

  const handleRequestCode = () => {
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length < 10) {
      toast.error("Please enter a valid phone number");
      return;
    }
    setIsSubmitting(true);
    requestCode.mutate({ phone: cleaned });
  };

  const handleVerify = () => {
    if (code.length !== 6) {
      toast.error("Please enter the 6-digit code");
      return;
    }
    setIsSubmitting(true);
    verifyCode.mutate({ phone: phone.replace(/\D/g, ""), code });
  };

  const handleLogout = () => {
    sessionStorage.removeItem("portal_token");
    setToken(null);
    setStep("phone");
    setPhone("");
    setCode("");
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Customer Portal | Nick's Tire & Auto Cleveland"
        description="Access your vehicle service history, upcoming maintenance reminders, and invoices at Nick's Tire & Auto in Cleveland. Log in with your phone number."
        canonicalPath="/portal"
      />
      <NotificationBar />
      {/* Header */}
      <nav className="bg-background/95 border-b border-border/20">
        <div className="container flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary flex items-center justify-center">
              <span className="font-bold text-primary-foreground text-sm">N</span>
            </div>
            <span className="font-bold text-primary text-sm tracking-wider">NICK'S TIRE & AUTO</span>
          </Link>
          {step === "dashboard" && (
            <button onClick={handleLogout} className="text-[12px] text-foreground/40 hover:text-foreground transition-colors">
              LOG OUT
            </button>
          )}
        </div>
      </nav>

      {step === "phone" && <PhoneStep phone={phone} setPhone={setPhone} onSubmit={handleRequestCode} loading={isSubmitting} />}
      {step === "verify" && (
        <VerifyStep
          code={code}
          setCode={setCode}
          onSubmit={handleVerify}
          onBack={() => { setStep("phone"); setCode(""); }}
          onResend={handleRequestCode}
          loading={isSubmitting}
          phone={phone}
        />
      )}
      {step === "dashboard" && token && <PortalDashboard token={token} onLogout={handleLogout} />}
    </div>
  );
}

// ─── PHONE STEP ─────────────────────────────────────────
function PhoneStep({ phone, setPhone, onSubmit, loading }: {
  phone: string; setPhone: (v: string) => void; onSubmit: () => void; loading: boolean;
}) {
  return (
    <div className="container max-w-lg py-20">
      <div className="text-center mb-10">
        <div className="w-16 h-16 bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Shield className="w-8 h-8 text-primary" />
        </div>
        <h1 className="font-bold text-3xl text-foreground tracking-tight">CUSTOMER PORTAL</h1>
        <p className="text-[13px] text-foreground/50 mt-2">
          View your vehicle history, service records, and invoices
        </p>
      </div>

      <div className="bg-card border border-border/30 p-8">
        <label className="text-[12px] text-foreground/50 tracking-wide block mb-2">
          PHONE NUMBER
        </label>
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(216) 555-0123"
              className="w-full bg-background border border-border/30 pl-10 pr-4 py-3 text-[13px] text-foreground placeholder:text-foreground/20 focus:border-primary/50 focus:outline-none"
              onKeyDown={(e) => e.key === "Enter" && onSubmit()}
            />
          </div>
          <button
            onClick={onSubmit}
            disabled={loading}
            className="px-6 bg-primary text-primary-foreground font-bold text-sm tracking-wider hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "SEND CODE"}
          </button>
        </div>
        <p className="font-mono text-[10px] text-foreground/30 mt-3">
          We will send a verification code to confirm your identity.
        </p>
      </div>

      {/* Features preview */}
      <div className="mt-8 grid grid-cols-3 gap-3">
        {[
          { icon: <History className="w-5 h-5" />, label: "Service History" },
          { icon: <CreditCard className="w-5 h-5" />, label: "Invoices" },
          { icon: <Car className="w-5 h-5" />, label: "Job Status" },
        ].map(f => (
          <div key={f.label} className="bg-card/50 border border-border/20 p-3 text-center">
            <div className="text-primary/40 flex justify-center mb-1">{f.icon}</div>
            <span className="font-mono text-[9px] text-foreground/30">{f.label}</span>
          </div>
        ))}
      </div>

      <div className="mt-8 text-center">
        <p className="text-[12px] text-foreground/30">
          Not a customer yet?{" "}
          <Link href="/contact" className="text-primary hover:underline">Schedule your first visit</Link>
        </p>
      </div>
    </div>
  );
}

// ─── VERIFY STEP ────────────────────────────────────────
function VerifyStep({ code, setCode, onSubmit, onBack, onResend, loading, phone }: {
  code: string; setCode: (v: string) => void; onSubmit: () => void; onBack: () => void; onResend: () => void; loading: boolean; phone: string;
}) {
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleResend = () => {
    setResendCooldown(30);
    onResend();
  };

  return (
    <div className="container max-w-lg py-20">
      <button onClick={onBack} className="flex items-center gap-2 text-[12px] text-foreground/40 hover:text-foreground mb-8 transition-colors">
        <ArrowLeft className="w-3 h-3" /> BACK
      </button>

      <div className="text-center mb-10">
        <h1 className="font-bold text-2xl text-foreground tracking-tight">ENTER VERIFICATION CODE</h1>
        <p className="text-[13px] text-foreground/50 mt-2">
          Sent to {phone}
        </p>
      </div>

      <div className="bg-card border border-border/30 p-8">
        <label className="text-[12px] text-foreground/50 tracking-wide block mb-2">
          6-DIGIT CODE
        </label>
        <div className="flex gap-3">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            className="flex-1 bg-background border border-border/30 px-4 py-3 text-2xl text-center text-foreground tracking-[0.5em] placeholder:text-foreground/20 focus:border-primary/50 focus:outline-none"
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
            autoFocus
          />
        </div>
        <button
          onClick={onSubmit}
          disabled={loading || code.length !== 6}
          className="w-full mt-4 py-3 bg-primary text-primary-foreground font-bold text-sm tracking-wider hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "VERIFY & LOG IN"}
        </button>

        {/* Resend code */}
        <div className="mt-4 text-center">
          <button
            onClick={handleResend}
            disabled={resendCooldown > 0 || loading}
            className="text-[12px] text-foreground/40 hover:text-primary transition-colors disabled:opacity-30 flex items-center gap-1 mx-auto"
          >
            <RefreshCw className="w-3 h-3" />
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend Code"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PORTAL DASHBOARD ───────────────────────────────────
function PortalDashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { data, isLoading, error } = trpc.portal.myData.useQuery({ token }, {
    retry: false,
    refetchInterval: 120000,
  });
  const [activeTab, setActiveTab] = useState<"overview" | "history" | "invoices">("overview");

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div className="container max-w-lg py-20 text-center">
        <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-4" />
        <h2 className="font-bold text-xl text-foreground mb-2">SESSION EXPIRED</h2>
        <p className="text-[13px] text-foreground/50 mb-6">Please log in again to access your portal.</p>
        <button onClick={onLogout} className="px-6 py-3 bg-primary text-primary-foreground font-bold text-sm tracking-wider">
          LOG IN AGAIN
        </button>
      </div>
    );
  }

  const customer = data?.customer;
  const bookingsList = data?.bookings || [];
  const invoicesList = data?.invoices || [];
  const historyList = data?.serviceHistory || [];
  const activeJobs = bookingsList.filter((b: any) => b.status !== "completed" && b.status !== "cancelled");

  return (
    <div className="container max-w-4xl py-8">
      {/* Welcome */}
      <div className="mb-6">
        <h1 className="font-bold text-2xl text-foreground tracking-tight">
          {customer ? `WELCOME BACK, ${(customer.firstName || '').toUpperCase()}` : "YOUR PORTAL"}
        </h1>
        <p className="text-[12px] text-foreground/40 mt-1">
          Phone: {data?.phone ? `(${data.phone.slice(0, 3)}) ${data.phone.slice(3, 6)}-${data.phone.slice(6)}` : "—"}
          {customer?.totalVisits ? ` · ${customer.totalVisits} visits` : ""}
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard icon={<Car className="w-5 h-5 text-primary" />} value={bookingsList.length} label="Service Records" />
        <StatCard icon={<FileText className="w-5 h-5 text-blue-400" />} value={invoicesList.length} label="Invoices" />
        <StatCard icon={<DollarSign className="w-5 h-5 text-emerald-400" />} value={`$${(invoicesList.reduce((sum: number, inv: any) => sum + (inv.totalAmount || 0), 0) / 100).toLocaleString()}`} label="Total Spent" />
        <StatCard icon={<Calendar className="w-5 h-5 text-amber-400" />} value={bookingsList.length > 0 ? new Date(bookingsList[0].createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"} label="Last Visit" />
      </div>

      {/* Active Jobs Alert */}
      {activeJobs.length > 0 && (
        <div className="mb-6 bg-primary/5 border border-primary/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Wrench className="w-4 h-4 text-primary" />
            <span className="font-bold text-sm text-foreground tracking-wider">ACTIVE SERVICES ({activeJobs.length})</span>
          </div>
          <div className="space-y-2">
            {activeJobs.map((b: any) => (
              <div key={b.id} className="bg-card border border-border/20 p-3 flex items-center justify-between">
                <div>
                  <span className="font-bold text-xs text-foreground">{b.service}</span>
                  <span className="font-mono text-[10px] text-foreground/40 ml-2">{b.vehicle || ""}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-[10px] tracking-wider px-2 py-0.5 ${
                    b.stage === "ready" ? "bg-emerald-500/20 text-emerald-400" :
                    b.stage === "in-progress" ? "bg-primary/20 text-primary" :
                    b.stage === "quality-check" ? "bg-cyan-500/20 text-cyan-400" :
                    "bg-blue-500/20 text-blue-400"
                  }`}>
                    {(b.stage || "received").toUpperCase().replace(/-/g, " ")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-border/20">
        {[
          { key: "overview", label: "Service History" },
          { key: "invoices", label: "Invoices" },
          ...(historyList.length > 0 ? [{ key: "history", label: "Maintenance Log" }] : []),
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key as any)}
            className={`px-4 py-2.5 text-[12px] tracking-wider border-b-2 -mb-[1px] transition-colors ${
              activeTab === t.key ? "border-primary text-primary" : "border-transparent text-foreground/40 hover:text-foreground/60"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <div className="space-y-2">
          {bookingsList.length === 0 ? (
            <EmptyState icon={<Wrench className="w-8 h-8" />} title="No service records" message="No service records found for this phone number." />
          ) : (
            bookingsList.slice(0, 15).map((b: any) => (
              <div key={b.id} className="bg-card border border-border/30 p-4 flex items-center gap-4">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  b.status === "completed" ? "bg-emerald-400" : b.status === "cancelled" ? "bg-red-400" : "bg-blue-400"
                }`} />
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-xs text-foreground">{b.service}</span>
                  <span className="font-mono text-[10px] text-foreground/30 ml-2">{b.vehicle || ""}</span>
                  {b.referenceCode && <span className="font-mono text-[9px] text-cyan-400/50 ml-2">#{b.referenceCode}</span>}
                </div>
                <div className="text-right">
                  <span className="font-mono text-[10px] text-foreground/30">
                    {new Date(b.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                  <span className={`font-mono text-[9px] block mt-0.5 ${
                    b.status === "completed" ? "text-emerald-400" : b.status === "cancelled" ? "text-red-400" : "text-blue-400"
                  }`}>
                    {(b.status || "pending").toUpperCase()}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "invoices" && (
        <div className="space-y-2">
          {invoicesList.length === 0 ? (
            <EmptyState icon={<FileText className="w-8 h-8" />} title="No invoices" message="No invoices found for this phone number." />
          ) : (
            invoicesList.map((inv: any) => (
              <div key={inv.id} className="bg-card border border-border/30 p-4 flex items-center gap-4">
                <DollarSign className="w-4 h-4 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-xs text-foreground">
                    {inv.serviceDescription || "Service"}
                  </span>
                  {inv.vehicleInfo && <span className="font-mono text-[10px] text-foreground/30 ml-2">{inv.vehicleInfo}</span>}
                  {inv.invoiceNumber && <span className="font-mono text-[9px] text-foreground/20 ml-2">#{inv.invoiceNumber}</span>}
                </div>
                <div className="text-right">
                  <span className="font-bold text-sm text-primary">
                    ${(inv.totalAmount / 100).toLocaleString()}
                  </span>
                  <div className="flex items-center gap-2 justify-end mt-0.5">
                    <span className={`font-mono text-[9px] px-1 py-0.5 ${
                      inv.paymentStatus === "paid" ? "bg-emerald-500/20 text-emerald-400" :
                      inv.paymentStatus === "pending" ? "bg-amber-500/20 text-amber-400" :
                      "bg-foreground/10 text-foreground/40"
                    }`}>
                      {inv.paymentStatus?.toUpperCase()}
                    </span>
                    <span className="font-mono text-[9px] text-foreground/30">
                      {new Date(inv.invoiceDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "history" && (
        <div className="space-y-2">
          {historyList.length === 0 ? (
            <EmptyState icon={<History className="w-8 h-8" />} title="No maintenance log" message="Maintenance records will appear here as services are completed." />
          ) : (
            historyList.map((h: any) => (
              <div key={h.id} className="bg-card border border-border/30 p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs text-foreground">{h.serviceType}</span>
                  <span className="font-mono text-[10px] text-foreground/30">
                    {new Date(h.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                {h.description && <p className="font-mono text-[10px] text-foreground/50">{h.description}</p>}
                {h.mileageAtService && <span className="font-mono text-[9px] text-foreground/25 mt-1 block">{h.mileageAtService.toLocaleString()} miles</span>}
                {h.nextServiceDue && (
                  <div className="mt-2 flex items-center gap-1 text-[9px] text-amber-400/60">
                    <Clock className="w-3 h-3" />
                    Next due: {new Date(h.nextServiceDue).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* CTA */}
      <div className="mt-8 bg-card border border-primary/30 p-6 text-center">
        <h3 className="font-bold text-foreground tracking-[-0.01em] mb-2">NEED SERVICE?</h3>
        <p className="text-[12px] text-foreground/40 mb-4">Schedule your next visit online or call us directly.</p>
        <div className="flex items-center justify-center gap-3">
          <Link href="/contact" className="px-6 py-2.5 bg-primary text-primary-foreground font-bold text-sm tracking-wider hover:bg-primary/90 transition-colors">
            BOOK NOW
          </Link>
          <a href="tel:2168620005" className="px-6 py-2.5 border border-foreground/20 text-foreground font-bold text-sm tracking-wider hover:border-primary hover:text-primary transition-colors">
            CALL (216) 862-0005
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD SKELETON ─────────────────────────────────
function DashboardSkeleton() {
  return (
    <div className="container max-w-4xl py-8 animate-pulse">
      <div className="h-8 w-64 bg-foreground/5 mb-2" />
      <div className="h-4 w-40 bg-foreground/5 mb-8" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-card border border-border/30 p-4 space-y-2">
            <div className="h-5 w-5 bg-foreground/5 rounded" />
            <div className="h-8 w-16 bg-foreground/5" />
            <div className="h-3 w-20 bg-foreground/5" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-card border border-border/30 p-4 h-14" />
        ))}
      </div>
    </div>
  );
}

// ─── STAT CARD ──────────────────────────────────────────
function StatCard({ icon, value, label }: { icon: React.ReactNode; value: string | number; label: string }) {
  return (
    <div className="bg-card border border-border/30 p-4">
      {icon}
      <span className="font-bold text-2xl text-foreground block mt-2">{value}</span>
      <span className="font-mono text-[10px] text-foreground/40">{label}</span>
    </div>
  );
}

// ─── EMPTY STATE ────────────────────────────────────────
function EmptyState({ icon, title, message }: { icon: React.ReactNode; title: string; message: string }) {
  return (
    <div className="bg-card border border-border/30 p-8 text-center">
      <div className="text-foreground/20 flex justify-center mb-3">{icon}</div>
      <h3 className="font-bold text-sm text-foreground/40 tracking-[-0.01em] mb-1">{title.toUpperCase()}</h3>
      <p className="text-[12px] text-foreground/30">{message}</p>
    </div>
  );
}
