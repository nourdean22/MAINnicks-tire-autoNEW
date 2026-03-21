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
import { GBP_REVIEW_URL } from "@shared/const";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";

// Use centralized review URL from shared constants
const GOOGLE_REVIEW_URL = GBP_REVIEW_URL;


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
  }

}
