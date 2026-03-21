/**
 * AI Labor Estimator — detailed repair cost estimates powered by AI.
 * Customers enter Year/Make/Model + describe the repair.
 * AI generates a full breakdown: labor hours, parts, total cost range.
 * Feeds into lead capture for conversion.
 */
import { useState, useRef } from "react";
import PageLayout from "@/components/PageLayout";
import InternalLinks from "@/components/InternalLinks";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import {
  Calculator, Car, Wrench, Clock, Phone, ChevronRight, DollarSign,
  FileText, AlertTriangle, Loader2, RotateCcw, ArrowRight, Info,
} from "lucide-react";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import { motion, useInView } from "framer-motion";
import { Link } from "wouter";
import FadeIn from "@/components/FadeIn";

// Common vehicle makes for quick selection
const POPULAR_MAKES = [
  "Toyota", "Honda", "Ford", "Chevrolet", "Nissan", "Hyundai",
  "Kia", "Jeep", "Dodge", "BMW", "Subaru", "Volkswagen",
];

// Common repair categories for quick selection
const COMMON_REPAIRS = [
  { label: "Brake Pads & Rotors", value: "Brake pads and rotors replacement" },
  { label: "Oil Change (Synthetic)", value: "Full synthetic oil change" },
  { label: "Check Engine Light Diagnosis", value: "Check engine light diagnostic and repair" },
  { label: "Struts / Shocks", value: "Struts or shocks replacement" },
  { label: "Tire Mount & Balance", value: "Tire mounting and balancing for 4 tires" },
  { label: "AC Repair", value: "AC system diagnosis and repair - not blowing cold" },
  { label: "Wheel Alignment", value: "Four-wheel alignment" },
  { label: "Alternator Replacement", value: "Alternator replacement" },
  { label: "Emissions / E-Check Repair", value: "Ohio E-Check emissions repair" },
  { label: "Wheel Bearing", value: "Wheel bearing replacement" },
  { label: "Tie Rod Ends", value: "Tie rod end replacement" },
  { label: "Water Pump", value: "Water pump replacement" },
];

// Generate year options (current year down to 1990)
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: currentYear - 1989 }, (_, i) => String(currentYear + 1 - i));

export default function LaborEstimator() {
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [mileage, setMileage] = useState("");
  const [repairDescription, setRepairDescription] = useState("");
  const [customRepair, setCustomRepair] = useState(false);

  const estimateMutation = trpc.laborEstimate.generate.useMutation();

  const canSubmit = year && make && model && repairDescription.trim().length >= 3;

  const handleSubmit = () => {
    if (!canSubmit) return;
    estimateMutation.mutate({
      year,
      make,
      model,
      mileage: mileage || undefined,
      repairDescription,
    });
  };

  const handleReset = () => {
    setYear("");
    setMake("");
    setModel("");
    setMileage("");
    setRepairDescription("");
    setCustomRepair(false);
    estimateMutation.reset();
  };

  const result = estimateMutation.data;

}
