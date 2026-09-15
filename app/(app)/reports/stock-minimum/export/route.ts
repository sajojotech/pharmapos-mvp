import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getStockMinimumReport } from "@/services/reports/inventory-report";
import { csvResponse, toCsv } from "@/lib/csv";

export async function GET(request: Request) {
  const access = await checkPermission("report.read.branch");
  if (!access.ok) return new Response(access.error, { status: 403 });

  const { searchParams } = new URL(request.url);
  const branchId = searchParams.get("branchId") || undefined;
  const categoryId = searchParams.get("categoryId") || undefined;

  const allowedBranchIds = await getAllowedBranchIds(access.user);
  const rows = await getStockMinimumReport({
    companyId: access.user.companyId,
    allowedBranchIds,
    branchId,
    categoryId,
  });

  const csv = toCsv(
    ["Cabang", "SKU", "Produk", "Kategori", "Qty Saat Ini", "Stok Minimum"],
    rows.map((r) => [
      `${r.branchCode} — ${r.branchName}`,
      r.productSku,
      r.productName,
      r.categoryName,
      r.qtyOnHand.toString(),
      r.minStock.toString(),
    ]),
  );
  return csvResponse("stok-minimum.csv", csv);
}
