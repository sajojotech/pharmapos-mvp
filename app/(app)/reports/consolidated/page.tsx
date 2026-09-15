import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getConsolidatedReport } from "@/services/reports/consolidated-report";
import { jakartaDayEnd, jakartaDayStart } from "@/lib/timezone";
import { parseDateRangeParams } from "@/lib/report-export";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { ReportExportLink } from "@/components/reports/report-export-link";
import { formatDecimalQty, formatRupiah } from "@/lib/format";

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function ConsolidatedReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("report.read.all");
  const resolved = await searchParams;
  const { dateFrom, dateTo } = parseDateRangeParams({
    dateFrom: str(resolved.dateFrom),
    dateTo: str(resolved.dateTo),
  });

  const allowedBranchIds = await getAllowedBranchIds(user);
  const report = await getConsolidatedReport({
    companyId: user.companyId,
    allowedBranchIds,
    dateFrom: jakartaDayStart(dateFrom),
    dateTo: jakartaDayEnd(dateTo),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard Konsolidasi</h1>
        <p className="mt-1 text-sm text-slate-600">
          Ringkasan lintas-cabang untuk periode yang dipilih — versi
          date-range dari widget dashboard hari-ini.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ReportFilterBar />
        <ReportExportLink basePath="/reports/consolidated" filters={{ dateFrom, dateTo }} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total Omzet</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {formatRupiah(report.totalRevenue.toString())}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total Transaksi</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{report.totalTransactionCount}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Produk Stok Minimum</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{report.stockMinimumCount}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Batch Mendekati ED</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{report.nearExpiryCount}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Omzet per Cabang</h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Cabang</th>
                  <th className="px-4 py-2 text-right">Transaksi</th>
                  <th className="px-4 py-2 text-right">Omzet</th>
                </tr>
              </thead>
              <tbody>
                {report.branchTotals.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-slate-400">
                      Tidak ada penjualan untuk periode ini.
                    </td>
                  </tr>
                )}
                {report.branchTotals.map((row) => (
                  <tr key={row.branchId} className="border-b border-slate-100">
                    <td className="px-4 py-2">
                      {row.branchCode} — {row.branchName}
                    </td>
                    <td className="px-4 py-2 text-right">{row.transactionCount}</td>
                    <td className="px-4 py-2 text-right font-medium">
                      {formatRupiah(row.grossSales.toString())}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-slate-900">Produk Terlaris</h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Produk</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Omzet</th>
                </tr>
              </thead>
              <tbody>
                {report.topProducts.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-slate-400">
                      Tidak ada penjualan untuk periode ini.
                    </td>
                  </tr>
                )}
                {report.topProducts.map((row) => (
                  <tr key={row.productId} className="border-b border-slate-100">
                    <td className="px-4 py-2">{row.productName}</td>
                    <td className="px-4 py-2 text-right">{formatDecimalQty(row.qtySold.toString())}</td>
                    <td className="px-4 py-2 text-right font-medium">
                      {formatRupiah(row.revenue.toString())}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-900">Transfer In-Transit / Pending</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Asal</th>
                <th className="px-4 py-2">Tujuan</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {report.pendingTransfers.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-slate-400">
                    Tidak ada transfer pending.
                  </td>
                </tr>
              )}
              {report.pendingTransfers.map((transfer) => (
                <tr key={transfer.id} className="border-b border-slate-100">
                  <td className="px-4 py-2">{transfer.sourceBranch.code}</td>
                  <td className="px-4 py-2">{transfer.destinationBranch.code}</td>
                  <td className="px-4 py-2">{transfer.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
