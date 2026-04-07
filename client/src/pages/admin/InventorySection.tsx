/**
 * InventorySection — Parts and tire stock management from admin dashboard.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Package, AlertTriangle, Plus, Minus } from "lucide-react";

const EMPTY_FORM = {
  name: "",
  category: "",
  brand: "",
  size: "",
  cost: 0,
  retailPrice: 0,
  quantityOnHand: 0,
  reorderThreshold: 2,
};

export default function InventorySection() {
  const { data: items, isLoading } = trpc.inventory.getAll.useQuery({});
  const { data: lowStock } = trpc.inventory.getLowStock.useQuery();
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const lowStockIds = new Set((lowStock ?? []).map((i: any) => i.id));

  const createItem = trpc.inventory.create.useMutation({
    onSuccess: () => {
      utils.inventory.getAll.invalidate();
      utils.inventory.getLowStock.invalidate();
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
      toast.success("Item created");
    },
    onError: (err) => toast.error(err.message),
  });

  const adjustStock = trpc.inventory.adjustStock.useMutation({
    onSuccess: () => {
      utils.inventory.getAll.invalidate();
      utils.inventory.getLowStock.invalidate();
      toast.success("Stock adjusted");
    },
    onError: (err) => toast.error(err.message),
  });

  function handleCreate() {
    if (!form.name || !form.category) return;
    createItem.mutate({
      name: form.name,
      category: form.category,
      brand: form.brand || undefined,
      size: form.size || undefined,
      cost: form.cost || undefined,
      retailPrice: form.retailPrice || undefined,
      quantityOnHand: form.quantityOnHand,
      reorderThreshold: form.reorderThreshold,
    });
  }

  function handleAdjust(id: string, delta: number) {
    adjustStock.mutate({ id, adjustment: delta, reason: "Manual adjustment" });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-xl text-foreground tracking-wider">INVENTORY</h2>
        <div className="flex items-center gap-3">
          {(lowStock ?? []).length > 0 && (
            <span className="flex items-center gap-1.5 text-red-400 text-xs font-bold tracking-wide">
              <AlertTriangle className="w-3.5 h-3.5" />
              {(lowStock ?? []).length} LOW STOCK
            </span>
          )}
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors"
          >
            {showForm ? "CANCEL" : "+ NEW ITEM"}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-card border border-border/30 p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Category *</label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. tires, brakes, oil"
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Brand</label>
              <input
                type="text"
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Size</label>
              <input
                type="text"
                value={form.size}
                onChange={(e) => setForm({ ...form, size: e.target.value })}
                placeholder="e.g. 225/60R16"
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Cost ($)</label>
              <input
                type="number"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Retail ($)</label>
              <input
                type="number"
                value={form.retailPrice}
                onChange={(e) => setForm({ ...form, retailPrice: Number(e.target.value) })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Qty on Hand</label>
              <input
                type="number"
                value={form.quantityOnHand}
                onChange={(e) => setForm({ ...form, quantityOnHand: Number(e.target.value) })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-foreground/60 text-xs mb-1">Reorder At</label>
              <input
                type="number"
                value={form.reorderThreshold}
                onChange={(e) => setForm({ ...form, reorderThreshold: Number(e.target.value) })}
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-sm focus:border-primary outline-none"
              />
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={!form.name || !form.category || createItem.isPending}
            className="bg-primary text-primary-foreground px-6 py-2 font-bold text-xs tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {createItem.isPending ? "CREATING..." : "CREATE ITEM"}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : (items ?? []).length === 0 ? (
        <div className="text-center py-12 text-foreground/40">
          <Package className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-[13px]">No inventory items. Add your first one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(items ?? []).map((item: any) => {
            const isLow = lowStockIds.has(item.id);
            return (
              <div
                key={item.id}
                className={`bg-card border p-4 flex items-center gap-4 ${
                  isLow ? "border-red-500/40" : "border-border/30"
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-foreground text-sm tracking-wider">{item.name}</span>
                    <span className="text-xs bg-foreground/5 text-foreground/50 px-1.5 py-0.5">{item.category}</span>
                    {item.brand && (
                      <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5">{item.brand}</span>
                    )}
                    {isLow && (
                      <span className="text-[10px] bg-red-500/10 text-red-400 px-1.5 py-0.5 font-semibold">LOW STOCK</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-foreground/30 text-xs">
                    {item.size && <span>Size: {item.size}</span>}
                    <span>Reorder at: {item.reorderThreshold}</span>
                    {item.cost && <span>Cost: ${item.cost}</span>}
                    {item.retailPrice && <span>Retail: ${item.retailPrice}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleAdjust(item.id, -1)}
                    disabled={adjustStock.isPending}
                    className="w-7 h-7 flex items-center justify-center bg-foreground/5 hover:bg-red-500/10 text-foreground/50 hover:text-red-400 transition-colors"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className={`font-bold text-lg min-w-[3ch] text-center ${isLow ? "text-red-400" : "text-foreground"}`}>
                    {item.quantityOnHand}
                  </span>
                  <button
                    onClick={() => handleAdjust(item.id, 1)}
                    disabled={adjustStock.isPending}
                    className="w-7 h-7 flex items-center justify-center bg-foreground/5 hover:bg-emerald-500/10 text-foreground/50 hover:text-emerald-400 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
