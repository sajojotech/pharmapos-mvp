"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatRupiah } from "@/lib/format";
import { createReceiptAction, updateReceiptAction } from "./actions";

type ProductOption = {
  id: string;
  sku: string;
  name: string;
  units: { unitId: string; name: string; symbol: string | null; conversionFactor: string }[];
};

type SupplierOption = { id: string; name: string };

type ItemRow = {
  productId: string;
  unitId: string;
  qty: string;
  unitCost: string;
  discountAmount: string;
  batchNumber: string;
  expiryDate: string;
  notes: string;
};

type ExistingReceipt = {
  id: string;
  branchId: string;
  supplierId: string;
  supplierInvoiceNumber: string;
  supplierInvoiceDate: string;
  receivedDate: string;
  notes: string | null;
  items: {
    productId: string;
    unitId: string;
    qty: string;
    unitCost: string;
    discountAmount: string;
    batchNumber: string | null;
    expiryDate: string | null;
    notes: string | null;
  }[];
};

const inputClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60";

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  return value.slice(0, 10);
}

function emptyItem(): ItemRow {
  return {
    productId: "",
    unitId: "",
    qty: "",
    unitCost: "",
    discountAmount: "0",
    batchNumber: "",
    expiryDate: "",
    notes: "",
  };
}

export function ReceiptForm({
  branchId,
  branchLabel,
  suppliers,
  products,
  existingReceipt,
}: {
  branchId: string;
  branchLabel: string;
  suppliers: SupplierOption[];
  products: ProductOption[];
  existingReceipt?: ExistingReceipt;
}) {
  const router = useRouter();
  const isEdit = !!existingReceipt;

  const [supplierId, setSupplierId] = useState(existingReceipt?.supplierId ?? suppliers[0]?.id ?? "");
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState(
    existingReceipt?.supplierInvoiceNumber ?? "",
  );
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState(
    toDateInputValue(existingReceipt?.supplierInvoiceDate) || new Date().toISOString().slice(0, 10),
  );
  const [receivedDate, setReceivedDate] = useState(
    toDateInputValue(existingReceipt?.receivedDate) || new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState(existingReceipt?.notes ?? "");
  const [items, setItems] = useState<ItemRow[]>(
    existingReceipt
      ? existingReceipt.items.map((item) => ({
          productId: item.productId,
          unitId: item.unitId,
          qty: item.qty,
          unitCost: item.unitCost,
          discountAmount: item.discountAmount,
          batchNumber: item.batchNumber ?? "",
          expiryDate: toDateInputValue(item.expiryDate),
          notes: item.notes ?? "",
        }))
      : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function updateItem(index: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function lineTotal(item: ItemRow): number {
    const qty = Number(item.qty) || 0;
    const unitCost = Number(item.unitCost) || 0;
    const discount = Number(item.discountAmount) || 0;
    return Math.max(0, qty * unitCost - discount);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (items.length === 0) {
      setError("Tambahkan minimal satu item.");
      return;
    }

    setIsSubmitting(true);
    const payload = {
      branchId,
      supplierId,
      supplierInvoiceNumber,
      supplierInvoiceDate,
      receivedDate,
      notes: notes || undefined,
      items: items.map((item) => ({
        productId: item.productId,
        unitId: item.unitId,
        qty: Number(item.qty),
        unitCost: Number(item.unitCost),
        discountAmount: Number(item.discountAmount) || 0,
        batchNumber: item.batchNumber || undefined,
        expiryDate: item.expiryDate || undefined,
        notes: item.notes || undefined,
      })),
    };

    const result = isEdit
      ? await updateReceiptAction(existingReceipt.id, payload)
      : await createReceiptAction(payload);
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast.success("Purchase receipt berhasil disimpan sebagai DRAFT.");
    router.push(`/purchases/receipts/${result.data.id}`);
  }

  const grandTotal = items.reduce((sum, item) => sum + lineTotal(item), 0);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">
          Cabang: <span className="font-semibold">{branchLabel}</span>
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Supplier">
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              required
              disabled={isSubmitting}
              className={inputClass}
            >
              <option value="">Pilih supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="No. Faktur Supplier">
            <input
              value={supplierInvoiceNumber}
              onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
              required
              disabled={isSubmitting}
              className={inputClass}
            />
          </Field>

          <Field label="Tanggal Faktur">
            <input
              type="date"
              value={supplierInvoiceDate}
              onChange={(e) => setSupplierInvoiceDate(e.target.value)}
              required
              disabled={isSubmitting}
              className={inputClass}
            />
          </Field>

          <Field label="Tanggal Penerimaan">
            <input
              type="date"
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
              required
              disabled={isSubmitting}
              className={inputClass}
            />
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
          <h3 className="text-sm font-semibold text-slate-900">Item Penerimaan</h3>
          <button
            type="button"
            onClick={addItem}
            disabled={isSubmitting}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            + Tambah Item
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Nomor batch &amp; ED wajib diisi sebelum dokumen di-posting (boleh
          dikosongkan sementara di draft). ED harus lebih besar dari
          tanggal penerimaan.
        </p>

        <div className="mt-3 flex flex-col gap-3">
          {items.length === 0 && (
            <p className="text-sm text-slate-400">Belum ada item.</p>
          )}
          {items.map((item, index) => {
            const product = products.find((p) => p.id === item.productId);
            const unit = product?.units.find((u) => u.unitId === item.unitId);

            return (
              <div key={index} className="rounded-md border border-slate-200 p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
                  <select
                    value={item.productId}
                    onChange={(e) => updateItem(index, { productId: e.target.value, unitId: "" })}
                    disabled={isSubmitting}
                    className={`${inputClass} sm:col-span-2`}
                  >
                    <option value="">Pilih produk</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={item.unitId}
                    onChange={(e) => updateItem(index, { unitId: e.target.value })}
                    disabled={isSubmitting || !item.productId}
                    className={inputClass}
                  >
                    <option value="">Satuan</option>
                    {product?.units.map((u) => (
                      <option key={u.unitId} value={u.unitId}>
                        {u.name}
                        {u.symbol ? ` (${u.symbol})` : ""}
                      </option>
                    ))}
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

                  <input
                    type="number"
                    min={0}
                    step="1"
                    placeholder="Harga beli"
                    value={item.unitCost}
                    onChange={(e) => updateItem(index, { unitCost: e.target.value })}
                    disabled={isSubmitting}
                    className={inputClass}
                  />

                  <input
                    type="number"
                    min={0}
                    step="1"
                    placeholder="Diskon (Rp)"
                    value={item.discountAmount}
                    onChange={(e) => updateItem(index, { discountAmount: e.target.value })}
                    disabled={isSubmitting}
                    className={inputClass}
                  />
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-6">
                  <input
                    placeholder="No. Batch"
                    value={item.batchNumber}
                    onChange={(e) => updateItem(index, { batchNumber: e.target.value })}
                    disabled={isSubmitting}
                    className={`${inputClass} sm:col-span-2`}
                  />
                  <input
                    type="date"
                    value={item.expiryDate}
                    onChange={(e) => updateItem(index, { expiryDate: e.target.value })}
                    disabled={isSubmitting}
                    className={inputClass}
                  />
                  <input
                    placeholder="Catatan item (opsional)"
                    value={item.notes}
                    onChange={(e) => updateItem(index, { notes: e.target.value })}
                    disabled={isSubmitting}
                    className={`${inputClass} sm:col-span-2`}
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    disabled={isSubmitting}
                    className="rounded-md border border-slate-300 px-2.5 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50"
                  >
                    Hapus
                  </button>
                </div>

                {item.qty && item.unitCost && (
                  <p className="mt-2 text-xs text-slate-500">
                    Subtotal baris: {formatRupiah(lineTotal(item))}
                    {unit && unit.conversionFactor !== "1" && product && (
                      <>
                        {" "}
                        ≈ {(Number(item.qty) * Number(unit.conversionFactor)).toLocaleString("id-ID")}{" "}
                        base unit
                      </>
                    )}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {items.length > 0 && (
          <p className="mt-3 text-right text-sm font-semibold text-slate-900">
            Total: {formatRupiah(grandTotal)}
          </p>
        )}
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
