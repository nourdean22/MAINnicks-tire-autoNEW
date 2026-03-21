/**
 * /my-garage — Customer vehicle management & service history
 * Logged-in users can save vehicles, track service history, and see maintenance reminders.
 */

import PageLayout from "@/components/PageLayout";
import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Car, Plus, Trash2, Wrench, Calendar, AlertTriangle, ChevronRight, Gauge } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { trpc } from "@/lib/trpc";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import { QueryError } from "@/components/QueryState";
import FadeIn from "@/components/FadeIn";

// ─── ADD VEHICLE FORM ──────────────────────────────────
function AddVehicleForm({ onClose }: { onClose: () => void }) {
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [mileage, setMileage] = useState("");
  const [nickname, setNickname] = useState("");

  const utils = trpc.useUtils();
  const addVehicle = trpc.garage.addVehicle.useMutation({
    onSuccess: () => {
      utils.garage.vehicles.invalidate();
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addVehicle.mutate({
      year,
      make,
      model,
      mileage: mileage ? parseInt(mileage) : undefined,
      nickname: nickname || undefined,
    });
  };

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 35 }, (_, i) => String(currentYear - i));


// ─── VEHICLE CARD ──────────────────────────────────────
function VehicleCard({ vehicle }: { vehicle: any }) {
  const utils = trpc.useUtils();
  const deleteVehicle = trpc.garage.deleteVehicle.useMutation({
    onSuccess: () => utils.garage.vehicles.invalidate(),
  });


function getMaintenanceItems(mileage?: number) {
  const m = mileage || 0;
  return [
    { label: "Oil Change (every 5,000 mi)", due: m > 0 && m % 5000 > 4000 },
    { label: "Tire Rotation (every 7,500 mi)", due: m > 0 && m % 7500 > 6500 },
    { label: "Brake Inspection (every 15,000 mi)", due: m > 0 && m % 15000 > 13000 },
    { label: "Air Filter (every 15,000–30,000 mi)", due: m > 15000 && m % 20000 > 18000 },
    { label: "Coolant Flush (every 30,000 mi)", due: m > 30000 && m % 30000 > 27000 },
    { label: "Transmission Service (every 60,000 mi)", due: m > 60000 && m % 60000 > 55000 },
  ];

export default function MyGaragePage() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: vehicles, isLoading , isError, error } = trpc.garage.vehicles.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const { data: serviceHistory , isError: historyError } = trpc.garage.serviceHistory.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

