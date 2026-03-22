/**
 * VehicleHealthDashboard — Vehicle health score visualization component
 * Displays overall health score, component status, and maintenance recommendations
 */

import { useState } from "react";
import { AlertTriangle, CheckCircle, TrendingDown, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";

interface VehicleHealthDashboardProps {
  vehicleInfo?: string;
  lastServiceDate?: string;
}

interface ComponentHealth {
  name: string;
  score: number;
  status: "Good" | "Fair" | "Due" | "Overdue";
  color: string;
}

interface Recommendation {
  id: number;
  title: string;
  urgency: "Overdue" | "Coming Due" | "On Track";
  description: string;
}

export function VehicleHealthDashboard({ vehicleInfo = "2018 Honda Civic", lastServiceDate }: VehicleHealthDashboardProps) {
  const [mileage, setMileage] = useState(45230);
  const [isSaving, setIsSaving] = useState(false);

  // Demo data
  const overallScore = 78;
  const components: ComponentHealth[] = [
    { name: "Brakes", score: 85, status: "Good", color: "bg-green-500" },
    { name: "Oil", score: 45, status: "Due", color: "bg-yellow-500" },
    { name: "Tires", score: 70, status: "Fair", color: "bg-yellow-500" },
    { name: "Alignment", score: 60, status: "Fair", color: "bg-yellow-500" },
    { name: "Fluids", score: 80, status: "Good", color: "bg-green-500" },
    { name: "Battery", score: 55, status: "Due", color: "bg-yellow-500" },
  ];

  const recommendations: Recommendation[] = [
    {
      id: 1,
      title: "Oil Change",
      urgency: "Overdue",
      description: "Overdue by 20 days — Your oil is beyond recommended change interval",
    },
    {
      id: 2,
      title: "Battery Check",
      urgency: "Coming Due",
      description: "Battery is 2 years old — Consider replacement soon to avoid issues",
    },
  ];

  const getScoreColor = (score: number) => {
    if (score >= 70) return "#22c55e"; // green
    if (score >= 40) return "#eab308"; // yellow
    return "#ef4444"; // red
  };

  const getScoreLabel = (score: number) => {
    if (score >= 70) return "Excellent";
    if (score >= 40) return "Fair";
    return "Poor";
  };

  const handleMileageSave = async () => {
    setIsSaving(true);
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500));
    setIsSaving(false);
  };

  return (
    <div className="space-y-8">
      {/* Overall Health Score */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-card/50 border border-border/50 rounded-lg p-8 text-center">
        <h3 className="font-semibold font-bold text-foreground text-lg tracking-wide mb-8">OVERALL HEALTH SCORE</h3>

        <div className="flex justify-center mb-8">
          <div className="relative w-48 h-48">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 200 200">
              {/* Background circle */}
              <circle cx="100" cy="100" r="90" fill="none" stroke="currentColor" strokeWidth="8" className="text-foreground/10" />
              {/* Progress circle */}
              <circle
                cx="100"
                cy="100"
                r="90"
                fill="none"
                stroke={getScoreColor(overallScore)}
                strokeWidth="8"
                strokeDasharray={`${(overallScore / 100) * (Math.PI * 180)} ${Math.PI * 180}`}
                strokeLinecap="round"
                className="transition-all duration-500"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-5xl font-bold text-foreground">{overallScore}</span>
              <span className="text-sm text-foreground/60 mt-1">out of 100</span>
            </div>
          </div>
        </div>

        <div className="inline-block bg-foreground/5 px-4 py-2 rounded-full">
          <span className="font-semibold font-bold text-foreground">{getScoreLabel(overallScore)}</span>
        </div>

        {lastServiceDate && <p className="text-foreground/50 text-sm mt-4">Last service: {lastServiceDate}</p>}
      </motion.div>

      {/* Component Health Bars */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card/50 border border-border/50 rounded-lg p-8">
        <h3 className="font-semibold font-bold text-foreground text-lg tracking-wide mb-6">COMPONENT HEALTH</h3>

        <div className="space-y-5">
          {components.map((component) => (
            <div key={component.name}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-foreground text-sm">{component.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-foreground/60 text-xs font-mono">{component.score}/100</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${component.status === "Good" ? "bg-green-500/20 text-green-300" : component.status === "Overdue" ? "bg-red-500/20 text-red-300" : "bg-yellow-500/20 text-yellow-300"}`}>
                    {component.status}
                  </span>
                </div>
              </div>
              <div className="w-full bg-foreground/10 rounded-full h-2 overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${component.score}%` }} transition={{ duration: 0.8, delay: 0.2 }} className={`h-full ${component.color} rounded-full`} />
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Recommendations */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-card/50 border border-border/50 rounded-lg p-8">
        <h3 className="font-semibold font-bold text-foreground text-lg tracking-wide mb-6">RECOMMENDED MAINTENANCE</h3>

        <div className="space-y-4">
          {recommendations.map((rec) => (
            <motion.div key={rec.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} className="border border-border/50 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  {rec.urgency === "Overdue" ? (
                    <div className="w-6 h-6 bg-red-500/20 rounded-full flex items-center justify-center">
                      <span className="text-red-400 font-bold">!</span>
                    </div>
                  ) : rec.urgency === "Coming Due" ? (
                    <div className="w-6 h-6 bg-yellow-500/20 rounded-full flex items-center justify-center">
                      <span className="text-yellow-400 font-bold">!</span>
                    </div>
                  ) : (
                    <CheckCircle className="w-6 h-6 text-green-400" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-semibold font-bold text-foreground text-sm">{rec.title}</h4>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${rec.urgency === "Overdue" ? "bg-red-500/20 text-red-300" : rec.urgency === "Coming Due" ? "bg-yellow-500/20 text-yellow-300" : "bg-green-500/20 text-green-300"}`}>
                      {rec.urgency === "Overdue" ? "🔴" : rec.urgency === "Coming Due" ? "🟡" : "🟢"} {rec.urgency}
                    </span>
                  </div>
                  <p className="text-foreground/60 text-xs leading-relaxed">{rec.description}</p>
                </div>
              </div>

              {rec.urgency === "Overdue" || rec.urgency === "Coming Due" ? (
                <div className="mt-3 pl-9">
                  <a href="/contact" className="inline-flex items-center gap-1 bg-primary text-primary-foreground px-3 py-1.5 rounded text-xs font-bold tracking-wide hover:opacity-90 transition-colors">
                    BOOK NOW
                  </a>
                </div>
              ) : null}
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Mileage Update */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-card/50 border border-border/50 rounded-lg p-8">
        <h3 className="font-semibold font-bold text-foreground text-lg tracking-wide mb-4">UPDATE MILEAGE</h3>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="number"
            value={mileage}
            onChange={(e) => setMileage(parseInt(e.target.value) || 0)}
            className="flex-1 bg-background border border-primary/20 text-foreground px-4 py-2.5 focus:border-primary outline-none text-sm font-mono"
            placeholder="Enter current mileage"
          />
          <button
            onClick={handleMileageSave}
            disabled={isSaving}
            className="bg-primary text-primary-foreground px-6 py-2.5 font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors disabled:opacity-50"
          >
            {isSaving ? "SAVING..." : "SAVE"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default VehicleHealthDashboard;
