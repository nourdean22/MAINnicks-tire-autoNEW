/**
 * /my-garage — Customer vehicle management & service history
 * Logged-in users can save vehicles, track service history, and see maintenance reminders.
 */

import PageLayout from "@/components/PageLayout";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
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

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 30 }} animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }} transition={{ duration: 0.5, delay, ease: "easeOut" }} className={className}>
      {children}
    </motion.div>
  );
}

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
    onError: () => toast.error("Something went wrong. Please try again."),
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

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="border border-primary/30 bg-background/50 p-6 lg:p-8">
      <h3 className="font-semibold font-bold text-foreground text-xl tracking-wide mb-6">ADD A VEHICLE</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-foreground/60 text-sm mb-1">Year</label>
            <select value={year} onChange={(e) => setYear(e.target.value)} required className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none">
              <option value="">Select Year</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-foreground/60 text-sm mb-1">Make</label>
            <input type="text" value={make} onChange={(e) => setMake(e.target.value)} required placeholder="e.g. Toyota" className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none placeholder:text-foreground/30" />
          </div>
          <div>
            <label className="block text-foreground/60 text-sm mb-1">Model</label>
            <input type="text" value={model} onChange={(e) => setModel(e.target.value)} required placeholder="e.g. Camry" className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none placeholder:text-foreground/30" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-foreground/60 text-sm mb-1">Current Mileage (optional)</label>
            <input type="number" value={mileage} onChange={(e) => setMileage(e.target.value)} placeholder="e.g. 85000" className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none placeholder:text-foreground/30" />
          </div>
          <div>
            <label className="block text-foreground/60 text-sm mb-1">Nickname (optional)</label>
            <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="e.g. Daily Driver" className="w-full bg-background border border-primary/20 text-foreground px-3 py-2.5 focus:border-primary outline-none placeholder:text-foreground/30" />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={addVehicle.isPending} className="bg-primary text-primary-foreground px-6 py-2.5 font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors disabled:opacity-50">
            {addVehicle.isPending ? "ADDING..." : "ADD VEHICLE"}
          </button>
          <button type="button" onClick={onClose} className="border border-foreground/30 text-foreground px-6 py-2.5 font-semibold font-bold text-sm tracking-wide hover:border-primary hover:text-primary transition-colors">
            CANCEL
          </button>
        </div>
      </form>
    </motion.div>
  );
}

// ─── VEHICLE CARD ──────────────────────────────────────
function VehicleCard({ vehicle }: { vehicle: any }) {
  const utils = trpc.useUtils();
  const deleteVehicle = trpc.garage.deleteVehicle.useMutation({
    onSuccess: () => utils.garage.vehicles.invalidate(),
    onError: () => toast.error("Something went wrong. Please try again."),
  });

  return (
    <div className="border border-primary/15 bg-background/50 p-6 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-primary/10 flex items-center justify-center rounded-md">
            <Car className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold font-bold text-foreground text-lg tracking-wider">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h3>
            {vehicle.nickname && (
              <span className="text-nick-blue-light text-sm">"{vehicle.nickname}"</span>
            )}
          </div>
        </div>
        <button
          onClick={() => { if (confirm("Remove this vehicle?")) deleteVehicle.mutate({ id: vehicle.id }); }}
          className="text-foreground/30 hover:text-red-400 transition-colors p-1"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {vehicle.mileage && (
        <div className="mt-4 flex items-center gap-2 text-foreground/60 text-sm">
          <Gauge className="w-4 h-4 text-nick-blue-light" />
          <span className="font-mono">{vehicle.mileage.toLocaleString()} miles</span>
        </div>
      )}

      {/* Maintenance Recommendations */}
      <div className="mt-4 pt-4 border-t border-primary/10">
        <h4 className="font-semibold font-bold text-foreground/80 text-xs tracking-wide mb-3">RECOMMENDED MAINTENANCE</h4>
        <div className="space-y-2">
          {getMaintenanceItems(vehicle.mileage).map((item, i) => (
            <div key={i} className={`flex items-center gap-2 text-sm ${item.due ? "text-primary" : "text-foreground/40"}`}>
              {item.due ? <AlertTriangle className="w-3.5 h-3.5" /> : <Wrench className="w-3.5 h-3.5" />}
              <span className="text-[12px]">{item.label}</span>
              {item.due && <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">DUE</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-primary/10">
        <Link href="/contact" className="inline-flex items-center gap-2 text-primary text-sm font-semibold font-bold tracking-wide hover:text-primary transition-colors">
          BOOK SERVICE FOR THIS VEHICLE
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

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
}

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

  return (
    <PageLayout showChat={true}>
      <SEOHead
        title="My Garage | Nick's Tire & Auto Cleveland"
        description="Save your vehicles, track service history, and get personalized maintenance reminders at Nick's Tire & Auto in Cleveland."
        canonicalPath="/my-garage"
      />
      <LocalBusinessSchema />
      
        {/* Hero */}
        <section className="relative pt-32 lg:pt-40 pb-12 lg:pb-16 bg-background">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--nick-yellow-alpha)_0%,_transparent_60%)] opacity-20" />
          <div className="relative container">
            <Breadcrumbs items={[{ label: "My Garage" }]} />
            <FadeIn>
              <div className="flex items-center gap-3 mb-4">
                <Car className="w-6 h-6 text-primary" />
                <span className="font-mono text-nick-blue-light text-sm tracking-wide">Your Vehicles</span>
              </div>
              <h1 className="font-semibold font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground tracking-tight leading-[0.95]">
                MY <span className="text-primary">GARAGE</span>
              </h1>
              <p className="mt-4 text-foreground/70 text-lg max-w-2xl leading-relaxed">
                Save your vehicles, track service history, and get personalized maintenance reminders.
              </p>
            </FadeIn>
          </div>
        </section>

        {/* Content */}
        <section className="py-12 lg:py-16 bg-[oklch(0.055_0.004_260)]">
          <div className="container">
            {authLoading ? (
              <div className="text-center py-20">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-foreground/50 mt-4 text-[13px]">Loading...</p>
              </div>
            ) : !isAuthenticated ? (
              <FadeIn>
                <div className="text-center py-20 max-w-lg mx-auto">
                  <Car className="w-16 h-16 text-primary/30 mx-auto mb-6" />
                  <h2 className="font-semibold font-bold text-2xl text-foreground tracking-[-0.01em] mb-4">SIGN IN TO ACCESS YOUR GARAGE</h2>
                  <p className="text-foreground/60 mb-8 leading-relaxed">
                    Create an account or sign in to save your vehicles, track service history, and get personalized maintenance reminders.
                  </p>
                  <a
                    href={getLoginUrl()}
                    className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3 font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors"
                  >
                    SIGN IN
                    <ChevronRight className="w-4 h-4" />
                  </a>
                </div>
              </FadeIn>
            ) : (
              <>
                {/* Welcome */}
                <FadeIn>
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h2 className="font-semibold font-bold text-2xl text-foreground tracking-wider">
                        {user?.name ? `Welcome back, ${user.name.split(" ")[0]}` : "Your Vehicles"}
                      </h2>
                      <p className="text-foreground/50 text-sm mt-1">
                        {vehicles?.length ?? 0} vehicle{(vehicles?.length ?? 0) !== 1 ? "s" : ""} saved
                      </p>
                    </div>
                    <button
                      onClick={() => setShowAddForm(true)}
                      className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      ADD VEHICLE
                    </button>
                  </div>
                </FadeIn>

                {showAddForm && (
                  <div className="mb-8">
                    <AddVehicleForm onClose={() => setShowAddForm(false)} />
                  </div>
                )}

                {/* Vehicles Grid */}
                {isError ? (
              <QueryError message="Failed to load data. Please try again." onRetry={() => window.location.reload()} />
            ) : isLoading ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {[1, 2].map((i) => (
                      <div key={i} className="border border-primary/10 bg-background/30 p-6 animate-pulse">
                        <div className="h-6 w-48 bg-foreground/10 rounded mb-4" />
                        <div className="h-4 w-32 bg-foreground/5 rounded" />
                      </div>
                    ))}
                  </div>
                ) : vehicles && vehicles.length > 0 ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {vehicles.map((v: any) => (
                      <FadeIn key={v.id}>
                        <VehicleCard vehicle={v} />
                      </FadeIn>
                    ))}
                  </div>
                ) : (
                  <FadeIn>
                    <div className="text-center py-16 border border-dashed border-primary/20">
                      <Car className="w-12 h-12 text-primary/20 mx-auto mb-4" />
                      <h3 className="font-semibold font-bold text-foreground/60 text-lg tracking-[-0.01em] mb-2">NO VEHICLES YET</h3>
                      <p className="text-foreground/40 text-sm mb-6">Add your first vehicle to get personalized maintenance reminders.</p>
                      <button
                        onClick={() => setShowAddForm(true)}
                        className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        ADD YOUR FIRST VEHICLE
                      </button>
                    </div>
                  </FadeIn>
                )}

                {/* Service History */}
                {serviceHistory && serviceHistory.length > 0 && (
                  <div className="mt-12">
                    <h2 className="font-semibold font-bold text-2xl text-foreground tracking-[-0.01em] mb-6">SERVICE HISTORY</h2>
                    <div className="space-y-4">
                      {serviceHistory.map((record: any) => (
                        <div key={record.id} className="border border-primary/10 bg-background/30 p-5 flex items-center gap-4">
                          <div className="w-10 h-10 bg-nick-blue/10 flex items-center justify-center rounded-md shrink-0">
                            <Wrench className="w-5 h-5 text-nick-blue-light" />
                          </div>
                          <div className="flex-1">
                            <h4 className="font-semibold font-bold text-foreground text-sm tracking-wide">{record.serviceType}</h4>
                            {record.description && <p className="text-foreground/50 text-sm mt-1">{record.description}</p>}
                          </div>
                          <div className="text-right shrink-0">
                            <div className="flex items-center gap-1 text-foreground/40 text-xs">
                              <Calendar className="w-3 h-3" />
                              {new Date(record.completedAt).toLocaleDateString()}
                            </div>
                            {record.mileageAtService && (
                              <span className="text-foreground/30 text-xs">{record.mileageAtService.toLocaleString()} mi</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* Footer */}
        

    
      <InternalLinks />
</PageLayout>
  );
}
