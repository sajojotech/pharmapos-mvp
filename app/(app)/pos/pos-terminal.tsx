"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatRupiah } from "@/lib/format";
import { createPrescriptionPendingAction, payTransactionAction, searchProductsAction } from "./actions";

type CustomerOption = { id: string; code: string | null; name: string };

type ProductResult = {
  id: string;
  sku: string;
  name: string;
  genericName: string | null;
  baseUnitName: string;
  baseUnitSymbol: string | null;
  sellingPrice: string;
  requiresPrescription: boolean;
};

type CartItem = {
  productId: string;
  sku: string;
  name: string;
  unitLabel: string;
  unitPrice: number;
  qty: number;
  discountAmount: number;
  notes: string;
  requiresPrescription: boolean;
};

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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function PosTerminal({
  branchId,
  branchLabel,
  shiftId,
  customers,
}: {
  branchId: string;
  branchLabel: string;
  shiftId: string;
  customers: CustomerOption[];
}) {
  const router = useRouter();
  const defaultCustomer = customers.find((c) => c.code === "UMUM") ?? customers[0];

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerId, setCustomerId] = useState(defaultCustomer?.id ?? "");
  const [transactionDiscount, setTransactionDiscount] = useState("0");
  const [notes, setNotes] = useState("");
  const [payments, setPayments] = useState<PaymentRow[]>([
    { method: "CASH", amount: "", reference: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fase 09: bila keranjang mengandung produk requiresPrescription,
  // seluruh keranjang (bukan hanya item resep) harus lewat alur pengajuan
  // resep — tidak bisa dibayar langsung (lihat pre-check di
  // services/pos-transaction-service.ts::createPaidTransaction).
  const hasPrescriptionItem = cart.some((item) => item.requiresPrescription);
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [prescriptionNumber, setPrescriptionNumber] = useState("");
  const [prescriptionDate, setPrescriptionDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [pharmacistNotes, setPharmacistNotes] = useState("");

  async function runSearch(q: string) {
    if (!q.trim()) {
      setResults([]);
      setSearchNotice(null);
      return;
    }
    setIsSearching(true);
    const result = await searchProductsAction(branchId, q);
    setIsSearching(false);

    if (!result.success) {
      setSearchNotice(result.error);
      setResults([]);
      return;
    }
    if (result.data.length === 0) {
      setSearchNotice("Produk tidak ditemukan.");
      setResults([]);
      return;
    }
    if (result.data.length === 1) {
      addToCart(result.data[0] as ProductResult);
      setQuery("");
      setResults([]);
      setSearchNotice(null);
      inputRef.current?.focus();
      return;
    }
    setSearchNotice(null);
    setResults(result.data);
  }

  // Debounce pencarian saat mengetik (mis. cari nama/SKU tanpa menekan Enter).
  useEffect(() => {
    const handle = setTimeout(() => {
      if (query.trim()) runSearch(query);
      else {
        setResults([]);
        setSearchNotice(null);
      }
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function handleQueryKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      runSearch(query);
    }
  }

  function addToCart(product: ProductResult) {
    setCart((prev) => {
      const existingIndex = prev.findIndex((item) => item.productId === product.id);
      if (existingIndex >= 0) {
        return prev.map((item, i) =>
          i === existingIndex ? { ...item, qty: item.qty + 1 } : item,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          unitLabel: product.baseUnitSymbol ?? product.baseUnitName,
          unitPrice: Number(product.sellingPrice),
          qty: 1,
          discountAmount: 0,
          notes: "",
          requiresPrescription: product.requiresPrescription,
        },
      ];
    });
  }

  function updateCartItem(index: number, patch: Partial<CartItem>) {
    setCart((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeCartItem(index: number) {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }

  function lineSubtotal(item: CartItem): number {
    return item.qty * item.unitPrice;
  }
  function lineTotal(item: CartItem): number {
    return Math.max(0, lineSubtotal(item) - item.discountAmount);
  }

  const subtotal = cart.reduce((sum, item) => sum + lineSubtotal(item), 0);
  const itemDiscountTotal = cart.reduce((sum, item) => sum + item.discountAmount, 0);
  const transactionDiscountNum = Number(transactionDiscount) || 0;
  const discountAmount = itemDiscountTotal + transactionDiscountNum;
  const totalAmount = Math.max(0, round2(subtotal - discountAmount));

  const cashTotal = payments
    .filter((p) => p.method === "CASH")
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const nonCashTotal = payments
    .filter((p) => p.method !== "CASH")
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const tenderedTotal = cashTotal + nonCashTotal;
  const changePreview = Math.max(0, round2(tenderedTotal - totalAmount));
  const remainingPreview = Math.max(0, round2(totalAmount - tenderedTotal));

  function addPaymentRow() {
    setPayments((prev) => [...prev, { method: "CASH", amount: "", reference: "" }]);
  }
  function updatePaymentRow(index: number, patch: Partial<PaymentRow>) {
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }
  function removePaymentRow(index: number) {
    setPayments((prev) => prev.filter((_, i) => i !== index));
  }

  async function handlePay() {
    setError(null);

    if (cart.length === 0) {
      setError("Keranjang masih kosong.");
      return;
    }
    if (payments.length === 0 || payments.every((p) => !Number(p.amount))) {
      setError("Isi minimal satu metode pembayaran.");
      return;
    }

    setIsSubmitting(true);
    const result = await payTransactionAction({
      shiftId,
      customerId: customerId || undefined,
      transactionDiscountAmount: transactionDiscountNum,
      notes: notes || undefined,
      items: cart.map((item) => ({
        productId: item.productId,
        qty: item.qty,
        discountAmount: item.discountAmount,
        notes: item.notes || undefined,
      })),
      payments: payments
        .filter((p) => Number(p.amount) > 0)
        .map((p) => ({
          method: p.method,
          amount: Number(p.amount),
          reference: p.reference || undefined,
        })),
    });
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast.success(`Transaksi ${result.data.documentNumber} berhasil dibayar.`);
    router.push(`/pos/transactions/${result.data.id}`);
  }

  async function handleSubmitPrescription() {
    setError(null);

    if (cart.length === 0) {
      setError("Keranjang masih kosong.");
      return;
    }
    if (!patientName.trim() || !doctorName.trim() || !prescriptionNumber.trim()) {
      setError("Nama pasien, nama dokter, dan nomor resep wajib diisi.");
      return;
    }

    setIsSubmitting(true);
    const result = await createPrescriptionPendingAction({
      shiftId,
      customerId: customerId || undefined,
      transactionDiscountAmount: transactionDiscountNum,
      notes: notes || undefined,
      items: cart.map((item) => ({
        productId: item.productId,
        qty: item.qty,
        discountAmount: item.discountAmount,
        notes: item.notes || undefined,
      })),
      prescription: {
        patientName,
        patientPhone: patientPhone || undefined,
        doctorName,
        prescriptionNumber,
        prescriptionDate,
        pharmacistNotes: pharmacistNotes || undefined,
      },
    });
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast.success(`Pengajuan resep ${result.data.documentNumber} berhasil dibuat — menunggu review apoteker.`);
    router.push(`/pos/transactions/${result.data.id}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Kasir (POS)</h1>
        <p className="mt-1 text-sm text-slate-600">Cabang aktif: {branchLabel}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-3 lg:col-span-2">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <label className="text-sm font-medium text-slate-700">
              Scan Barcode / Cari SKU, Nama, atau Nama Generik
            </label>
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleQueryKeyDown}
              placeholder="Scan barcode atau ketik nama produk..."
              className={`${inputClass} mt-1.5 w-full`}
            />
            {isSearching && <p className="mt-1 text-xs text-slate-400">Mencari...</p>}
            {searchNotice && <p className="mt-1 text-xs text-amber-600">{searchNotice}</p>}
            {results.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 rounded-md border border-slate-200">
                {results.map((product) => (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => {
                        addToCart(product);
                        setQuery("");
                        setResults([]);
                        inputRef.current?.focus();
                      }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-emerald-50"
                    >
                      <span>
                        {product.sku} — {product.name}
                        {product.genericName ? ` (${product.genericName})` : ""}
                      </span>
                      <span className="font-medium">{formatRupiah(product.sellingPrice)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Produk</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Harga</th>
                  <th className="px-3 py-2 text-right">Diskon</th>
                  <th className="px-3 py-2 text-right">Subtotal</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {cart.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                      Keranjang masih kosong. Scan barcode atau cari produk di atas.
                    </td>
                  </tr>
                )}
                {cart.map((item, index) => (
                  <tr key={index} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-900">{item.name}</p>
                      <p className="text-xs text-slate-500">
                        {item.sku} · {item.unitLabel}
                      </p>
                      <input
                        placeholder="Catatan item (opsional)"
                        value={item.notes}
                        onChange={(e) => updateCartItem(index, { notes: e.target.value })}
                        className={`${inputClass} mt-1 w-full text-xs`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0.001}
                        step="0.001"
                        value={item.qty}
                        onChange={(e) =>
                          updateCartItem(index, { qty: Number(e.target.value) || 0 })
                        }
                        className={`${inputClass} w-20 text-right`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {formatRupiah(item.unitPrice)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step="1"
                        value={item.discountAmount}
                        onChange={(e) =>
                          updateCartItem(index, { discountAmount: Number(e.target.value) || 0 })
                        }
                        className={`${inputClass} w-24 text-right`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap font-medium">
                      {formatRupiah(lineTotal(item))}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => removeCartItem(index)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <label className="text-sm font-medium text-slate-700">Customer</label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className={`${inputClass} mt-1.5 w-full`}
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <label className="mt-3 block text-sm font-medium text-slate-700">
              Diskon Transaksi (Rp)
            </label>
            <input
              type="number"
              min={0}
              step="1"
              value={transactionDiscount}
              onChange={(e) => setTransactionDiscount(e.target.value)}
              className={`${inputClass} mt-1.5 w-full`}
            />

            <label className="mt-3 block text-sm font-medium text-slate-700">
              Catatan (opsional)
            </label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={`${inputClass} mt-1.5 w-full`}
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Subtotal</span>
              <span>{formatRupiah(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Diskon</span>
              <span>{formatRupiah(discountAmount)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 text-base font-semibold text-slate-900">
              <span>Total</span>
              <span>{formatRupiah(totalAmount)}</span>
            </div>
          </div>

          {hasPrescriptionItem ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h3 className="text-sm font-semibold text-amber-900">
                Keranjang berisi produk resep
              </h3>
              <p className="mt-1 text-xs text-amber-800">
                Salah satu produk memerlukan resep — seluruh keranjang harus
                diajukan untuk review apoteker/manager terlebih dahulu,
                belum bisa dibayar langsung sekarang.
              </p>

              <label className="mt-3 block text-sm font-medium text-slate-700">Nama Pasien</label>
              <input
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                className={`${inputClass} mt-1.5 w-full`}
              />

              <label className="mt-3 block text-sm font-medium text-slate-700">
                No. HP Pasien (opsional)
              </label>
              <input
                value={patientPhone}
                onChange={(e) => setPatientPhone(e.target.value)}
                className={`${inputClass} mt-1.5 w-full`}
              />

              <label className="mt-3 block text-sm font-medium text-slate-700">Nama Dokter</label>
              <input
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                className={`${inputClass} mt-1.5 w-full`}
              />

              <label className="mt-3 block text-sm font-medium text-slate-700">Nomor Resep</label>
              <input
                value={prescriptionNumber}
                onChange={(e) => setPrescriptionNumber(e.target.value)}
                className={`${inputClass} mt-1.5 w-full`}
              />

              <label className="mt-3 block text-sm font-medium text-slate-700">Tanggal Resep</label>
              <input
                type="date"
                value={prescriptionDate}
                onChange={(e) => setPrescriptionDate(e.target.value)}
                className={`${inputClass} mt-1.5 w-full`}
              />

              <label className="mt-3 block text-sm font-medium text-slate-700">
                Catatan Kasir (opsional)
              </label>
              <input
                value={pharmacistNotes}
                onChange={(e) => setPharmacistNotes(e.target.value)}
                className={`${inputClass} mt-1.5 w-full`}
              />
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Pembayaran</h3>
                <button
                  type="button"
                  onClick={addPaymentRow}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  + Metode
                </button>
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {payments.map((payment, index) => (
                  <div key={index} className="flex gap-2">
                    <select
                      value={payment.method}
                      onChange={(e) =>
                        updatePaymentRow(index, { method: e.target.value as PaymentRow["method"] })
                      }
                      className={inputClass}
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
                      onChange={(e) => updatePaymentRow(index, { amount: e.target.value })}
                      className={`${inputClass} flex-1`}
                    />
                    {payments.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removePaymentRow(index)}
                        className="rounded-md border border-slate-300 px-2 text-xs text-slate-500 hover:bg-slate-50"
                      >
                        Hapus
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-col gap-0.5 text-sm">
                {remainingPreview > 0 && (
                  <div className="flex justify-between text-amber-600">
                    <span>Kurang</span>
                    <span>{formatRupiah(remainingPreview)}</span>
                  </div>
                )}
                {changePreview > 0 && (
                  <div className="flex justify-between font-medium text-emerald-700">
                    <span>Kembalian</span>
                    <span>{formatRupiah(changePreview)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {hasPrescriptionItem ? (
            <button
              type="button"
              onClick={handleSubmitPrescription}
              disabled={isSubmitting || cart.length === 0}
              className="rounded-md bg-amber-600 px-4 py-3 text-base font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {isSubmitting ? "Memproses..." : "Ajukan Resep"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePay}
              disabled={isSubmitting || cart.length === 0}
              className="rounded-md bg-emerald-600 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {isSubmitting ? "Memproses..." : `Bayar ${formatRupiah(totalAmount)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
