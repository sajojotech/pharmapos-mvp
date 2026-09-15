import Link from "next/link";
import { StockTransferStatus } from "@prisma/client";
import { can, requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { listTransfersPaginated } from "@/services/stock-transfer-service";
import { MasterPagination } from "@/components/master/master-pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { formatDateTime } from "@/lib/format";

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

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function StockTransfersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("transfer.manage");
  const resolved = await searchParams;
  const status = str(resolved.status) as StockTransferStatus | undefined;
  const page = Math.max(1, Number.parseInt(str(resolved.page) ?? "1", 10) || 1);

  const allowedBranchIds = await getAllowedBranchIds(user);
  const canManage = can(user, "transfer.manage");

  const { data, totalCount } = await listTransfersPaginated({
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
          <h1 className="text-2xl font-bold text-slate-900">Transfer Stok Antar-Cabang</h1>
          <p className="mt-1 text-sm text-slate-600">
            Cabang tujuan meminta, cabang asal menyetujui &amp; mengirim,
            cabang tujuan menerima. Lihat docs/TRANSFER.md untuk alur
            lengkap.
          </p>
        </div>
        {canManage && (
          <Link
            href="/inventory/transfers/new"
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            + Buat Transfer
          </Link>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">No. Dokumen</th>
              <th className="px-4 py-2">Asal</th>
              <th className="px-4 py-2">Tujuan</th>
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
                  Belum ada dokumen transfer.
                </td>
              </tr>
            )}
            {data.map((transfer) => (
              <tr key={transfer.id} className="border-b border-slate-100">
                <td className="px-4 py-2 font-mono text-xs">{transfer.documentNumber}</td>
                <td className="px-4 py-2">{transfer.sourceBranch.code}</td>
                <td className="px-4 py-2">{transfer.destinationBranch.code}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {formatDateTime(transfer.createdAt)}
                </td>
                <td className="px-4 py-2">{transfer._count.items}</td>
                <td className="px-4 py-2">{STATUS_LABELS[transfer.status]}</td>
                <td className="px-4 py-2">
                  <Link
                    href={`/inventory/transfers/${transfer.id}`}
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
        basePath="/inventory/transfers"
      />
    </div>
  );
}
