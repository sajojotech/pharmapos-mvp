"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Modal } from "./modal";
import type { ActionResult } from "@/lib/response";

/**
 * Tombol generik untuk aksi yang butuh konfirmasi (mis. nonaktifkan/aktifkan
 * data master). Menampilkan modal konfirmasi, memanggil Server Action, lalu
 * menampilkan toast sukses/gagal dan me-refresh data halaman.
 */
export function ConfirmActionButton({
  label,
  confirmTitle,
  confirmDescription,
  onConfirm,
  triggerClassName,
  variant = "default",
}: {
  label: string;
  confirmTitle: string;
  confirmDescription: string;
  onConfirm: () => Promise<ActionResult<unknown>>;
  triggerClassName?: string;
  variant?: "default" | "danger";
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleConfirm() {
    startTransition(async () => {
      const result = await onConfirm();
      if (result.success) {
        toast.success("Berhasil disimpan.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          "rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        }
      >
        {label}
      </button>

      <Modal
        title={confirmTitle}
        description={confirmDescription}
        open={open}
        onClose={() => setOpen(false)}
        widthClassName="max-w-sm"
      >
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={isPending}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isPending}
            className={
              variant === "danger"
                ? "rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                : "rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            }
          >
            {isPending ? "Memproses..." : "Ya, lanjutkan"}
          </button>
        </div>
      </Modal>
    </>
  );
}
