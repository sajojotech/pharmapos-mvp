import { notFound } from "next/navigation";
import { StockDocumentStatus } from "@prisma/client";
import { can, requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getReceiptById } from "@/services/purchase-receipt-service";
import { formatDate, formatDateTime, formatDecimalQty, formatRupiah } from "@/lib/format";
import { ReceiptActions } from "./receipt-actions";

const STATUS_LABELS: Record<StockDocumentStatus, string> = {
  DRAFT: "Draft",
  POSTED: "Posted",
  CANCELLED: "Dibatalkan",
};

export default async function PurchaseReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("purchase.manage");
  const { id } = await params;
  const allowedBranchIds = await getAllowedBranchIds(user);

  const receipt = await getReceiptById(allowedBranchIds, id);
  if (!receipt) notFound();

  const canManage = can(user, "purchase.manage") && receipt.status === "DRAFT";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Penerimaan {receipt.documentNumber}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Cabang: {receipt.branch.code} — {receipt.branch.name}
          </p>
        </div>
        {canManage && <ReceiptActions id={receipt.id} />}
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <Info label="Status" value={STATUS_LABELS[receipt.status]} />
        <Info label="Supplier" value={receipt.supplier.name} />
        <Info label="No. Faktur Supplier" value={receipt.supplierInvoiceNumber} />
        <Info label="Tanggal Faktur" value={formatDate(receipt.supplierInvoiceDate)} />
        <Info label="Tanggal Penerimaan" value={formatDate(receipt.receivedDate)} />
        <Info
          label="Dibuat"
          value={`${formatDateTime(receipt.createdAt)} — ${receipt.createdBy.name}`}
        />
        <Info
          label="Diposting"
          value={
            receipt.postedAt
              ? `${formatDateTime(receipt.postedAt)} — ${receipt.postedBy?.name ?? "-"}`
              : "-"
          }
        />
        {receipt.notes && (
          <div className="sm:col-span-3">
            <Info label="Catatan" value={receipt.notes} />
          </div>
        )}
      </div>

      {receipt.status === "POSTED" && (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Dokumen ini sudah POSTED dan bersifat immutable. Koreksi (mis. salah
          input qty/harga) dilakukan lewat Stock Adjustment, bukan dengan
          mengedit dokumen ini — MVP ini belum mendukung pembatalan dokumen
          yang sudah diposting.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Produk</th>
              <th className="px-4 py-2">Satuan</th>
              <th className="px-4 py-2 text-right">Qty</th>
              <th className="px-4 py-2 text-right">Harga Beli</th>
              <th className="px-4 py-2 text-right">Diskon</th>
              <th className="px-4 py-2">No. Batch</th>
              <th className="px-4 py-2">ED</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="px-4 py-2">
                  {item.product.sku} — {item.product.name}
                </td>
                <td className="px-4 py-2">
                  {item.unit.name}
                  {item.unit.symbol ? ` (${item.unit.symbol})` : ""}
                </td>
                <td className="px-4 py-2 text-right">{formatDecimalQty(item.qty.toString())}</td>
                <td className="px-4 py-2 text-right">{formatRupiah(item.unitCost.toString())}</td>
                <td className="px-4 py-2 text-right">
                  {formatRupiah(item.discountAmount.toString())}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{item.batchNumber || "-"}</td>
                <td className="px-4 py-2">
                  {item.expiryDate ? formatDate(item.expiryDate) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm text-slate-900">{value}</p>
    </div>
  );
}
