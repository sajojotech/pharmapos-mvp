import Link from "next/link";
import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { listTransactionsPaginated } from "@/services/pos-transaction-service";
import { MasterPagination } from "@/components/master/master-pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { formatDateTime, formatRupiah } from "@/lib/format";

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function PosTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("pos.sell");
  const resolved = await searchParams;
  const page = Math.max(1, Number.parseInt(str(resolved.page) ?? "1", 10) || 1);

  const allowedBranchIds = await getAllowedBranchIds(user);
  const { data, totalCount } = await listTransactionsPaginated({
    companyId: user.companyId,
    allowedBranchIds,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Riwayat Transaksi POS</h1>
        <p className="mt-1 text-sm text-slate-600">
          Seluruh transaksi yang sudah dibayar di cabang yang Anda akses.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">No. Invoice</th>
              <th className="px-4 py-2">Cabang</th>
              <th className="px-4 py-2">Customer</th>
              <th className="px-4 py-2">Waktu</th>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2 text-right">Total</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Belum ada transaksi.
                </td>
              </tr>
            )}
            {data.map((trx) => (
              <tr key={trx.id} className="border-b border-slate-100">
                <td className="px-4 py-2 font-mono text-xs">{trx.documentNumber}</td>
                <td className="px-4 py-2">{trx.branch.code}</td>
                <td className="px-4 py-2">{trx.customer.name}</td>
                <td className="px-4 py-2 whitespace-nowrap">{formatDateTime(trx.paidAt ?? trx.createdAt)}</td>
                <td className="px-4 py-2">{trx._count.items}</td>
                <td className="px-4 py-2 text-right">{formatRupiah(trx.totalAmount.toString())}</td>
                <td className="px-4 py-2">
                  <Link
                    href={`/pos/transactions/${trx.id}`}
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
        searchParams={{}}
        basePath="/pos/transactions"
      />
    </div>
  );
}
