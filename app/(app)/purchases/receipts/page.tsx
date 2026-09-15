import Link from "next/link";
import { StockDocumentStatus } from "@prisma/client";
import { can, requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { listReceiptsPaginated } from "@/services/purchase-receipt-service";
import { MasterPagination } from "@/components/master/master-pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { formatDate } from "@/lib/format";

const STATUS_LABELS: Record<StockDocumentStatus, string> = {
  DRAFT: "Draft",
  POSTED: "Posted",
  CANCELLED: "Dibatalkan",
};

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function PurchaseReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("purchase.manage");
  const resolved = await searchParams;
  const status = str(resolved.status) as StockDocumentStatus | undefined;
  const page = Math.max(1, Number.parseInt(str(resolved.page) ?? "1", 10) || 1);

  const allowedBranchIds = await getAllowedBranchIds(user);
  const canManage = can(user, "purchase.manage");

  const { data, totalCount } = await listReceiptsPaginated({
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
          <h1 className="text-2xl font-bold text-slate-900">Penerimaan Barang</h1>
          <p className="mt-1 text-sm text-slate-600">
            Dokumen penerimaan dari supplier. Posting menambah stok per batch/ED.
          </p>
        </div>
        {canManage && (
          <Link
            href="/purchases/receipts/new"
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            + Buat Penerimaan
          </Link>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">No. Dokumen</th>
              <th className="px-4 py-2">Cabang</th>
              <th className="px-4 py-2">Supplier</th>
              <th className="px-4 py-2">Tgl. Terima</th>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Belum ada dokumen penerimaan.
                </td>
              </tr>
            )}
            {data.map((receipt) => (
              <tr key={receipt.id} className="border-b border-slate-100">
                <td className="px-4 py-2 font-mono text-xs">{receipt.documentNumber}</td>
                <td className="px-4 py-2">{receipt.branch.code}</td>
                <td className="px-4 py-2">{receipt.supplier.name}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {formatDate(receipt.receivedDate)}
                </td>
                <td className="px-4 py-2">{receipt._count.items}</td>
                <td className="px-4 py-2">{STATUS_LABELS[receipt.status]}</td>
                <td className="px-4 py-2">
                  <Link
                    href={`/purchases/receipts/${receipt.id}`}
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
        basePath="/purchases/receipts"
      />
    </div>
  );
}
