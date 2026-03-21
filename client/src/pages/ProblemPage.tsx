import PageLayout from "@/components/PageLayout";
import { useParams } from "wouter";
import { Link } from "wouter";
import { Phone, ChevronRight, AlertOctagon } from "lucide-react";
import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { getProblemBySlug } from "@shared/seo-pages";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import FadeIn from "@/components/FadeIn";

function trackPhoneClick(location: string) {
  if (typeof window !== "undefined" && (window as any).gtag) {
    (window as any).gtag("event", "phone_call_click", { event_category: "conversion", event_label: location });
  }

function LikelihoodBadge({ likelihood }: { likelihood: string }) {
  const colors = {
    "Common": "bg-red-500/20 text-red-400 border-red-500/30",
    "Moderate": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    "Less Common": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  };

export default function ProblemPage() {
  const { slug } = useParams<{ slug: string }>();
  const page = slug ? getProblemBySlug(slug) : undefined;

  if (!page) {
  }

  const breadcrumbs = [
    { label: "Services", href: "/#services" },
    { label: page.heroHeadline.replace("\n", " ").replace("?", "") },
  ];

}
