/**
 * ConfirmDialog — imperative, promise-based confirm modal for admin.
 *
 * Replaces native window.confirm() which looks broken on mobile and
 * fights the brand. Usage:
 *
 *   import { confirmDialog } from "@/components/admin/ConfirmDialog";
 *   const ok = await confirmDialog({ title: "Delete?", message: "..." });
 *   if (ok) doIt();
 *
 * One singleton listener mounted at the admin shell; any caller can
 * fire via the imperative helper.
 *
 * Wave-139.
 */
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";

type Tone = "default" | "danger";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
}

interface PromptInput {
  label: string;
  placeholder?: string;
  /** Confirm stays disabled under this many trimmed characters. Default 4 (the server's floor). */
  minLength?: number;
}

interface PromptOptions extends ConfirmOptions {
  input: PromptInput;
}

interface InternalRequest extends ConfirmOptions {
  input?: PromptInput;
  resolve: (ok: boolean, text?: string) => void;
}

const EVENT = "admin:confirm-dialog";

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { ...options, resolve } }));
  });
}

/**
 * Same modal with a text box. Resolves the trimmed text, or null on cancel/Escape.
 * window.prompt is suppressed in the iOS home-screen PWA, so every reason the
 * server demands (a no-reply close on a real customer text) is typed here.
 */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const detail: InternalRequest = {
      ...options,
      resolve: (ok, text) => resolve(ok ? (text ?? "").trim() : null),
    };
    window.dispatchEvent(new CustomEvent(EVENT, { detail }));
  });
}

export default function ConfirmDialog() {
  const [request, setRequest] = useState<InternalRequest | null>(null);
  const [text, setText] = useState("");
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<InternalRequest>).detail;
      if (!detail) return;
      setText("");
      setRequest(detail);
    };
    window.addEventListener(EVENT, handler as EventListener);
    return () => window.removeEventListener(EVENT, handler as EventListener);
  }, []);

  // Focus the text box when there is one, else the confirm button; handle Escape
  useEffect(() => {
    if (!request) return;
    if (request.input) inputRef.current?.focus();
    else confirmBtnRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  function cancel() {
    if (!request) return;
    request.resolve(false);
    setRequest(null);
  }

  const minLength = request?.input?.minLength ?? 4;
  const textTooShort = Boolean(request?.input) && text.trim().length < minLength;

  function confirm() {
    if (!request || textTooShort) return;
    request.resolve(true, text);
    setRequest(null);
  }

  const tone: Tone = request?.tone ?? "default";

  return (
    <AnimatePresence>
      {request && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm"
            onClick={cancel}
            aria-hidden="true"
          />
          {/* Dialog */}
          <motion.div
            key="dialog"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed left-1/2 top-[20%] sm:top-1/2 -translate-x-1/2 sm:-translate-y-1/2 z-[81] w-[calc(100vw-2rem)] max-w-sm bg-card border border-border/40 rounded-xl shadow-2xl"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <div className="flex items-start gap-3 px-5 pt-5">
              {tone === "danger" && (
                <div className="shrink-0 w-9 h-9 rounded-full bg-red-500/12 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                </div>
              )}
              <div className="flex-1 min-w-0 pt-0.5">
                <h2 id="confirm-title" className="text-[15px] font-semibold text-foreground tracking-tight">
                  {request.title}
                </h2>
                {request.message && (
                  <p className="text-[13px] text-foreground/60 mt-1.5 leading-relaxed">
                    {request.message}
                  </p>
                )}
                {request.input && (
                  <label className="block mt-3">
                    <span className="block text-[12px] font-medium text-foreground/70 mb-1">{request.input.label}</span>
                    <textarea
                      ref={inputRef}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={request.input.placeholder}
                      rows={2}
                      maxLength={500}
                      className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-base text-foreground placeholder:text-foreground/35 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </label>
                )}
              </div>
              <button
                onClick={cancel}
                className="shrink-0 -mt-2 -mr-2 sm:-mt-1 sm:-mr-1 inline-flex items-center justify-center w-11 h-11 sm:w-8 sm:h-8 text-foreground/45 hover:text-foreground hover:bg-foreground/5 rounded-md transition-colors"
                aria-label="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 mt-2">
              <button
                onClick={cancel}
                className="px-4 py-2.5 sm:py-2 min-h-[44px] sm:min-h-0 text-[14px] sm:text-[13px] font-medium text-foreground/70 hover:text-foreground hover:bg-foreground/5 rounded-md transition-colors"
              >
                {request.cancelLabel ?? "Cancel"}
              </button>
              <button
                ref={confirmBtnRef}
                onClick={confirm}
                disabled={textTooShort}
                className={`px-4 py-2.5 sm:py-2 min-h-[44px] sm:min-h-0 rounded-md text-[14px] sm:text-[13px] font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                  tone === "danger"
                    ? "bg-red-500/90 text-white hover:bg-red-500"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
              >
                {request.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
