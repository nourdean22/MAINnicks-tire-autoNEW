/**
 * Standalone /contact page for Nick's Tire & Auto
 * Provides full contact information, embedded Google Map, booking form,
 * and structured data for local SEO.
 */

import InternalLinks from "@/components/InternalLinks";
import PageLayout from "@/components/PageLayout";
import { useEffect, useRef } from "react";
import BookingForm from "@/components/BookingForm";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { Phone, MapPin, Clock, Star, Navigation } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { BUSINESS } from "@shared/business";
import { GBP_REVIEW_URL } from "@shared/const";
import FadeIn from "@/components/FadeIn";

function ContactSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    name: "Nick's Tire & Auto",
    telephone: `+1-${BUSINESS.phone.dashed}`,
    url: "https://nickstire.org/contact",
    address: {
      "@type": "PostalAddress",
      streetAddress: BUSINESS.address.street,
      addressLocality: "Cleveland",
      addressRegion: "OH",
      postalCode: "44112",
      addressCountry: "US",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: 41.5525118,
      longitude: -81.5571875,
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        opens: "08:00",
        closes: "18:00",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "Sunday",
        opens: "09:00",
        closes: "16:00",
      },
    ],
    hasMap: "https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid/@41.5525118,-81.5571875,17z/",
    sameAs: [...BUSINESS.sameAs],
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: String(BUSINESS.reviews.rating),
      reviewCount: String(BUSINESS.reviews.count),
      bestRating: "5",
    },
    image: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp",
    priceRange: "$$",
  };

export default function Contact() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

