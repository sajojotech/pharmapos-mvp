"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { reviewPrescriptionAction } from "../actions";

export function ReviewForm({ prescriptionId }: { prescriptionId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<"APPROVE" | "REJECT" | null>(null);
  const [notes, setNotes] = useState("");

  function submit(decision: "APPROVE" | "REJECT") {
    startTransition(async () => {
      const result = await reviewPrescriptionAction(prescriptionId, { decision, notes });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        decision === "APPROVE"
          ? "Resep disetujui — kasir dapat melanjutkan pembayaran."
          : "Resep ditolak — transaksi terkait dibatalkan.",
      );
      setConfirming(null);
      router.refresh();
    });
  }

  if (confirming === "REJECT") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 sm:w-96">
        <label className="text-sm text-red-800">Alasan penolakan (wajib)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          disabled={isPending}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirming(null)}
            disabled={isPending}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => submit("REJECT")}
            disabled={isPending || !notes.trim()}
            className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {isPending ? "Memproses..." : "Ya, Tolak"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => submit("APPROVE")}
        disabled={isPending}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {isPending ? "Memproses..." : "Setujui"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming("REJECT")}
        disabled={isPending}
        className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
      >
        Tolak
      </button>
    </div>
  );
}
