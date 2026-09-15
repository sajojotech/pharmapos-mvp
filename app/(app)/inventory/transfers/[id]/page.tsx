import { notFound } from "next/navigation";
import { StockTransferStatus } from "@prisma/client";
import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getTransferById } from "@/services/stock-transfer-service";
import { formatDate, formatDateTime, formatDecimalQty, formatRupiah } from "@/lib/format";
import { TransferActions } from "./transfer-actions";
import { ReceiveForm } from "./receive-form";

const STATUS_LABELS: Record<StockTransferStatus, string> = {
  DRAFT: "Draft",
  REQUESTED: "Diminta",
  APPROVED: "Disetujui",
  SHIPPED: "Dikirim",
  PARTIALLY_RECEIVED: "Diterima Sebagian",
  RECEIVED: "Diterima",
  REJECTED: "Ditolak",
  CANCELLED: "Dibatalkan",
};

export default async function StockTransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("transfer.manage");
  const { id } = await params;
  const allowedBranchIds = await getAllowedBranchIds(user);

  const transfer = await getTransferById(allowedBranchIds, id);
  if (!transfer) notFound();

  const isSourceUser = allowedBranchIds.includes(transfer.sourceBranchId);
  const isDestinationUser = allowedBranchIds.includes(transfer.destinationBranchId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Transfer {transfer.documentNumber}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {transfer.sourceBranch.code} — {transfer.sourceBranch.name}{" "}
            &rarr; {transfer.destinationBranch.code} — {transfer.destinationBranch.name}
          </p>
        </div>
        <TransferActions
          id={transfer.id}
          status={transfer.status}
          isSourceUser={isSourceUser}
          isDestinationUser={isDestinationUser}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <Info label="Status" value={STATUS_LABELS[transfer.status]} />
        <Info label="Dibuat" value={`${formatDateTime(transfer.createdAt)} — ${transfer.createdBy.name}`} />
        <Info
          label="Diminta"
          value={
            transfer.requestedAt
              ? `${formatDateTime(transfer.requestedAt)} — ${transfer.requestedBy?.name ?? "-"}`
              : "-"
          }
        />
        <Info
          label="Disetujui"
          value={
            transfer.approvedAt
              ? `${formatDateTime(transfer.approvedAt)} — ${transfer.approvedBy?.name ?? "-"}`
              : "-"
          }
        />
        <Info
          label="Ditolak"
          value={
            transfer.rejectedAt
              ? `${formatDateTime(transfer.rejectedAt)} — ${transfer.rejectedBy?.name ?? "-"}`
              : "-"
          }
        />
        <Info
          label="Dikirim"
          value={
            transfer.shippedAt
              ? `${formatDateTime(transfer.shippedAt)} — ${transfer.shippedBy?.name ?? "-"}`
              : "-"
          }
        />
        <Info
          label="Diterima"
          value={
            transfer.receivedAt
              ? `${formatDateTime(transfer.receivedAt)} — ${transfer.receivedBy?.name ?? "-"}`
              : "-"
          }
        />
        <Info
          label="Dibatalkan"
          value={
            transfer.cancelledAt
              ? `${formatDateTime(transfer.cancelledAt)} — ${transfer.cancelledBy?.name ?? "-"}`
              : "-"
          }
        />
        {transfer.rejectionReason && (
          <div className="sm:col-span-3">
            <Info label="Alasan Penolakan" value={transfer.rejectionReason} />
          </div>
        )}
        {transfer.notes && (
          <div className="sm:col-span-3">
            <Info label="Catatan" value={transfer.notes} />
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Produk</th>
              <th className="px-4 py-2">No. Batch Asal</th>
              <th className="px-4 py-2">ED</th>
              <th className="px-4 py-2 text-right">Harga Pokok</th>
              <th className="px-4 py-2 text-right">Diminta</th>
              <th className="px-4 py-2 text-right">Dikirim</th>
              <th className="px-4 py-2 text-right">Diterima</th>
              <th className="px-4 py-2">Batch Tujuan</th>
              <th className="px-4 py-2">Selisih</th>
            </tr>
          </thead>
          <tbody>
            {transfer.items.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="px-4 py-2">
                  {item.product.sku} — {item.product.name}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{item.sourceBatchNumberSnapshot}</td>
                <td className="px-4 py-2">{formatDate(item.expiryDateSnapshot)}</td>
                <td className="px-4 py-2 text-right">{formatRupiah(item.unitCostSnapshot.toString())}</td>
                <td className="px-4 py-2 text-right">{formatDecimalQty(item.qtyRequested.toString())}</td>
                <td className="px-4 py-2 text-right">
                  {item.qtyShipped ? formatDecimalQty(item.qtyShipped.toString()) : "-"}
                </td>
                <td className="px-4 py-2 text-right">
                  {item.qtyReceived ? formatDecimalQty(item.qtyReceived.toString()) : "-"}
                </td>
                <td className="px-4 py-2 font-mono text-xs">
                  {item.destinationStockBatch?.batchNumber ?? "-"}
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">{item.discrepancyReason ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {transfer.status === "SHIPPED" && isDestinationUser && (
        <ReceiveForm
          transferId={transfer.id}
          items={transfer.items.map((item) => ({
            id: item.id,
            productName: `${item.product.sku} — ${item.product.name}`,
            batchNumber: item.sourceBatchNumberSnapshot,
            qtyShipped: (item.qtyShipped ?? item.qtyRequested).toString(),
          }))}
        />
      )}
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
