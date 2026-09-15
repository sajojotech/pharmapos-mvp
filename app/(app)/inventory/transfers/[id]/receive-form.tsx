"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDecimalQty } from "@/lib/format";
import { receiveTransferAction } from "../actions";

type ReceiveItem = {
  id: string;
  productName: string;
  batchNumber: string;
  qtyShipped: string;
};

export function ReceiveForm({ transferId, items }: { transferId: string; items: ReceiveItem[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, { qty: string; reason: string }>>(
    Object.fromEntries(items.map((item) => [item.id, { qty: item.qtyShipped, reason: "" }])),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [open, setOpen] = useState(false);

  function update(itemId: string, patch: Partial<{ qty: string; reason: string }>) {
    setValues((prev) => ({
      ...prev,
      [itemId]: { qty: "", reason: "", ...prev[itemId], ...patch },
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const result = await receiveTransferAction(transferId, {
      items: items.map((item) => ({
        itemId: item.id,
        qtyReceived: Number(values[item.id]?.qty ?? 0),
        discrepancyReason: values[item.id]?.reason || undefined,
      })),
    });
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast.success(
      result.data.status === "RECEIVED"
        ? "Transfer diterima penuh — stok cabang tujuan bertambah."
        : "Transfer diterima sebagian — selisih tercatat.",
    );
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
      >
        Terima Barang
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Konfirmasi Penerimaan</h3>
      <p className="text-xs text-slate-500">
        Isi qty yang benar-benar diterima per item. Bila kurang dari qty
        dikirim, alasan selisih wajib diisi.
      </p>

      <div className="flex flex-col gap-3">
        {items.map((item) => {
          const value = values[item.id] ?? { qty: item.qtyShipped, reason: "" };
          const isShort = Number(value.qty) < Number(item.qtyShipped);
          return (
            <div key={item.id} className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <p className="text-sm font-medium text-slate-900">{item.productName}</p>
                <p className="text-xs text-slate-500">
                  Batch {item.batchNumber} — dikirim {formatDecimalQty(item.qtyShipped)}
                </p>
              </div>
              <input
                type="number"
                min={0}
                step="0.001"
                value={value.qty}
                onChange={(e) => update(item.id, { qty: e.target.value })}
                disabled={isSubmitting}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
              <input
                placeholder={isShort ? "Alasan selisih (wajib)" : "Alasan selisih (opsional)"}
                value={value.reason}
                onChange={(e) => update(item.id, { reason: e.target.value })}
                disabled={isSubmitting}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={isSubmitting}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
        >
          Batal
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {isSubmitting ? "Menyimpan..." : "Konfirmasi Penerimaan"}
        </button>
      </div>
    </form>
  );
}
