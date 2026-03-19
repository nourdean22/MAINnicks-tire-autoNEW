/**
 * /review — Review Generation Page
 * Dedicated page that sends customers directly to Google review form.
 * Includes QR code for shop counter display and printable version.
 */

import PageLayout from "@/components/PageLayout";
import { useEffect, useRef, useState } from "react";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { Star, ExternalLink, Phone, MapPin, Printer, CheckCircle, ThumbsUp } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 30 }} animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }} transition={{ duration: 0.5, delay, ease: "easeOut" }} className={className}>
      {children}
    </motion.div>
  );
}

// Nick's Tire & Auto Google Business Profile review link
const GOOGLE_REVIEW_URL = "https://search.google.com/local/writereview?placeid=ChIJO7C_qEPvMIgRwSCJPHiGjhE";


export default function ReviewPage() {
  const [showPrintView, setShowPrintView] = useState(false);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const handlePrint = () => {
    setShowPrintView(true);
    setTimeout(() => {
      window.print();
      setShowPrintView(false);
    }, 300);
  };

  // Track review link clicks via Meta Pixel
  const handleReviewClick = () => {
    if (typeof window !== "undefined" && (window as any).fbq) {
      (window as any).fbq("trackCustom", "ReviewLinkClick", {
        source: "review_page",
      });
    }
    if (typeof window !== "undefined" && (window as any).gtag) {
      (window as any).gtag("event", "review_click", {
        event_category: "engagement",
        event_label: "google_review",
      });
    }
  };

  // Print-only view for shop counter QR code card
  if (showPrintView) {
    return (
      <div className="print-review-card bg-white min-h-screen flex items-center justify-center p-8">
        <div className="text-center max-w-md mx-auto">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">NICK'S TIRE & AUTO</h1>
            <p className="text-gray-600 text-lg">Cleveland, Ohio</p>
          </div>
          <div className="mb-6">
            <div className="flex justify-center gap-1 mb-3">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-8 h-8 fill-yellow-500 text-yellow-500" />
              ))}
            </div>
            <p className="text-2xl font-bold text-gray-900 mb-1">{`4.9 Stars — ${BUSINESS.reviews.countDisplay} Reviews`}</p>
          </div>
          <div className="border-2 border-gray-300 rounded-lg p-6 mb-6 inline-block">
            <QRCodeSVG
              value={GOOGLE_REVIEW_URL}
              size={200}
              level="H"
              includeMargin={true}
              bgColor="#ffffff"
              fgColor="#1a1a1a"
            />
          </div>
          <div>
            <p className="text-xl font-bold text-gray-900 mb-2">SCAN TO LEAVE A REVIEW</p>
            <p className="text-gray-600">Your feedback helps us serve Cleveland drivers better.</p>
            <p className="text-gray-500 text-sm mt-4">{BUSINESS.address.full}</p>
            <p className="text-gray-500 text-sm">{BUSINESS.phone.display}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PageLayout>
      <SEOHead
        title="Leave a Review — Nick's Tire & Auto Cleveland"
        description="Had a great experience at Nick's Tire & Auto? Leave us a Google review. Your feedback helps other Cleveland drivers find honest, reliable auto repair."
        canonicalPath="/review"
      />
      <Breadcrumbs items={[
        { label: "Home", href: "/" },
        { label: "Leave a Review" },
      ]} />
      <LocalBusinessSchema />

      {/* Hero Section */}
      <section className="relative bg-nick-dark pt-28 pb-16 lg:pt-36 lg:pb-24">
        <div className="absolute inset-0 bg-gradient-to-b from-nick-dark via-nick-dark/95 to-nick-dark" />
        <div className="relative container text-center">
          <FadeIn>
            <div className="flex justify-center gap-1 mb-6">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-8 h-8 fill-primary text-primary" />
              ))}
            </div>
            <h1 className="font-heading font-bold text-4xl sm:text-5xl lg:text-6xl text-foreground tracking-tight mb-4">
              YOUR FEEDBACK<br />
              <span className="text-gradient-yellow">MEANS EVERYTHING</span>
            </h1>
            <p className="text-lg sm:text-xl text-foreground/70 max-w-2xl mx-auto leading-relaxed mb-8">
              Had a good experience at Nick's Tire & Auto? A quick Google review helps other Cleveland drivers find honest, reliable auto repair. It takes less than a minute.
            </p>
          </FadeIn>

          <FadeIn delay={0.15}>
            <a
              href={GOOGLE_REVIEW_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleReviewClick}
              className="inline-flex items-center justify-center gap-3 bg-primary text-primary-foreground px-10 py-5 font-heading font-bold text-xl tracking-wider uppercase hover:bg-primary/90 transition-colors"
            >
              <Star className="w-6 h-6" />
              LEAVE A GOOGLE REVIEW
              <ExternalLink className="w-5 h-5" />
            </a>
          </FadeIn>

          <FadeIn delay={0.25}>
            <p className="mt-6 text-foreground/50 text-sm">
              Opens Google Reviews in a new tab — takes about 30 seconds
            </p>
          </FadeIn>
        </div>
      </section>

      {/* QR Code Section */}
      <section className="section-darker py-16 lg:py-24">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <FadeIn>
              <div className="text-center lg:text-left">
                <span className="font-mono text-primary text-sm tracking-widest uppercase">Scan & Review</span>
                <h2 className="font-heading font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight mb-6">
                  QR CODE FOR THE<br />
                  <span className="text-gradient-yellow">SHOP COUNTER</span>
                </h2>
                <p className="text-foreground/70 leading-relaxed text-lg mb-6">
                  Print this QR code and place it at the front counter, on your business cards, or in the waiting area. Customers scan it with their phone camera and go straight to the Google review form.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                  <button
                    onClick={handlePrint}
                    className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-3 font-heading font-bold text-sm tracking-wider uppercase hover:bg-primary/90 transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                    PRINT QR CODE CARD
                  </button>
                </div>
              </div>
            </FadeIn>

            <FadeIn delay={0.15}>
              <div className="flex justify-center">
                <div className="bg-white p-8 rounded-sm shadow-lg text-center">
                  <QRCodeSVG
                    value={GOOGLE_REVIEW_URL}
                    size={220}
                    level="H"
                    includeMargin={true}
                    bgColor="#ffffff"
                    fgColor="#1a1a1a"
                  />
                  <p className="text-gray-900 font-bold text-lg mt-4">SCAN TO REVIEW</p>
                  <p className="text-gray-500 text-sm mt-1">Nick's Tire & Auto — Cleveland, OH</p>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Why Reviews Matter Section */}
      <section className="section-dark py-16 lg:py-24">
        <div className="container">
          <FadeIn>
            <div className="text-center mb-14">
              <span className="font-mono text-primary text-sm tracking-widest uppercase">Why It Matters</span>
              <h2 className="font-heading font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight">
                YOUR REVIEW HELPS<br />
                <span className="text-gradient-yellow">OTHER DRIVERS</span>
              </h2>
            </div>
          </FadeIn>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {[
              {
                icon: <ThumbsUp className="w-8 h-8" />,
                title: "BUILDS TRUST",
                desc: "When you share your honest experience, it helps other Cleveland drivers find a shop they can count on. Real reviews from real customers matter more than any ad.",
              },
              {
                icon: <CheckCircle className="w-8 h-8" />,
                title: "KEEPS US ACCOUNTABLE",
                desc: "Your feedback — positive or constructive — helps us improve. We read every review and use it to make our service better for everyone.",
              },
              {
                icon: <Star className="w-8 h-8" />,
                title: "SUPPORTS LOCAL",
                desc: "Every review helps a locally owned Cleveland shop compete against the big chains. Your support keeps honest, independent auto repair alive in the neighborhood.",
              },
            ].map((item, i) => (
              <FadeIn key={item.title} delay={i * 0.1}>
                <div className="text-center p-6">
                  <div className="text-primary mb-4 flex justify-center">{item.icon}</div>
                  <h3 className="font-heading font-bold text-lg text-foreground tracking-wider mb-3">{item.title}</h3>
                  <p className="text-foreground/60 leading-relaxed text-sm">{item.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Current Rating Section */}
      <section className="section-darker py-16 lg:py-20">
        <div className="container text-center">
          <FadeIn>
            <div className="flex justify-center gap-1 mb-4">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-10 h-10 fill-primary text-primary" />
              ))}
            </div>
            <p className="font-heading font-bold text-5xl lg:text-6xl text-foreground mb-2">4.9</p>
            <p className="font-mono text-primary text-lg tracking-wider mb-4">{BUSINESS.reviews.countDisplay} GOOGLE REVIEWS</p>
            <p className="text-foreground/60 text-lg max-w-xl mx-auto mb-8">
              Cleveland drivers have spoken. Join them in sharing your experience.
            </p>
            <a
              href={GOOGLE_REVIEW_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleReviewClick}
              className="inline-flex items-center justify-center gap-3 bg-primary text-primary-foreground px-10 py-5 font-heading font-bold text-xl tracking-wider uppercase hover:bg-primary/90 transition-colors"
            >
              <Star className="w-6 h-6" />
              LEAVE YOUR REVIEW
              <ExternalLink className="w-5 h-5" />
            </a>
          </FadeIn>
        </div>
      </section>

      {/* Contact / Concern Section */}
      <section className="section-dark py-16 lg:py-20">
        <div className="container text-center max-w-2xl mx-auto">
          <FadeIn>
            <h2 className="font-heading font-bold text-2xl lg:text-3xl text-foreground tracking-tight mb-6">
              HAD AN ISSUE? <span className="text-gradient-yellow">TALK TO US FIRST</span>
            </h2>
            <p className="text-foreground/70 leading-relaxed text-lg mb-8">
              If something was not right with your visit, we want to hear about it directly. Call us and we will make it right. Our reputation is built on doing right by every customer.
            </p>
            <a
              href={BUSINESS.phone.href}
              onClick={() => trackPhoneClick("review_page_concern")}
              className="inline-flex items-center justify-center gap-2 border-2 border-primary text-primary px-8 py-4 font-heading font-bold text-lg tracking-wider uppercase hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              <Phone className="w-5 h-5" />
              {BUSINESS.phone.display}
            </a>
            <div className="mt-8 flex flex-wrap justify-center gap-6 text-sm text-foreground/50">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" />
                <span className="font-mono">{BUSINESS.address.full}</span>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>
    
      <InternalLinks />
</PageLayout>
  );
}
