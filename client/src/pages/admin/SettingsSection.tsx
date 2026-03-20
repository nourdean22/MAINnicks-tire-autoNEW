/**
 * Shop Settings — manage pricing, contact info, hours, and SMS settings.
 * All settings auto-sync with the estimator and other features.
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Loader2, Save, CheckCircle2, DollarSign, Phone, Clock, MessageSquare, Settings } from "lucide-react";

type SettingCategory = "pricing" | "contact" | "hours" | "sms" | "general";

const CATEGORY_CONFIG: Record<SettingCategory, { label: string; icon: React.ReactNode; description: string }> = {
  pricing: { label: "Pricing", icon: <DollarSign className="w-4 h-4" />, description: "Internal pricing settings. Changes auto-sync with the AI Estimator. Not shown to customers." },
  contact: { label: "Contact Info", icon: <Phone className="w-4 h-4" />, description: "Shop name, phone, address, and email." },
  hours: { label: "Business Hours", icon: <Clock className="w-4 h-4" />, description: "Operating hours displayed on the website." },
  sms: { label: "SMS Settings", icon: <MessageSquare className="w-4 h-4" />, description: "SMS campaign batch size and send controls." },
  general: { label: "General", icon: <Settings className="w-4 h-4" />, description: "General shop settings." },
};

const CATEGORIES: SettingCategory[] = ["pricing", "contact", "hours", "sms", "general"];

export default function SettingsSection() {
  const [activeCategory, setActiveCategory] = useState<SettingCategory>("pricing");
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const { data: settings, isLoading, refetch } = trpc.shopdriver.getSettings.useQuery();
  const updateMutation = trpc.shopdriver.updateSetting.useMutation();

  // Initialize edit values when settings load
  useEffect(() => {
    if (settings) {
      const vals: Record<string, string> = {};
      settings.forEach((s) => { vals[s.key] = s.value; });
      setEditValues(vals);
    }
  }, [settings]);

  const handleSave = async (key: string) => {
    const value = editValues[key];
    if (value === undefined) return;
    setSaving(key);
    try {
      await updateMutation.mutateAsync({ key, value });
      setSaved(key);
      setTimeout(() => setSaved(null), 2000);
      refetch();
    } catch {
      // error handled by tRPC
    } finally {
      setSaving(null);
    }
  };

  const categorySettings = settings?.filter(s => s.category === activeCategory) || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-heading font-bold text-2xl text-foreground tracking-wider">SHOP SETTINGS</h2>
        <p className="text-foreground/50 font-mono text-xs mt-1">Manage shop configuration. Changes take effect immediately.</p>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`flex items-center gap-2 px-4 py-2.5 font-heading font-bold text-xs tracking-wider uppercase whitespace-nowrap transition-colors ${
              activeCategory === cat
                ? "bg-primary/10 text-primary border-b-2 border-primary"
                : "text-foreground/50 hover:text-foreground hover:bg-foreground/5"
            }`}
          >
            {CATEGORY_CONFIG[cat].icon}
            {CATEGORY_CONFIG[cat].label}
          </button>
        ))}
      </div>

      {/* Settings Panel */}
      <div className="bg-card border border-border/30 p-6">
        <div className="mb-6">
          <h3 className="font-heading font-bold text-sm text-foreground tracking-wider uppercase">
            {CATEGORY_CONFIG[activeCategory].label}
          </h3>
          <p className="text-foreground/50 text-xs mt-1">{CATEGORY_CONFIG[activeCategory].description}</p>
        </div>

        {categorySettings.length === 0 ? (
          <p className="text-foreground/40 font-mono text-xs">No settings in this category</p>
        ) : (
          <div className="space-y-4">
            {categorySettings.map(setting => {
              const isChanged = editValues[setting.key] !== setting.value;
              const isSaving = saving === setting.key;
              const isSaved = saved === setting.key;

              return (
                <div key={setting.key} className="flex flex-col sm:flex-row sm:items-center gap-3 py-3 border-b border-border/10 last:border-0">
                  <div className="sm:w-1/3">
                    <label className="font-heading font-bold text-xs text-foreground tracking-wider uppercase block">
                      {setting.label || setting.key}
                    </label>
                    <span className="font-mono text-[10px] text-foreground/30">{setting.key}</span>
                  </div>
                  <div className="flex-1 flex gap-2">
                    <input
                      type="text"
                      value={editValues[setting.key] ?? setting.value}
                      onChange={(e) => setEditValues(prev => ({ ...prev, [setting.key]: e.target.value }))}
                      className="flex-1 bg-foreground/5 border border-border/30 px-3 py-2 text-foreground font-mono text-sm focus:outline-none focus:border-primary/50 transition-colors"
                    />
                    <button
                      onClick={() => handleSave(setting.key)}
                      disabled={!isChanged || isSaving}
                      className={`flex items-center gap-1.5 px-4 py-2 font-heading font-bold text-[10px] tracking-wider uppercase transition-colors ${
                        isSaved
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                          : isChanged
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
                          : "bg-foreground/5 text-foreground/30 cursor-not-allowed"
                      }`}
                    >
                      {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : isSaved ? <CheckCircle2 className="w-3 h-3" /> : <Save className="w-3 h-3" />}
                      {isSaved ? "SAVED" : "SAVE"}
                    </button>
                  </div>
                  <div className="sm:w-24 text-right">
                    <span className="font-mono text-[10px] text-foreground/20">
                      {setting.updatedBy === "admin" ? "Manual" : "Auto-sync"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info Box */}
      <div className="bg-primary/5 border border-primary/20 p-4">
        <h4 className="font-heading font-bold text-xs text-primary tracking-wider uppercase mb-2">AUTO-SYNC WITH ESTIMATOR</h4>
        <p className="text-foreground/60 text-xs leading-relaxed">
          Changes here auto-sync with the AI Repair Estimator on the website. The estimator uses these settings in real time for all future estimates.
          The labor rate is used internally for calculations but is not displayed to customers.
        </p>
      </div>
    </div>
  );
}
