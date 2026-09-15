import { notFound } from "next/navigation";
import { Prisma } from "@prisma/client";
import { can, requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getOpnameById } from "@/services/stock-opname-service";
import { formatDate, formatDateTime, formatDecimalQty } from "@/lib/format";
import { PostOpnameButton } from "./post-button";

export default async function OpnameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("inventory.read");
  const { id } = await params;
  const allowedBranchIds = await getAllowedBranchIds(user);

  const opname = await getOpnameById(allowedBranchIds, id);
  if (!opname) notFound();

  const canPost = can(user, "inventory.adjust") && opname.status === "DRAFT";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Opname {opname.documentNumber}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Cabang: {opname.branch.code} — {opname.branch.name}
          </p>
        </div>
        {canPost && <PostOpnameButton id={opname.id} />}
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <Info label="Status" value={opname.status} />
        <Info
          label="Dibuat"
          value={`${formatDateTime(opname.createdAt)} — ${opname.createdBy.name}`}
        />
        <Info
          label="Diposting"
          value={
            opname.postedAt
              ? `${formatDateTime(opname.postedAt)} — ${opname.postedBy?.name ?? "-"}`
              : "-"
          }
        />
        {opname.notes && (
          <div className="sm:col-span-3">
            <Info label="Catatan" value={opname.notes} />
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Produk</th>
              <th className="px-4 py-2">No. Batch</th>
              <th className="px-4 py-2">ED</th>
              <th className="px-4 py-2 text-right">Sistem</th>
              <th className="px-4 py-2 text-right">Hitung Fisik</th>
              <th className="px-4 py-2 text-right">Selisih</th>
            </tr>
          </thead>
          <tbody>
            {opname.items.map((item) => {
              const diff = new Prisma.Decimal(item.countedQty.toString()).minus(
                item.systemQty.toString(),
              );
              return (
                <tr key={item.id} className="border-b border-slate-100">
                  <td className="px-4 py-2">
                    {item.batch.product.sku} — {item.batch.product.name}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{item.batch.batchNumber}</td>
                  <td className="px-4 py-2">{formatDate(item.batch.expiryDate)}</td>
                  <td className="px-4 py-2 text-right">
                    {formatDecimalQty(item.systemQty.toString())}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatDecimalQty(item.countedQty.toString())}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-medium ${
                      diff.isZero()
                        ? "text-slate-500"
                        : diff.greaterThan(0)
                          ? "text-emerald-700"
                          : "text-red-700"
                    }`}
                  >
                    {diff.greaterThan(0) ? "+" : ""}
                    {formatDecimalQty(diff.toString())}
                  </td>
                </tr>
              );
            })}
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
