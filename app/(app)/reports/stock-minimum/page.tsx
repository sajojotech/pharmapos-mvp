import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds, listActiveBranches } from "@/services/branch-service";
import { listActiveCategories } from "@/services/category-service";
import { getStockMinimumReport } from "@/services/reports/inventory-report";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { ReportExportLink } from "@/components/reports/report-export-link";
import { formatDecimalQty } from "@/lib/format";

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function StockMinimumReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("report.read.branch");
  const resolved = await searchParams;
  const branchId = str(resolved.branchId);
  const categoryId = str(resolved.categoryId);

  const allowedBranchIds = await getAllowedBranchIds(user);
  const [branches, categories] = await Promise.all([
    listActiveBranches(user.companyId),
    listActiveCategories(user.companyId),
  ]);

  const rows = await getStockMinimumReport({
    companyId: user.companyId,
    allowedBranchIds,
    branchId,
    categoryId,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Stok Minimum</h1>
        <p className="mt-1 text-sm text-slate-600">
          Produk yang saldonya sudah di bawah atau sama dengan stok minimum
          (`defaultMinStock`) di cabang masing-masing.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ReportFilterBar
          branches={branches
            .filter((b) => allowedBranchIds.includes(b.id))
            .map((b) => ({ id: b.id, label: `${b.code} — ${b.name}` }))}
          categories={categories.map((c) => ({ id: c.id, label: c.name }))}
          showDateRange={false}
        />
        <ReportExportLink basePath="/reports/stock-minimum" filters={{ branchId, categoryId }} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Cabang</th>
              <th className="px-4 py-2">Produk</th>
              <th className="px-4 py-2">Kategori</th>
              <th className="px-4 py-2 text-right">Qty Saat Ini</th>
              <th className="px-4 py-2 text-right">Stok Minimum</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Tidak ada produk di bawah stok minimum untuk filter ini.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={`${row.branchId}-${row.productId}`} className="border-b border-slate-100">
                <td className="px-4 py-2">
                  {row.branchCode} — {row.branchName}
                </td>
                <td className="px-4 py-2">
                  {row.productSku} — {row.productName}
                </td>
                <td className="px-4 py-2">{row.categoryName}</td>
                <td className="px-4 py-2 text-right text-red-700">
                  {formatDecimalQty(row.qtyOnHand.toString())}
                </td>
                <td className="px-4 py-2 text-right">{formatDecimalQty(row.minStock.toString())}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
