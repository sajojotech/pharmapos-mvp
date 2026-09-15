"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDate, formatDecimalQty } from "@/lib/format";
import { createAdjustmentAction } from "../actions";

export type BatchOption = {
  id: string;
  batchNumber: string;
  expiryDate: string;
  qtyOnHand: string;
  product: { id: string; sku: string; name: string };
};

type ItemRow = {
  productId: string;
  stockBatchId: string;
  direction: "IN" | "OUT";
  qty: string;
};

const inputClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60";

export function AdjustmentForm({
  branchId,
  branchLabel,
  batches,
}: {
  branchId: string;
  branchLabel: string;
  batches: BatchOption[];
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<ItemRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const products = Array.from(
    new Map(batches.map((b) => [b.product.id, b.product])).values(),
  );

  function addItem() {
    setItems((prev) => [
      ...prev,
      { productId: "", stockBatchId: "", direction: "OUT", qty: "" },
    ]);
  }

  function updateItem(index: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (items.length === 0) {
      setError("Tambahkan minimal satu item.");
      return;
    }

    setIsSubmitting(true);
    const result = await createAdjustmentAction({
      branchId,
      reason,
      items: items.map((item) => ({
        stockBatchId: item.stockBatchId,
        direction: item.direction,
        qty: Number(item.qty),
      })),
    });
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast.success("Adjustment berhasil dibuat sebagai DRAFT.");
    router.push(`/inventory/adjustments/${result.data.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">
          Cabang: <span className="font-semibold">{branchLabel}</span>
        </p>

        <div className="mt-4 flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">Alasan</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            rows={2}
            disabled={isSubmitting}
            placeholder="mis. Ditemukan kemasan rusak saat pengecekan rak"
            className={inputClass}
          />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Item Adjustment</h3>
          <button
            type="button"
            onClick={addItem}
            disabled={isSubmitting}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            + Tambah Item
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-3">
          {items.length === 0 && (
            <p className="text-sm text-slate-400">Belum ada item.</p>
          )}
          {items.map((item, index) => {
            const batchesForProduct = batches.filter(
              (b) => b.product.id === item.productId,
            );
            const selectedBatch = batches.find((b) => b.id === item.stockBatchId);

            return (
              <div
                key={index}
                className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[2fr_2fr_1fr_1fr_auto]"
              >
                <select
                  value={item.productId}
                  onChange={(e) =>
                    updateItem(index, { productId: e.target.value, stockBatchId: "" })
                  }
                  disabled={isSubmitting}
                  className={inputClass}
                >
                  <option value="">Pilih produk</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name}
                    </option>
                  ))}
                </select>

                <select
                  value={item.stockBatchId}
                  onChange={(e) => updateItem(index, { stockBatchId: e.target.value })}
                  disabled={isSubmitting || !item.productId}
                  className={inputClass}
                >
                  <option value="">Pilih batch</option>
                  {batchesForProduct.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batchNumber} (ED {formatDate(b.expiryDate)}, saldo{" "}
                      {formatDecimalQty(b.qtyOnHand)})
                    </option>
                  ))}
                </select>

                <select
                  value={item.direction}
                  onChange={(e) =>
                    updateItem(index, { direction: e.target.value as "IN" | "OUT" })
                  }
                  disabled={isSubmitting}
                  className={inputClass}
                >
                  <option value="OUT">Keluar (OUT)</option>
                  <option value="IN">Masuk (IN)</option>
                </select>

                <input
                  type="number"
                  min={0}
                  step="0.001"
                  placeholder="Qty"
                  value={item.qty}
                  onChange={(e) => updateItem(index, { qty: e.target.value })}
                  disabled={isSubmitting}
                  className={inputClass}
                />

                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  disabled={isSubmitting}
                  className="rounded-md border border-slate-300 px-2.5 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
                >
                  Hapus
                </button>

                {selectedBatch && item.direction === "OUT" && (
                  <p className="text-xs text-slate-500 sm:col-span-5">
                    Saldo batch saat ini: {formatDecimalQty(selectedBatch.qtyOnHand)} — qty
                    OUT tidak boleh melebihi saldo ini.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.back()}
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
          {isSubmitting ? "Menyimpan..." : "Simpan sebagai Draft"}
        </button>
      </div>
    </form>
  );
}
