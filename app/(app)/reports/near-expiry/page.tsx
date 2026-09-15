import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds, listActiveBranches } from "@/services/branch-service";
import { listActiveProducts } from "@/services/product-service";
import { getNearExpiryReport, resolveNearExpiryWindowDays } from "@/services/reports/inventory-report";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { ReportExportLink } from "@/components/reports/report-export-link";
import { MasterPagination } from "@/components/master/master-pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { formatDate, formatDecimalQty } from "@/lib/format";

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function NearExpiryReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("report.read.branch");
  const resolved = await searchParams;
  const branchId = str(resolved.branchId);
  const productId = str(resolved.productId);
  const page = Math.max(1, Number.parseInt(str(resolved.page) ?? "1", 10) || 1);

  const allowedBranchIds = await getAllowedBranchIds(user);
  const [branches, products, windowDays] = await Promise.all([
    listActiveBranches(user.companyId),
    listActiveProducts(user.companyId),
    resolveNearExpiryWindowDays(user.companyId),
  ]);

  const { data, totalCount } = await getNearExpiryReport({
    companyId: user.companyId,
    allowedBranchIds,
    branchId,
    productId,
    windowDays,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Produk Mendekati ED</h1>
        <p className="mt-1 text-sm text-slate-600">
          Batch AVAILABLE yang tanggal ED-nya jatuh dalam {windowDays} hari
          ke depan (window dari AppSetting <code>NEAR_EXPIRY_WINDOW_DAYS</code>,
          default 90 hari). Batch yang sudah lewat ED ada di laporan{" "}
          <a href="/reports/expired" className="text-emerald-700 hover:underline">
            Produk Kedaluwarsa
          </a>
          , terpisah dari sini.
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
        <ReportExportLink basePath="/reports/near-expiry" filters={{ branchId, productId }} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Cabang</th>
              <th className="px-4 py-2">Produk</th>
              <th className="px-4 py-2">No. Batch</th>
              <th className="px-4 py-2">ED</th>
              <th className="px-4 py-2 text-right">Qty</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Tidak ada batch mendekati ED untuk filter ini.
                </td>
              </tr>
            )}
            {data.map((batch) => (
              <tr key={batch.id} className="border-b border-slate-100">
                <td className="px-4 py-2">{batch.branch.code}</td>
                <td className="px-4 py-2">
                  {batch.product.sku} — {batch.product.name}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{batch.batchNumber}</td>
                <td className="px-4 py-2 text-amber-700">{formatDate(batch.expiryDate)}</td>
                <td className="px-4 py-2 text-right">{formatDecimalQty(batch.qtyOnHand.toString())}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <MasterPagination
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        totalCount={totalCount}
        searchParams={{ branchId, productId }}
        basePath="/reports/near-expiry"
      />
    </div>
  );
}
