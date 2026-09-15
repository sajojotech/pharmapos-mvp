import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getTransactionById } from "@/services/pos-transaction-service";
import { formatDate, formatDateTime, formatDecimalQty, formatRupiah } from "@/lib/format";
import { PrintButton } from "./print-button";
import { ContinuePaymentForm } from "./continue-payment-form";
import { VoidButton } from "./void-button";

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Tunai",
  QRIS: "QRIS",
  BANK_TRANSFER: "Transfer Bank",
  DEBIT_CARD: "Kartu Debit",
  E_WALLET: "E-Wallet",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_PRESCRIPTION_REVIEW: "Menunggu Review Resep",
  PAID: "Lunas",
  CANCELLED: "Dibatalkan",
  VOIDED: "Di-void",
  PARTIALLY_RETURNED: "Diretur Sebagian",
  RETURNED: "Diretur Penuh",
};

export default async function PosTransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("pos.sell");
  const { id } = await params;
  const allowedBranchIds = await getAllowedBranchIds(user);

  const transaction = await getTransactionById(allowedBranchIds, id);
  if (!transaction) notFound();

  const canVoid = can(user, "pos.void");
  const canReturn = ["PAID", "PARTIALLY_RETURNED"].includes(transaction.status);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Invoice {transaction.documentNumber}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {transaction.branch.code} — {transaction.branch.name} ·{" "}
            {STATUS_LABELS[transaction.status] ?? transaction.status}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canReturn && (
            <Link
              href={`/pos/transactions/${transaction.id}/return`}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Proses Retur
            </Link>
          )}
          {canVoid && transaction.status === "PAID" && <VoidButton transactionId={transaction.id} />}
          <PrintButton />
        </div>
      </div>

      {transaction.prescription && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm print:hidden">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Resep</h2>
            <Link
              href={`/pos/prescriptions/${transaction.prescription.id}`}
              className="text-xs text-emerald-700 hover:underline"
            >
              Detail resep →
            </Link>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            No. {transaction.prescription.prescriptionNumber} — Pasien{" "}
            {transaction.prescription.patientName} — Status:{" "}
            <span className="font-medium">{transaction.prescription.status}</span>
          </p>
          {transaction.prescription.reviewedBy && (
            <p className="mt-0.5 text-xs text-slate-500">
              Ditinjau oleh {transaction.prescription.reviewedBy.name}
            </p>
          )}
        </div>
      )}

      {transaction.status === "PENDING_PRESCRIPTION_REVIEW" &&
        transaction.prescription?.status === "APPROVED" && (
          <div className="print:hidden">
            <ContinuePaymentForm
              transactionId={transaction.id}
              totalAmount={Number(transaction.totalAmount)}
            />
          </div>
        )}

      {transaction.status === "PENDING_PRESCRIPTION_REVIEW" &&
        transaction.prescription?.status === "PENDING_REVIEW" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 print:hidden">
            Menunggu review apoteker/manager sebelum dapat dibayar.
          </div>
        )}

      {transaction.status === "VOIDED" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 print:hidden">
          <p className="font-medium">Transaksi ini telah di-void.</p>
          {transaction.voidedBy && (
            <p className="mt-0.5 text-xs">
              Oleh {transaction.voidedBy.name}
              {transaction.voidedAt ? ` — ${formatDateTime(transaction.voidedAt)}` : ""}
            </p>
          )}
          {transaction.voidReason && <p className="mt-0.5 text-xs">Alasan: {transaction.voidReason}</p>}
        </div>
      )}

      <div className="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-sm print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <div className="text-center">
          <p className="text-base font-bold text-slate-900">{transaction.branch.name}</p>
          <p className="text-xs text-slate-500">
            {transaction.branch.address} · {transaction.branch.phone}
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-0.5 border-b border-dashed border-slate-300 pb-3 text-xs text-slate-600">
          <div className="flex justify-between">
            <span>No. Invoice</span>
            <span className="font-mono">{transaction.documentNumber}</span>
          </div>
          <div className="flex justify-between">
            <span>Waktu</span>
            <span>{formatDateTime(transaction.paidAt ?? transaction.createdAt)}</span>
          </div>
          <div className="flex justify-between">
            <span>Kasir</span>
            <span>{transaction.createdBy.name}</span>
          </div>
          <div className="flex justify-between">
            <span>Customer</span>
            <span>{transaction.customer.name}</span>
          </div>
        </div>

        <table className="mt-3 w-full text-xs">
          <tbody>
            {transaction.items.map((item) => (
              <tr key={item.id} className="align-top">
                <td className="py-1 pr-2">
                  <p className="font-medium text-slate-900">{item.product.name}</p>
                  <p className="text-slate-500">
                    {formatDecimalQty(item.qty.toString())} x {formatRupiah(item.unitPrice.toString())}
                    {item.discountAmount.toString() !== "0" && (
                      <> − diskon {formatRupiah(item.discountAmount.toString())}</>
                    )}
                  </p>
                </td>
                <td className="py-1 text-right font-medium whitespace-nowrap">
                  {formatRupiah(item.lineTotal.toString())}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 flex flex-col gap-0.5 border-t border-dashed border-slate-300 pt-3 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-500">Subtotal</span>
            <span>{formatRupiah(transaction.subtotal.toString())}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Diskon</span>
            <span>{formatRupiah(transaction.discountAmount.toString())}</span>
          </div>
          <div className="flex justify-between text-sm font-bold text-slate-900">
            <span>Total</span>
            <span>{formatRupiah(transaction.totalAmount.toString())}</span>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-0.5 border-t border-dashed border-slate-300 pt-3 text-xs">
          {transaction.payments.map((payment) => (
            <div key={payment.id} className="flex justify-between">
              <span className="text-slate-500">
                {PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}
              </span>
              <span>{formatRupiah(payment.amount.toString())}</span>
            </div>
          ))}
          {transaction.changeAmount.toString() !== "0" && (
            <div className="flex justify-between font-medium">
              <span>Kembalian</span>
              <span>{formatRupiah(transaction.changeAmount.toString())}</span>
            </div>
          )}
        </div>

        {transaction.notes && (
          <p className="mt-3 border-t border-dashed border-slate-300 pt-3 text-xs text-slate-500">
            Catatan: {transaction.notes}
          </p>
        )}

        <p className="mt-4 text-center text-xs text-slate-400">Terima kasih!</p>
      </div>

      <div className="print:hidden">
        <h2 className="text-sm font-semibold text-slate-900">
          Alokasi Batch Keluar (Internal)
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Batch dipilih otomatis lewat alokasi FEFO (First-Expired-First-Out)
          saat transaksi dibayar — lihat docs/POS.md.
        </p>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Produk</th>
                <th className="px-4 py-2">No. Batch</th>
                <th className="px-4 py-2">ED</th>
                <th className="px-4 py-2 text-right">Qty Keluar</th>
                <th className="px-4 py-2 text-right">Harga Pokok</th>
              </tr>
            </thead>
            <tbody>
              {transaction.items.flatMap((item) =>
                item.allocations.length === 0 ? (
                  <tr key={item.id} className="border-b border-slate-100">
                    <td className="px-4 py-2">{item.product.name}</td>
                    <td className="px-4 py-2 text-slate-400" colSpan={4}>
                      Belum ada alokasi batch.
                    </td>
                  </tr>
                ) : (
                  item.allocations.map((allocation) => (
                    <tr key={allocation.id} className="border-b border-slate-100">
                      <td className="px-4 py-2">{item.product.name}</td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {allocation.batchNumberSnapshot}
                      </td>
                      <td className="px-4 py-2">{formatDate(allocation.expiryDateSnapshot)}</td>
                      <td className="px-4 py-2 text-right">
                        {formatDecimalQty(allocation.qtyOut.toString())}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {formatRupiah(allocation.unitCostSnapshot.toString())}
                      </td>
                    </tr>
                  ))
                ),
              )}
            </tbody>
          </table>
        </div>
      </div>

      {transaction.salesReturns.length > 0 && (
        <div className="print:hidden">
          <h2 className="text-sm font-semibold text-slate-900">Riwayat Retur</h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Tanggal</th>
                  <th className="px-4 py-2">Diproses oleh</th>
                  <th className="px-4 py-2">Alasan</th>
                </tr>
              </thead>
              <tbody>
                {transaction.salesReturns.map((salesReturn) => (
                  <tr key={salesReturn.id} className="border-b border-slate-100">
                    <td className="px-4 py-2 whitespace-nowrap">
                      {formatDateTime(salesReturn.createdAt)}
                    </td>
                    <td className="px-4 py-2">{salesReturn.createdBy.name}</td>
                    <td className="px-4 py-2">{salesReturn.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
