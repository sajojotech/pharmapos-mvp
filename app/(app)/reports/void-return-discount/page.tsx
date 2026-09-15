import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds, listActiveBranches } from "@/services/branch-service";
import {
  getDiscountReport,
  getReturnReport,
  getVoidReport,
} from "@/services/reports/void-return-discount-report";
import { jakartaDayEnd, jakartaDayStart } from "@/lib/timezone";
import { parseDateRangeParams } from "@/lib/report-export";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { ReportExportLink } from "@/components/reports/report-export-link";
import { formatDateTime, formatDecimalQty, formatRupiah } from "@/lib/format";

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function VoidReturnDiscountReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("report.read.branch");
  const resolved = await searchParams;
  const branchId = str(resolved.branchId);
  const { dateFrom, dateTo } = parseDateRangeParams({
    dateFrom: str(resolved.dateFrom),
    dateTo: str(resolved.dateTo),
  });

  const allowedBranchIds = await getAllowedBranchIds(user);
  const branches = await listActiveBranches(user.companyId);

  const dateRange = {
    companyId: user.companyId,
    allowedBranchIds,
    branchId,
    dateFrom: jakartaDayStart(dateFrom),
    dateTo: jakartaDayEnd(dateTo),
  };

  const [voidRows, returnRows, discountRows] = await Promise.all([
    getVoidReport(dateRange),
    getReturnReport(dateRange),
    getDiscountReport(dateRange),
  ]);

  const branchOptions = branches
    .filter((b) => allowedBranchIds.includes(b.id))
    .map((b) => ({ id: b.id, label: `${b.code} — ${b.name}` }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Void, Retur, &amp; Diskon</h1>
        <p className="mt-1 text-sm text-slate-600">
          Transaksi yang di-void, retur penjualan, dan ringkasan diskon
          dalam rentang tanggal yang dipilih.
        </p>
      </div>

      <ReportFilterBar branches={branchOptions} />

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Transaksi Di-void</h2>
          <ReportExportLink
            basePath="/reports/void-return-discount"
            filters={{ section: "void", branchId, dateFrom, dateTo }}
          />
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Invoice</th>
                <th className="px-4 py-2">Cabang</th>
                <th className="px-4 py-2">Waktu Void</th>
                <th className="px-4 py-2">Oleh</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2">Alasan</th>
              </tr>
            </thead>
            <tbody>
              {voidRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Tidak ada transaksi di-void untuk filter ini.
                  </td>
                </tr>
              )}
              {voidRows.map((row) => (
                <tr key={row.transactionId} className="border-b border-slate-100">
                  <td className="px-4 py-2 font-mono text-xs">{row.documentNumber}</td>
                  <td className="px-4 py-2">
                    {row.branchCode} — {row.branchName}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatDateTime(row.voidedAt)}</td>
                  <td className="px-4 py-2">{row.voidedByName}</td>
                  <td className="px-4 py-2 text-right">{formatRupiah(row.totalAmount.toString())}</td>
                  <td className="px-4 py-2">{row.voidReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Retur Penjualan</h2>
          <ReportExportLink
            basePath="/reports/void-return-discount"
            filters={{ section: "return", branchId, dateFrom, dateTo }}
          />
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Invoice</th>
                <th className="px-4 py-2">Cabang</th>
                <th className="px-4 py-2">Waktu</th>
                <th className="px-4 py-2">Oleh</th>
                <th className="px-4 py-2 text-right">Item</th>
                <th className="px-4 py-2 text-right">Qty Retur</th>
                <th className="px-4 py-2">Alasan</th>
              </tr>
            </thead>
            <tbody>
              {returnRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Tidak ada retur untuk filter ini.
                  </td>
                </tr>
              )}
              {returnRows.map((row) => (
                <tr key={row.salesReturnId} className="border-b border-slate-100">
                  <td className="px-4 py-2 font-mono text-xs">{row.documentNumber}</td>
                  <td className="px-4 py-2">
                    {row.branchCode} — {row.branchName}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-2">{row.createdByName}</td>
                  <td className="px-4 py-2 text-right">{row.itemCount}</td>
                  <td className="px-4 py-2 text-right">{formatDecimalQty(row.totalQtyReturned.toString())}</td>
                  <td className="px-4 py-2">{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Ringkasan Diskon per Cabang</h2>
          <ReportExportLink
            basePath="/reports/void-return-discount"
            filters={{ section: "discount", branchId, dateFrom, dateTo }}
          />
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Cabang</th>
                <th className="px-4 py-2 text-right">Jumlah Transaksi</th>
                <th className="px-4 py-2 text-right">Subtotal</th>
                <th className="px-4 py-2 text-right">Diskon</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2 text-right">% Diskon</th>
              </tr>
            </thead>
            <tbody>
              {discountRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Tidak ada penjualan untuk filter ini.
                  </td>
                </tr>
              )}
              {discountRows.map((row) => (
                <tr key={row.branchId} className="border-b border-slate-100">
                  <td className="px-4 py-2">
                    {row.branchCode} — {row.branchName}
                  </td>
                  <td className="px-4 py-2 text-right">{row.transactionCount}</td>
                  <td className="px-4 py-2 text-right">{formatRupiah(row.subtotal.toString())}</td>
                  <td className="px-4 py-2 text-right">{formatRupiah(row.discountAmount.toString())}</td>
                  <td className="px-4 py-2 text-right font-medium">
                    {formatRupiah(row.totalAmount.toString())}
                  </td>
                  <td className="px-4 py-2 text-right">{row.discountPct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
