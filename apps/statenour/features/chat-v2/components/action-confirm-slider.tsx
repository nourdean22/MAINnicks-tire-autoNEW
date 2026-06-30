"use client";

import { useState } from "react";
import { toast } from "sonner";
import { runDirectAction } from "@/lib/chat/direct-actions";

/**
 * iOS PWA Safe Confirmation Modal
 * Replaces suppressed window.confirm()
 */
export function ActionConfirmSlider({ 
  command, 
  onSuccess,
  onCancel
}: { 
  command: string, 
  onSuccess?: () => void,
  onCancel?: () => void
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  const handleConfirm = async () => {
    setIsExecuting(true);
    try {
      await runDirectAction(command);
      onSuccess?.();
    } catch (e) {
      console.error(e);
      toast.error("Action failed — please try again.", { duration: 4000 });
    } finally {
      setIsExecuting(false);
      setIsConfirming(false);
    }
  };

  if (!isConfirming) {
    return (
      <button
        onClick={() => setIsConfirming(true)}
        className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-200 transition-transform active:scale-95 hover:bg-zinc-700"
      >
        Execute Action
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        <h3 className="mb-2 text-lg font-bold text-rose-500">Confirm High-Stakes Action</h3>
        <p className="mb-6 text-sm text-zinc-400">
          This action will immediately execute: <br />
          <code className="mt-2 block rounded bg-zinc-900 p-2 font-mono text-rose-400">{command}</code>
        </p>

        <div className="flex gap-3">
          <button
            onClick={() => {
              setIsConfirming(false);
              onCancel?.();
            }}
            disabled={isExecuting}
            className="flex-1 rounded-xl bg-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-300 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isExecuting}
            className="flex-1 rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white transition-transform disabled:opacity-50 active:scale-95 hover:bg-rose-500"
          >
            {isExecuting ? "Executing..." : "Double Tap to Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
