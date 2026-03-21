/*
 * BLOG / TIPS — SEO content hub for Nick's Tire & Auto
 * Lists all maintenance articles with category filtering
 */

import InternalLinks from "@/components/InternalLinks";
import PageLayout from "@/components/PageLayout";
import { useRef } from "react";
import { Link } from "wouter";
import { BLOG_ARTICLES } from "@shared/blog";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { Phone, Clock, ArrowRight } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { useState } from "react";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";

// Get unique categories
const categories = ["All", ...Array.from(new Set(BLOG_ARTICLES.map(a => a.category)))];

export default function Blog() {
  const [activeCategory, setActiveCategory] = useState("All");

  const filtered = activeCategory === "All"
    ? BLOG_ARTICLES
    : BLOG_ARTICLES.filter(a => a.category === activeCategory);

