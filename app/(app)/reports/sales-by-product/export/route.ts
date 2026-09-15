import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getSalesByProductCategory } from "@/services/reports/sales-report";
import { jakartaDayEnd, jakartaDayStart } from "@/lib/timezone";
import { parseDateRangeParams } from "@/lib/report-export";
import { csvResponse, toCsv } from "@/lib/csv";

export async function GET(request: Request) {
  const access = await checkPermission("report.read.branch");
  if (!access.ok) return new Response(access.error, { status: 403 });

  const { searchParams } = new URL(request.url);
  const branchId = searchParams.get("branchId") || undefined;
  const categoryId = searchParams.get("categoryId") || undefined;
  const { dateFrom, dateTo } = parseDateRangeParams({
    dateFrom: searchParams.get("dateFrom") || undefined,
    dateTo: searchParams.get("dateTo") || undefined,
  });

  const allowedBranchIds = await getAllowedBranchIds(access.user);
  const rows = await getSalesByProductCategory({
    companyId: access.user.companyId,
    allowedBranchIds,
    branchId,
    categoryId,
    dateFrom: jakartaDayStart(dateFrom),
    dateTo: jakartaDayEnd(dateTo),
  });

  const csv = toCsv(
    ["SKU", "Produk", "Kategori", "Qty Terjual", "Omzet"],
    rows.map((r) => [r.productSku, r.productName, r.categoryName, r.qtySold.toString(), r.revenue.toString()]),
  );
  return csvResponse(`penjualan-per-produk_${dateFrom}_${dateTo}.csv`, csv);
}
