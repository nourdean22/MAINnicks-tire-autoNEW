"use client";

/**
 * Task photos · 2026-10-29. Add from the camera or the library (iOS offers
 * both for a plain image picker), shrink on the phone, upload, view full
 * size, delete with two taps in the page (window.confirm is silent in the
 * iOS PWA). A photo that fails to load shows as a broken tile with a retry,
 * never as a missing one; a failed list read says it failed.
 */

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { resizePhoto } from "@/lib/ui/resize-photo";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const photoUrl = (taskId: string, id: string, attempt = 0) =>
  `/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(id)}${attempt ? `?r=${attempt}` : ""}`;

async function uploadPhoto(taskId: string, file: File): Promise<void> {
  const { blob, width, height } = await resizePhoto(file);
  const form = new FormData();
  form.append("photo", blob, blob.type === "image/webp" ? "photo.webp" : "photo.jpg");
  form.append("width", String(width));
  form.append("height", String(height));
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/attachments`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `upload failed (${res.status})`);
  }
}

function Thumb({ taskId, id, onOpen }: { taskId: string; id: string; onOpen: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <button
        type="button"
        onClick={() => {
          setBroken(false);
          setAttempt((n) => n + 1);
        }}
        className="flex aspect-square w-full items-center justify-center border border-dashed border-edge-default font-mono text-[11px] text-amber-300"
        aria-label="Photo did not load. Tap to retry"
      >
        did not load · retry
      </button>
    );
  }
  return (
    <button type="button" onClick={onOpen} className="block aspect-square w-full overflow-hidden bg-content" aria-label="Open photo">
      {/* eslint-disable-next-line @next/next/no-img-element -- owner-gated bytes, not an optimizable public asset */}
      <img
        src={photoUrl(taskId, id, attempt)}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="h-full w-full object-cover"
      />
    </button>
  );
}

function Viewer({ taskId, id, onClose }: { taskId: string; id: string; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [armed, setArmed] = useState(false);
  const del = trpc.task.attachmentDelete.useMutation({
    onSuccess: async () => {
      await utils.task.attachments.invalidate({ taskId });
      onClose();
    },
  });
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  // The house Dialog (Base UI): portal out of the transformed inspector sheet, focus trap, Escape, scroll lock.
  return (
    <Dialog open onOpenChange={(next) => !next && !del.isPending && onClose()}>
      <DialogContent
        unstyled
        showCloseButton={false}
        overlayClassName="z-[80] bg-black/95"
        className="fixed inset-0 z-[81] flex flex-col outline-none"
      >
      <DialogTitle className="sr-only">Task photo</DialogTitle>
      <div className="flex items-center justify-between gap-2 px-3 pt-[max(env(safe-area-inset-top),12px)]">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-[44px] min-w-[44px] items-center px-2 text-[15px] text-white/90"
        >
          Close
        </button>
        <button
          type="button"
          disabled={del.isPending}
          onClick={() => (armed ? del.mutate({ taskId, attachmentId: id }) : setArmed(true))}
          className={cn(
            "inline-flex min-h-[44px] items-center px-3 text-[15px]",
            armed ? "text-rose-300" : "text-white/70",
            del.isPending && "opacity-60",
          )}
        >
          {del.isPending ? "Deleting" : armed ? "Tap again to delete" : "Delete"}
        </button>
      </div>
      {del.isError ? <p className="px-4 font-mono text-[12px] text-amber-300">Not deleted: {del.error.message}</p> : null}
      <div className="flex min-h-0 flex-1 items-center justify-center p-2 pb-[max(env(safe-area-inset-bottom),8px)]">
        {/* eslint-disable-next-line @next/next/no-img-element -- owner-gated bytes */}
        <img src={photoUrl(taskId, id)} alt="Task photo" className="max-h-full max-w-full object-contain" />
      </div>
      </DialogContent>
    </Dialog>
  );
}

export function TaskPhotos({ taskId }: { taskId: string }) {
  const utils = trpc.useUtils();
  const list = trpc.task.attachments.useQuery({ taskId }, { staleTime: 30_000, retry: 1 });
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const picked = Array.from(files);
    try {
      for (let i = 0; i < picked.length; i++) {
        setBusy(picked.length > 1 ? `adding ${i + 1} of ${picked.length}` : "adding");
        await uploadPhoto(taskId, picked[i]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
      await utils.task.attachments.invalidate({ taskId });
    }
  };

  return (
    <section aria-label="Photos" data-task-photos={taskId}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] text-fg-tertiary">
          Photos{list.data && list.data.length > 0 ? ` · ${list.data.length}` : ""}
        </p>
        <label className={cn("inline-flex min-h-[44px] cursor-pointer items-center px-2 text-[13px] font-medium text-fg-secondary hover:text-fg", busy && "pointer-events-none opacity-60")}>
          {busy ?? "Add photo"}
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={busy !== null}
            onChange={(e) => void onFiles(e.target.files)}
          />
        </label>
      </div>
      {error ? <p className="mb-2 font-mono text-[12px] text-amber-300">Not added: {error}</p> : null}
      {list.isLoading ? (
        <p className="font-mono text-[11px] text-fg-tertiary">loading photos</p>
      ) : list.isError ? (
        <button
          type="button"
          onClick={() => void list.refetch()}
          className="inline-flex min-h-[44px] items-center font-mono text-[12px] text-amber-300"
        >
          Photos did not load · retry
        </button>
      ) : list.data && list.data.length > 0 ? (
        <ul className="grid grid-cols-3 gap-1.5">
          {list.data.map((p) => (
            <li key={p.id}>
              <Thumb taskId={taskId} id={p.id} onOpen={() => setOpen(p.id)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-mono text-[11px] text-fg-tertiary">No photos yet. A receipt, a part number, the car.</p>
      )}
      {open ? <Viewer taskId={taskId} id={open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}
