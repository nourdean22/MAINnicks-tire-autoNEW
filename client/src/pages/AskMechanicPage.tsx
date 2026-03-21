/**
 * /ask — Ask a Mechanic public Q&A page
 * Customers ask questions, Nick's team answers publicly. Builds authority and SEO.
 */

import PageLayout from "@/components/PageLayout";
import { useState, useEffect, useRef } from "react";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { MessageCircle, ChevronRight, CheckCircle, HelpCircle, Search } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { trpc } from "@/lib/trpc";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import { QueryError } from "@/components/QueryState";
import FadeIn from "@/components/FadeIn";

const CATEGORIES = ["All", "Engine", "Brakes", "Tires", "Electrical", "Suspension", "Emissions", "Maintenance", "Other"];

export default function AskMechanicPage() {
  const [showForm, setShowForm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [filterCategory, setFilterCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState({ questionerName: "", questionerEmail: "", question: "", vehicleInfo: "", category: "" });

  const { data: questions, isLoading , isError, error } = trpc.qa.published.useQuery(undefined, { staleTime: 5 * 60 * 1000 });

  const submitQuestion = trpc.qa.ask.useMutation({
    onSuccess: () => setSubmitted(true),
  });

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitQuestion.mutate({
      ...form,
      questionerEmail: form.questionerEmail || undefined,
      vehicleInfo: form.vehicleInfo || undefined,
      category: form.category || undefined,
    });
  };

  const filteredQuestions = (questions ?? []).filter((q: any) => {
    const matchesCategory = filterCategory === "All" || q.category === filterCategory;
    const matchesSearch = !searchQuery || q.question.toLowerCase().includes(searchQuery.toLowerCase()) || (q.answer && q.answer.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

