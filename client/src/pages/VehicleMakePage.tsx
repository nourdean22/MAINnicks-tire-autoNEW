import PageLayout from "@/components/PageLayout";
import { useParams } from "wouter";
import { Link } from "wouter";
import { Phone, ChevronRight, Wrench, AlertTriangle } from "lucide-react";
import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { getVehicleMakeBySlug } from "@shared/seo-pages";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import FadeIn from "@/components/FadeIn";

function trackPhoneClick(location: string) {
  if (typeof window !== "undefined" && (window as any).gtag) {
    (window as any).gtag("event", "phone_call_click", { event_category: "conversion", event_label: location });
  }

export default function VehicleMakePage() {
  const { slug } = useParams<{ slug: string }>();
  const page = slug ? getVehicleMakeBySlug(slug) : undefined;

  if (!page) {
  }

  const breadcrumbs = [
    { label: "Services", href: "/#services" },
    { label: `${page.make} Repair Cleveland` },
  ];

}
