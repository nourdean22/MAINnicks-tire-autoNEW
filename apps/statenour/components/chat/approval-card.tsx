"use client";

import React, { useState } from "react";
import { Check, X, ShieldAlert } from "lucide-react";

export interface ApprovalCardProps {
  approvalId: string;
  toolName: string;
  params: Record<string, unknown>;
  reason: string;
  onApprove: (id: string, editedParams?: Record<string, unknown>) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({
  approvalId,
  toolName,
  params,
  reason,
  onApprove,
  onReject,
}) => {
  const [editedParamsText, setEditedParamsText] = useState(JSON.stringify(params, null, 2));
  const [isEditing, setIsEditing] = useState(false);

  const [error, setError] = useState<string | null>(null);

  return (
    <div className="bg-amber-950/10 border border-amber-900/30 rounded-xl p-4 my-3 backdrop-blur-md">
      <div className="flex items-center space-x-2 text-amber-400 mb-2">
        <ShieldAlert className="w-4 h-4" />
        <span className="text-[11px] font-bold uppercase tracking-wider font-display">
          Human In The Loop Approval Required
        </span>
      </div>
      <p className="text-[12px] text-zinc-300 mb-3">{reason}</p>
      
      <div className="bg-zinc-950/80 rounded-lg border border-zinc-900 p-3 mb-4">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-[10px] text-zinc-500 font-mono">{toolName}</span>
          <button 
            onClick={() => setIsEditing(!isEditing)}
            className="text-[9px] text-gold underline font-mono bg-transparent border-none cursor-pointer"
          >
            {isEditing ? "View Schema" : "Edit Parameters"}
          </button>
        </div>

        {isEditing ? (
          <textarea
            value={editedParamsText}
            onChange={(e) => {
              setEditedParamsText(e.target.value);
              setError(null);
            }}
            className="w-full h-32 bg-zinc-900 text-[10px] text-zinc-300 font-mono p-2 border border-zinc-800 rounded focus:outline-none focus:border-gold"
          />
        ) : (
          <pre className="text-[10px] text-zinc-400 font-mono overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(params, null, 2)}
          </pre>
        )}
      </div>

      {error && (
        <div className="text-[11px] text-rose-400 mb-3 bg-rose-950/20 border border-rose-900/30 px-3 py-2 rounded-lg font-mono">
          {error}
        </div>
      )}

      <div className="flex space-x-3">
        <button
          onClick={() => {
            let parsed = params;
            try {
              parsed = isEditing ? JSON.parse(editedParamsText) : params;
            } catch (err) {
              setError("Invalid JSON: Please check the syntax of your parameters.");
              return;
            }
            onApprove(approvalId, parsed);
          }}
          className="flex-1 flex items-center justify-center space-x-1 py-2 bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-400 border border-emerald-800/40 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
        >
          <Check className="w-3.5 h-3.5" />
          <span>Approve & Execute</span>
        </button>
        <button
          onClick={() => onReject(approvalId)}
          className="flex-1 flex items-center justify-center space-x-1 py-2 bg-rose-950/30 hover:bg-rose-950/50 text-rose-400 border border-rose-900/40 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
          <span>Reject Action</span>
        </button>
      </div>
    </div>
  );
};
