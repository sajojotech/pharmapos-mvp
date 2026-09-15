import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getStockAvailableReport } from "@/services/reports/inventory-report";
import { csvResponse, toCsv } from "@/lib/csv";

export async function GET(request: Request) {
  const access = await checkPermission("report.read.branch");
  if (!access.ok) return new Response(access.error, { status: 403 });

  const { searchParams } = new URL(request.url);
  const branchId = searchParams.get("branchId") || undefined;
  const productId = searchParams.get("productId") || undefined;

  const allowedBranchIds = await getAllowedBranchIds(access.user);
  const rows = await getStockAvailableReport({
    companyId: access.user.companyId,
    allowedBranchIds,
    branchId,
    productId,
  });

  const csv = toCsv(
    ["Cabang", "SKU", "Produk", "Qty"],
    rows.map((r) => [`${r.branchCode} — ${r.branchName}`, r.productSku, r.productName, r.qtyOnHand.toString()]),
  );
  return csvResponse("stok-tersedia.csv", csv);
}
