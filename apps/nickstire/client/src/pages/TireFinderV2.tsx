import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  ChevronRight,
  CircleDot,
  Clock,
  Filter,
  Info,
  Loader2,
  MapPin,
  Package,
  Phone,
  Search,
  ShieldCheck,
  Star,
  Truck,
  X,
} from "lucide-react";
import PageLayout from "@/components/PageLayout";
import { Breadcrumbs, SEOHead, trackEvent, trackPhoneClick } from "@/components/SEO";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FAQPageSchema, { TIRE_BUYING_FAQ } from "@/components/FAQPageSchema";
import { trpc } from "@/lib/trpc";
import { getU