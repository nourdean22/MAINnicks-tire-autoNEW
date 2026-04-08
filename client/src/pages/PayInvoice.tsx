/**
 * Pay Invoice — Customer-facing payment page.
 * Customer enters invoice # + phone → sees invoice → payment options.
 *
 * When Stripe is configured: shows Stripe-powered payment (card data never touches our server).
 * When Stripe is not configured: shows call-to-pay + financing options.
 */
import { useState, useEffect } from "react";
import PageLayout from "@/components/PageLayout";
import { SEOHead } from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  CreditCard, Phone, FileText, CheckCircle2, Loader2,
  Shield, Lock, Zap, ArrowRight, PhoneCall,
} from "lucide-react";
import { BUSINESS } from "@shared/business";
import { SHORT_DISCLAIMERS } from "@shared/disclaimers";

export default function PayInvoice() {
  const [invoiceNum, setInvoiceNum] = useState("");
  const [phone, setPhone] = useState("");
  const [looked, setLooked] = useState(false);
  const [paid, setPaid] = useState(false);

  // Get invoice # from URL if provided
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlInvoice = params.get("invoice") || "";
    if (urlInvoice && !invoiceNum && !looked) {
      setInvoiceNum(urlInvoice);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const invoiceQuery = trpc.payments.lookupInvoice.useQuery(
    { invoiceNumber: invoiceNum, phone },
    { enabled: looked && invoiceNum.length > 0 && phone.length >= 7 }
  );

  const configQuery = trpc.payments.config.useQuery(undefined, { staleTime: 60_000 });

  const invoice = invoiceQuery.data;
  const stripeEnabled = configQuery.data?.stripeEnabled ?? false;

  return (
    <PageLayout activeHref="/pay">
      <SEOHead
        title="Pay Invoice — Nick's Tire & Auto"
        description="Pay your invoice online. Enter your invoice number and phone to pull up your bill and pay with credit card."
        canonicalPath="/pay"
      />

      <section className="bg-[oklch(0.065_0.004_260)] pt-28 pb-16 lg:pt-36 lg:pb-20">
        <div className="container max-w-lg">
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <CreditCard className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Pay Your Invoice</h1>
            <p className="text-muted-foreground mt-2 text-sm">Enter your invoice number and phone to get started.</p>
          </div>

          {/* SUCCESS STATE */}
          {paid && (
            <div className="bg-card border border-emerald-500/30 rounded-xl p-8 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-foreground mb-2">Payment Confirmed</h2>
              <p className="text-muted-foreground text-sm mb-4">
                Your payment has been processed successfully. You'll receive a receipt shortly.
              </p>
              {invoice && (
                <div className="bg-background/50 rounded-lg p-4 text-left text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Invoice</span><span>{invoice.invoiceNumber}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-bold text-primary">${invoice.totalAmount?.toFixed(2)}</span></div>
                </div>
              )}
              <a href="/" className="inline-block mt-6 text-primary text-sm font-medium hover:underline">Back to Nick's Tire & Auto</a>
            </div>
          )}

          {/* LOOKUP FORM */}
          {!paid && !invoice && (
            <div className="bg-card border border-border/50 rounded-xl p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">Invoice Number</label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
                    <input
                      type="text"
                      value={invoiceNum}
                      onChange={(e) => { setInvoiceNum(e.target.value); setLooked(false); }}
                      placeholder="INV-0001 or order number"
                      className="w-full bg-background border border-border/50 rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-primary/50"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">Phone Number (for verification)</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => { setPhone(e.target.value); setLooked(false); }}
                      placeholder={BUSINESS.phone.placeholder}
                      className="w-full bg-background border border-border/50 rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-primary/50"
                    />
                  </div>
                </div>
                <button
                  onClick={() => setLooked(true)}
                  disabled={!invoiceNum.trim() || phone.length < 7 || invoiceQuery.isFetching}
                  className="w-full bg-primary text-primary-foreground btn-premium py-3 rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center justify-center gap-2 stagger-in"
                >
                  {invoiceQuery.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  Look Up Invoice
                </button>
                {looked && !invoiceQuery.isFetching && !invoice && (
                  <p className="text-red-400 text-xs text-center">Invoice not found. Check the number and phone, or call {BUSINESS.phone.display}.</p>
                )}
              </div>
            </div>
          )}

          {/* INVOICE FOUND — SHOW DETAILS + PAYMENT OPTIONS */}
          {!paid && invoice && (
            <div className="space-y-4">
              {/* Invoice summary */}
              <div className="bg-card border border-border/50 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold tracking-wider text-muted-foreground">INVOICE {invoice.invoiceNumber}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    invoice.paymentStatus === "paid" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
                  }`}>{(invoice.paymentStatus || "pending").toUpperCase()}</span>
                </div>
                <p className="text-lg font-bold text-foreground">{invoice.customerName}</p>
                {invoice.vehicleInfo && <p className="text-xs text-muted-foreground">{invoice.vehicleInfo}</p>}
                {invoice.serviceDescription && <p className="text-sm text-muted-foreground mt-2">{invoice.serviceDescription}</p>}
                <div className="border-t border-border/30 mt-3 pt-3 space-y-1.5">
                  {(invoice.laborCost ?? 0) > 0 && (
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Labor</span><span>${invoice.laborCost?.toFixed(2)}</span></div>
                  )}
                  {(invoice.partsCost ?? 0) > 0 && (
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Parts</span><span>${invoice.partsCost?.toFixed(2)}</span></div>
                  )}
                  {(invoice.taxAmount ?? 0) > 0 && (
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tax</span><span>${invoice.taxAmount?.toFixed(2)}</span></div>
                  )}
                  <div className="flex justify-between text-lg font-bold pt-1 border-t border-border/20">
                    <span>Total</span><span className="text-primary">${invoice.totalAmount?.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Already paid */}
              {!invoice.canPay && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-emerald-400">This invoice has been paid. Thank you!</p>
                </div>
              )}

              {/* Payment options */}
              {invoice.canPay && (
                <div className="bg-card border border-border/50 rounded-xl p-5">
                  <div className="flex items-center gap-2 stagger-in mb-4">
                    <Lock className="w-4 h-4 text-primary/60" />
                    <span className="text-sm font-semibold text-foreground">Payment Options</span>
                  </div>

                  {/* Call to pay — primary action */}
                  <div className="space-y-3">
                    <a
                      href={`tel:${BUSINESS.phone.raw}`}
                      className="w-full bg-primary text-primary-foreground btn-premium py-3.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 stagger-in"
                    >
                      <PhoneCall className="w-4 h-4" />
                      Call to Pay — {BUSINESS.phone.display}
                    </a>

                    <p className="text-[11px] text-muted-foreground text-center">
                      Call us and we'll process your payment securely over the phone.
                      {stripeEnabled && " Online payment coming soon."}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 stagger-in mt-4 pt-3 border-t border-border/20">
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Shield className="w-3 h-3" /> Secure payment
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Lock className="w-3 h-3" /> PCI compliant
                    </div>
                  </div>

                  {/* Financing option */}
                  <div className="mt-4 pt-3 border-t border-border/20 text-center">
                    <p className="text-[11px] text-muted-foreground mb-2">Need financing?</p>
                    <div className="flex gap-2 justify-center">
                      <a
                        href="https://getsnap.snapfinance.com/lease/en-US/consumer/apply?ep=store-locator&merchantId=490295617&externalMerchantId=77661"
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 bg-[#FF6B00] text-white px-4 py-2 rounded-lg text-xs font-medium hover:bg-[#FF6B00]/90 transition-colors"
                      >
                        <Zap className="w-3 h-3" /> Snap Finance
                      </a>
                      <a
                        href="https://acima.us/1TjEOYtr6C"
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-medium hover:bg-blue-600/90 transition-colors"
                      >
                        <Shield className="w-3 h-3" /> Acima Credit
                      </a>
                    </div>
                    <p className="text-[9px] text-muted-foreground mt-1">Apply in seconds. No hard credit check.</p>
                  </div>
                </div>
              )}

              <button
                onClick={() => { setLooked(false); setInvoiceNum(""); setPhone(""); }}
                className="w-full text-muted-foreground text-xs hover:text-foreground text-center py-2"
              >
                Look up a different invoice
              </button>
            </div>
          )}

          {/* Disclaimers */}
          <div className="mt-8 pt-4 border-t border-border/20 space-y-1 text-center">
            <p className="text-[10px] text-muted-foreground/60">{SHORT_DISCLAIMERS.paymentTerms}</p>
            <p className="text-[10px] text-muted-foreground/60">{SHORT_DISCLAIMERS.noRefunds}</p>
          </div>
        </div>
      </section>
    </PageLayout>
  );
}
