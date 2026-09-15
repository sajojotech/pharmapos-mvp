import { notFound } from "next/navigation";
import { can, requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getAdjustmentById } from "@/services/stock-adjustment-service";
import { formatDate, formatDateTime, formatDecimalQty } from "@/lib/format";
import { PostAdjustmentButton } from "./post-button";

export default async function AdjustmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("inventory.read");
  const { id } = await params;
  const allowedBranchIds = await getAllowedBranchIds(user);

  const adjustment = await getAdjustmentById(allowedBranchIds, id);
  if (!adjustment) notFound();

  const canPost = can(user, "inventory.adjust") && adjustment.status === "DRAFT";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Adjustment {adjustment.documentNumber}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Cabang: {adjustment.branch.code} — {adjustment.branch.name}
          </p>
        </div>
        {canPost && <PostAdjustmentButton id={adjustment.id} />}
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <Info label="Status" value={adjustment.status} />
        <Info
          label="Dibuat"
          value={`${formatDateTime(adjustment.createdAt)} — ${adjustment.createdBy.name}`}
        />
        <Info
          label="Diposting"
          value={
            adjustment.postedAt
              ? `${formatDateTime(adjustment.postedAt)} — ${adjustment.postedBy?.name ?? "-"}`
              : "-"
          }
        />
        <div className="sm:col-span-3">
          <Info label="Alasan" value={adjustment.reason} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Produk</th>
              <th className="px-4 py-2">No. Batch</th>
              <th className="px-4 py-2">ED</th>
              <th className="px-4 py-2">Arah</th>
              <th className="px-4 py-2 text-right">Qty</th>
            </tr>
          </thead>
          <tbody>
            {adjustment.items.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="px-4 py-2">
                  {item.batch.product.sku} — {item.batch.product.name}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{item.batch.batchNumber}</td>
                <td className="px-4 py-2">{formatDate(item.batch.expiryDate)}</td>
                <td className="px-4 py-2">
                  {item.direction === "IN" ? "Masuk" : "Keluar"}
                </td>
                <td className="px-4 py-2 text-right">{formatDecimalQty(item.qty.toString())}</td>
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
