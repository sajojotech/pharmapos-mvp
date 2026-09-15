"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDate, formatDecimalQty } from "@/lib/format";
import { createTransferAction, listBranchBatchesAction, updateTransferAction } from "./actions";

export type BatchOption = {
  id: string;
  batchNumber: string;
  expiryDate: string;
  qtyOnHand: string;
  product: { id: string; sku: string; name: string };
};

type BranchOption = { id: string; code: string; name: string };

type ItemRow = {
  productId: string;
  sourceStockBatchId: string;
  qtyRequested: string;
  notes: string;
};

type ExistingTransfer = {
  id: string;
  sourceBranchId: string;
  destinationBranchId: string;
  notes: string | null;
  items: {
    productId: string;
    sourceStockBatchId: string;
    qtyRequested: string;
    notes: string | null;
  }[];
};

const inputClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60";

function emptyItem(): ItemRow {
  return { productId: "", sourceStockBatchId: "", qtyRequested: "", notes: "" };
}

export function TransferForm({
  branches,
  existingTransfer,
}: {
  branches: BranchOption[];
  existingTransfer?: ExistingTransfer;
}) {
  const router = useRouter();
  const isEdit = !!existingTransfer;

  const [sourceBranchId, setSourceBranchId] = useState(existingTransfer?.sourceBranchId ?? "");
  const [destinationBranchId, setDestinationBranchId] = useState(
    existingTransfer?.destinationBranchId ?? "",
  );
  const [notes, setNotes] = useState(existingTransfer?.notes ?? "");
  const [items, setItems] = useState<ItemRow[]>(
    existingTransfer
      ? existingTransfer.items.map((item) => ({
          productId: item.productId,
          sourceStockBatchId: item.sourceStockBatchId,
          qtyRequested: item.qtyRequested,
          notes: item.notes ?? "",
        }))
      : [],
  );
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [isLoadingBatches, setIsLoadingBatches] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!sourceBranchId) return;
    const handle = setTimeout(() => {
      setIsLoadingBatches(true);
      listBranchBatchesAction(sourceBranchId).then((result) => {
        setIsLoadingBatches(false);
        if (result.success) {
          setBatches(result.data);
        } else {
          toast.error(result.error);
        }
      });
    }, 0);
    return () => clearTimeout(handle);
  }, [sourceBranchId]);

  const products = Array.from(new Map(batches.map((b) => [b.product.id, b.product])).values());

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
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

    if (sourceBranchId && sourceBranchId === destinationBranchId) {
      setError("Cabang asal dan cabang tujuan tidak boleh sama.");
      return;
    }
    if (items.length === 0) {
      setError("Tambahkan minimal satu item.");
      return;
    }

    setIsSubmitting(true);
    const payload = {
      sourceBranchId,
      destinationBranchId,
      notes: notes || undefined,
      items: items.map((item) => ({
        productId: item.productId,
        sourceStockBatchId: item.sourceStockBatchId,
        qtyRequested: Number(item.qtyRequested),
        notes: item.notes || undefined,
      })),
    };

    const result = isEdit
      ? await updateTransferAction(existingTransfer.id, payload)
      : await createTransferAction(payload);
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast.success("Transfer berhasil disimpan sebagai DRAFT.");
    router.push(`/inventory/transfers/${result.data.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Cabang Asal (pengirim)">
            <select
              value={sourceBranchId}
              onChange={(e) => {
                setSourceBranchId(e.target.value);
                setItems([]);
                setBatches([]);
              }}
              required
              disabled={isSubmitting}
              className={inputClass}
            >
              <option value="">Pilih cabang asal</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Cabang Tujuan (peminta)">
            <select
              value={destinationBranchId}
              onChange={(e) => setDestinationBranchId(e.target.value)}
              required
              disabled={isSubmitting}
              className={inputClass}
            >
              <option value="">Pilih cabang tujuan</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="sm:col-span-2">
            <Field label="Catatan (opsional)">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                disabled={isSubmitting}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Item Transfer</h3>
          <button
            type="button"
            onClick={addItem}
            disabled={isSubmitting || !sourceBranchId}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            + Tambah Item
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Hanya batch berstatus Tersedia (belum lewat ED, qty {">"} 0) milik
          cabang asal yang bisa dipilih. Qty diminta tidak boleh melebihi
          saldo batch tsb.
        </p>

        {!sourceBranchId && (
          <p className="mt-3 text-sm text-slate-400">Pilih cabang asal terlebih dahulu.</p>
        )}
        {sourceBranchId && isLoadingBatches && (
          <p className="mt-3 text-sm text-slate-400">Memuat batch...</p>
        )}

        <div className="mt-3 flex flex-col gap-3">
          {sourceBranchId && !isLoadingBatches && items.length === 0 && (
            <p className="text-sm text-slate-400">Belum ada item.</p>
          )}
          {items.map((item, index) => {
            const batchesForProduct = batches.filter((b) => b.product.id === item.productId);
            const selectedBatch = batches.find((b) => b.id === item.sourceStockBatchId);

            return (
              <div
                key={index}
                className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[2fr_2fr_1fr_auto]"
              >
                <select
                  value={item.productId}
                  onChange={(e) => updateItem(index, { productId: e.target.value, sourceStockBatchId: "" })}
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
                  value={item.sourceStockBatchId}
                  onChange={(e) => updateItem(index, { sourceStockBatchId: e.target.value })}
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

                <input
                  type="number"
                  min={0}
                  step="0.001"
                  placeholder="Qty diminta"
                  value={item.qtyRequested}
                  onChange={(e) => updateItem(index, { qtyRequested: e.target.value })}
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

                {selectedBatch && (
                  <p className="text-xs text-slate-500 sm:col-span-4">
                    Saldo batch saat ini: {formatDecimalQty(selectedBatch.qtyOnHand)}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}
