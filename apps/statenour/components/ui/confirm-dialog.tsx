"use client";

/**
 * components/ui/confirm-dialog.tsx · iOS-PWA-safe replacement for
 * window.confirm() and window.prompt().
 *
 * **Why this exists:** iOS Safari standalone mode (the homescreen
 * PWA install) silently SUPPRESSES window.confirm/alert/prompt.
 * They return undefined or never block · the user's "OK" tap never
 * happens · downstream `if (ok) { ... }` branches always take the
 * "cancelled" path. The cascade prompt in components/actions/loop-stream.tsx
 * and the subtask prompt in app/(mastery)/tasks/page.tsx are both
 * broken on iPhone homescreen for exactly this reason.
 *
 * **What it gives you:** Two Promise-based hooks that look like
 * native confirm/prompt at the call site but use a real
 * React-rendered modal underneath. The modal piggybacks on the
 * existing @base-ui/react/dialog primitive (already in use in
 * components/ui/dialog.tsx) so styling, focus-trap, escape-key,
 * outside-click-to-close, and screen-reader semantics all come
 * for free.
 *
 * Usage:
 *
 *   const { confirm, dialog } = useConfirmDialog();
 *   // render `dialog` somewhere in your component tree (it
 *   // returns null when closed · no perf cost)
 *   return <>{dialog}<YourPage onAction={async () => {
 *     const ok = await confirm({
 *       title: "Delete this task?",
 *       body: "This will also archive 3 subtasks. Undo not available.",
 *       confirmLabel: "Delete",
 *       tone: "danger",
 *     });
 *     if (ok) ...
 *   }} /></>;
 *
 *   // For prompt():
 *   const { prompt, dialog } = usePromptDialog();
 *   const title = await prompt({
 *     title: "Subtask of 'Ship the new dashboard':",
 *     placeholder: "subtask title",
 *   });
 *   if (title) ... // user typed something + clicked confirm
 *   if (title === null) ... // user cancelled
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── useConfirmDialog ──────────────────────────────────────────

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Visual tone of the confirm button. "default" matches the
   * editorial palette · "danger" warns the operator the action is
   * destructive or irreversible.
   */
  tone?: "default" | "danger";
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  /** Resolves the Promise returned by `confirm()`. Set when the
   *  hook opens the dialog · called when the operator clicks
   *  confirm / cancel / escapes / clicks outside. */
  resolve: ((value: boolean) => void) | null;
}

const INITIAL_CONFIRM_STATE: ConfirmState = {
  open: false,
  resolve: null,
  title: "",
};

export function useConfirmDialog(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  dialog: React.ReactNode;
} {
  const [state, setState] = React.useState<ConfirmState>(INITIAL_CONFIRM_STATE);

  const confirm = React.useCallback(
    (options: ConfirmOptions): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        setState({ ...options, open: true, resolve });
      });
    },
    [],
  );

  const { resolve } = state;
  const handleClose = React.useCallback(
    (value: boolean) => {
      // Capture resolve BEFORE clearing state · React state updates
      // are async so reading state.resolve after setState would race.
      resolve?.(value);
      setState(INITIAL_CONFIRM_STATE);
    },
    [resolve],
  );

  const dialog = (
    <Dialog
      open={state.open}
      onOpenChange={(open) => {
        // base-ui fires onOpenChange(false) on escape + outside-click
        // + close button · all three count as "cancel" from the
        // operator's perspective.
        if (!open) handleClose(false);
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
          {state.body ? (
            <DialogDescription>{state.body}</DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            type="button"
          >
            {state.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={state.tone === "danger" ? "destructive" : "default"}
            onClick={() => handleClose(true)}
            type="button"
            autoFocus
            className={cn(state.tone === "danger" && "bg-rose-600/90 hover:bg-rose-600")}
          >
            {state.confirmLabel ?? "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, dialog };
}

// ── usePromptDialog ──────────────────────────────────────────

export interface PromptOptions {
  title: string;
  body?: string;
  placeholder?: string;
  /** Initial value · overridden by what the operator types. */
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface PromptState extends PromptOptions {
  open: boolean;
  value: string;
  resolve: ((value: string | null) => void) | null;
}

const INITIAL_PROMPT_STATE: PromptState = {
  open: false,
  resolve: null,
  title: "",
  value: "",
};

export function usePromptDialog(): {
  prompt: (options: PromptOptions) => Promise<string | null>;
  dialog: React.ReactNode;
} {
  const [state, setState] = React.useState<PromptState>(INITIAL_PROMPT_STATE);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const prompt = React.useCallback(
    (options: PromptOptions): Promise<string | null> => {
      return new Promise<string | null>((resolve) => {
        setState({
          ...options,
          open: true,
          resolve,
          value: options.defaultValue ?? "",
        });
      });
    },
    [],
  );

  const { resolve } = state;
  const handleClose = React.useCallback(
    (value: string | null) => {
      // Same race-free capture pattern as the confirm hook.
      resolve?.(value);
      setState(INITIAL_PROMPT_STATE);
    },
    [resolve],
  );

  // Autofocus the input when the dialog opens · base-ui dialog
  // restores focus to the trigger on close so we don't need to
  // restore manually. Explicit `return undefined` on the false
  // branch keeps `noImplicitReturns` happy.
  React.useEffect(() => {
    if (!state.open) return undefined;
    // Defer · the input must be mounted in the portal before focus.
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [state.open]);

  const dialog = (
    <Dialog
      open={state.open}
      onOpenChange={(open) => {
        if (!open) handleClose(null);
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
          {state.body ? (
            <DialogDescription>{state.body}</DialogDescription>
          ) : null}
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = state.value.trim();
            // Empty submit = cancel (same convention as the existing
            // call sites · `if (!title) return` treats "" as cancel).
            handleClose(v ? v : null);
          }}
          className="space-y-3"
        >
          <input
            ref={inputRef}
            type="text"
            aria-label={state.title}
            value={state.value}
            onChange={(e) =>
              setState((s) => ({ ...s, value: e.target.value }))
            }
            placeholder={state.placeholder}
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)]/40 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-hover)] focus:outline-none"
          />
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => handleClose(null)}
            >
              {state.cancelLabel ?? "Cancel"}
            </Button>
            <Button type="submit">
              {state.confirmLabel ?? "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return { prompt, dialog };
}
