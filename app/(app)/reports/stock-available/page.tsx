import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds, listActiveBranches } from "@/services/branch-service";
import { listActiveProducts } from "@/services/product-service";
import { getStockAvailableReport } from "@/services/reports/inventory-report";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { ReportExportLink } from "@/components/reports/report-export-link";
import { formatDecimalQty } from "@/lib/format";

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function StockAvailableReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("report.read.branch");
  const resolved = await searchParams;
  const branchId = str(resolved.branchId);
  const productId = str(resolved.productId);

  const allowedBranchIds = await getAllowedBranchIds(user);
  const [branches, products] = await Promise.all([
    listActiveBranches(user.companyId),
    listActiveProducts(user.companyId),
  ]);

  const rows = await getStockAvailableReport({
    companyId: user.companyId,
    allowedBranchIds,
    branchId,
    productId,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Stok Tersedia per Cabang</h1>
        <p className="mt-1 text-sm text-slate-600">
          Saldo stok teragregasi per cabang &amp; produk (seluruh status
          batch, bukan hanya yang sellable).
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ReportFilterBar
          branches={branches
            .filter((b) => allowedBranchIds.includes(b.id))
            .map((b) => ({ id: b.id, label: `${b.code} — ${b.name}` }))}
          products={products.map((p) => ({ id: p.id, label: `${p.sku} — ${p.name}` }))}
          showDateRange={false}
        />
        <ReportExportLink basePath="/reports/stock-available" filters={{ branchId, productId }} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Cabang</th>
              <th className="px-4 py-2">Produk</th>
              <th className="px-4 py-2 text-right">Qty</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-slate-400">
                  Tidak ada stok untuk filter ini.
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
                <td className="px-4 py-2 text-right font-medium">
                  {formatDecimalQty(row.qtyOnHand.toString())}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
