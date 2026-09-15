import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds, listActiveBranches } from "@/services/branch-service";
import { listActiveCategories } from "@/services/category-service";
import { getSalesByProductCategory } from "@/services/reports/sales-report";
import { jakartaDayEnd, jakartaDayStart } from "@/lib/timezone";
import { parseDateRangeParams } from "@/lib/report-export";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { ReportExportLink } from "@/components/reports/report-export-link";
import { formatDecimalQty, formatRupiah } from "@/lib/format";

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function SalesByProductReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("report.read.branch");
  const resolved = await searchParams;
  const branchId = str(resolved.branchId);
  const categoryId = str(resolved.categoryId);
  const { dateFrom, dateTo } = parseDateRangeParams({
    dateFrom: str(resolved.dateFrom),
    dateTo: str(resolved.dateTo),
  });

  const allowedBranchIds = await getAllowedBranchIds(user);
  const [branches, categories] = await Promise.all([
    listActiveBranches(user.companyId),
    listActiveCategories(user.companyId),
  ]);

  const rows = await getSalesByProductCategory({
    companyId: user.companyId,
    allowedBranchIds,
    branchId,
    categoryId,
    dateFrom: jakartaDayStart(dateFrom),
    dateTo: jakartaDayEnd(dateTo),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Penjualan per Produk &amp; Kategori</h1>
        <p className="mt-1 text-sm text-slate-600">
          Qty terjual &amp; omzet per produk, bisa difilter per kategori.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ReportFilterBar
          branches={branches
            .filter((b) => allowedBranchIds.includes(b.id))
            .map((b) => ({ id: b.id, label: `${b.code} — ${b.name}` }))}
          categories={categories.map((c) => ({ id: c.id, label: c.name }))}
        />
        <ReportExportLink
          basePath="/reports/sales-by-product"
          filters={{ branchId, categoryId, dateFrom, dateTo }}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Produk</th>
              <th className="px-4 py-2">Kategori</th>
              <th className="px-4 py-2 text-right">Qty Terjual</th>
              <th className="px-4 py-2 text-right">Omzet</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                  Tidak ada penjualan untuk filter ini.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.productId} className="border-b border-slate-100">
                <td className="px-4 py-2">
                  {row.productSku} — {row.productName}
                </td>
                <td className="px-4 py-2">{row.categoryName}</td>
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
  );
}
