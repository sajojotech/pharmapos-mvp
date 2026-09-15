"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatRupiah } from "@/lib/format";
import { finalizePrescriptionPaymentAction } from "../actions";

type PaymentRow = {
  method: "CASH" | "QRIS" | "BANK_TRANSFER" | "DEBIT_CARD" | "E_WALLET";
  amount: string;
  reference: string;
};

const PAYMENT_METHOD_LABELS: Record<PaymentRow["method"], string> = {
  CASH: "Tunai",
  QRIS: "QRIS",
  BANK_TRANSFER: "Transfer Bank",
  DEBIT_CARD: "Kartu Debit",
  E_WALLET: "E-Wallet",
};

const inputClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60";

/**
 * Tahap 2 alur resep (Fase 09): ditampilkan pada halaman detail transaksi
 * saat status masih PENDING_PRESCRIPTION_REVIEW dan Prescription-nya sudah
 * APPROVED — kasir mengisi pembayaran, baru di titik INI stok benar-benar
 * dipotong (FEFO) via finalizePrescriptionPaymentAction.
 */
export function ContinuePaymentForm({
  transactionId,
  totalAmount,
}: {
  transactionId: string;
  totalAmount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [payments, setPayments] = useState<PaymentRow[]>([
    { method: "CASH", amount: "", reference: "" },
  ]);
  const [error, setError] = useState<string | null>(null);

  function addRow() {
    setPayments((prev) => [...prev, { method: "CASH", amount: "", reference: "" }]);
  }
  function updateRow(index: number, patch: Partial<PaymentRow>) {
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }
  function removeRow(index: number) {
    setPayments((prev) => prev.filter((_, i) => i !== index));
  }

  const tenderedTotal = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const remaining = Math.max(0, totalAmount - tenderedTotal);
  const change = Math.max(0, tenderedTotal - totalAmount);

  function submit() {
    setError(null);
    if (payments.every((p) => !Number(p.amount))) {
      setError("Isi minimal satu metode pembayaran.");
      return;
    }

    startTransition(async () => {
      const result = await finalizePrescriptionPaymentAction(transactionId, {
        payments: payments
          .filter((p) => Number(p.amount) > 0)
          .map((p) => ({
            method: p.method,
            amount: Number(p.amount),
            reference: p.reference || undefined,
          })),
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      toast.success("Pembayaran berhasil — stok telah dipotong dan invoice PAID.");
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <h3 className="text-sm font-semibold text-emerald-900">
        Resep Disetujui — Lanjutkan Pembayaran
      </h3>
      <p className="mt-1 text-xs text-emerald-800">
        Total tagihan {formatRupiah(totalAmount)}. Stok akan dialokasikan
        (FEFO) tepat setelah pembayaran ini berhasil.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {payments.map((payment, index) => (
          <div key={index} className="flex gap-2">
            <select
              value={payment.method}
              onChange={(e) => updateRow(index, { method: e.target.value as PaymentRow["method"] })}
              className={inputClass}
              disabled={isPending}
            >
              {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              step="1"
              placeholder="Jumlah"
              value={payment.amount}
              onChange={(e) => updateRow(index, { amount: e.target.value })}
              className={`${inputClass} flex-1`}
              disabled={isPending}
            />
            {payments.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(index)}
                disabled={isPending}
                className="rounded-md border border-slate-300 px-2 text-xs text-slate-500 hover:bg-slate-50"
              >
                Hapus
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          disabled={isPending}
          className="self-start rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          + Metode
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-0.5 text-sm">
        {remaining > 0 && (
          <div className="flex justify-between text-amber-700">
            <span>Kurang</span>
            <span>{formatRupiah(remaining)}</span>
          </div>
        )}
        {change > 0 && (
          <div className="flex justify-between font-medium text-emerald-700">
            <span>Kembalian</span>
            <span>{formatRupiah(change)}</span>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className="mt-3 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {isPending ? "Memproses..." : `Bayar ${formatRupiah(totalAmount)}`}
      </button>
    </div>
  );
}
