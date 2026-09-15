"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { voidTransactionAction } from "../actions";

export function VoidButton({ transactionId }: { transactionId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  function submit() {
    startTransition(async () => {
      const result = await voidTransactionAction(transactionId, reason);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Transaksi berhasil di-void — stok dikembalikan ke batch asal.");
      setConfirming(false);
      router.refresh();
    });
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 sm:w-96 print:hidden">
        <label className="text-sm text-red-800">Alasan void (wajib)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          disabled={isPending}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={isPending}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={isPending || !reason.trim()}
            className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {isPending ? "Memproses..." : "Ya, Void Transaksi"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 print:hidden"
    >
      Void Transaksi
    </button>
  );
}
