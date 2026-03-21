/**
 * /refer — Referral Program page
 * Refer a friend, both get $25 off.
 */

import PageLayout from "@/components/PageLayout";
import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { Users, Gift, CheckCircle, Heart } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { trpc } from "@/lib/trpc";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";

export default function ReferralPage() {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    referrerName: "", referrerPhone: "", referrerEmail: "",
    refereeName: "", refereePhone: "", refereeEmail: "",
  });

  const submitReferral = trpc.referrals.submit.useMutation({
    onSuccess: () => setSubmitted(true),
  });

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitReferral.mutate({
      ...form,
      referrerEmail: form.referrerEmail || undefined,
      refereeEmail: form.refereeEmail || undefined,
    });
  };

}
