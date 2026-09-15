import Link from "next/link";
import { StockDocumentStatus } from "@prisma/client";
import { can, requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { listAdjustmentsPaginated } from "@/services/stock-adjustment-service";
import { MasterPagination } from "@/components/master/master-pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { formatDateTime } from "@/lib/format";

const STATUS_LABELS: Record<StockDocumentStatus, string> = {
  DRAFT: "Draft",
  POSTED: "Posted",
  CANCELLED: "Dibatalkan",
};

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function AdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("inventory.read");
  const resolved = await searchParams;
  const status = str(resolved.status) as StockDocumentStatus | undefined;
  const page = Math.max(1, Number.parseInt(str(resolved.page) ?? "1", 10) || 1);

  const allowedBranchIds = await getAllowedBranchIds(user);
  const canAdjust = can(user, "inventory.adjust");

  const { data, totalCount } = await listAdjustmentsPaginated({
    companyId: user.companyId,
    allowedBranchIds,
    status,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Stock Adjustment</h1>
          <p className="mt-1 text-sm text-slate-600">
            Koreksi stok manual dengan alasan tercatat. Dokumen posted bersifat immutable.
          </p>
        </div>
        {canAdjust && (
          <Link
            href="/inventory/adjustments/new"
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            + Buat Adjustment
          </Link>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">No. Dokumen</th>
              <th className="px-4 py-2">Cabang</th>
              <th className="px-4 py-2">Alasan</th>
              <th className="px-4 py-2">Dibuat</th>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Belum ada dokumen adjustment.
                </td>
              </tr>
            )}
            {data.map((adj) => (
              <tr key={adj.id} className="border-b border-slate-100">
                <td className="px-4 py-2 font-mono text-xs">{adj.documentNumber}</td>
                <td className="px-4 py-2">{adj.branch.code}</td>
                <td className="px-4 py-2">{adj.reason}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {formatDateTime(adj.createdAt)} — {adj.createdBy.name}
                </td>
                <td className="px-4 py-2">{adj._count.items}</td>
                <td className="px-4 py-2">{STATUS_LABELS[adj.status]}</td>
                <td className="px-4 py-2">
                  <Link
                    href={`/inventory/adjustments/${adj.id}`}
                    className="text-emerald-700 hover:underline"
                  >
                    Detail
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <MasterPagination
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        totalCount={totalCount}
        searchParams={{ status }}
        basePath="/inventory/adjustments"
      />
    </div>
  );
}
