import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getExpiredReport } from "@/services/reports/inventory-report";
import { EXPORT_MAX_ROWS } from "@/lib/report-export";
import { csvResponse, toCsv } from "@/lib/csv";

export async function GET(request: Request) {
  const access = await checkPermission("report.read.branch");
  if (!access.ok) return new Response(access.error, { status: 403 });

  const { searchParams } = new URL(request.url);
  const branchId = searchParams.get("branchId") || undefined;
  const productId = searchParams.get("productId") || undefined;

  const allowedBranchIds = await getAllowedBranchIds(access.user);
  const { data } = await getExpiredReport({
    companyId: access.user.companyId,
    allowedBranchIds,
    branchId,
    productId,
    page: 1,
    pageSize: EXPORT_MAX_ROWS,
  });

  const csv = toCsv(
    ["Cabang", "SKU", "Produk", "No. Batch", "ED", "Qty"],
    data.map((b) => [
      b.branch.code,
      b.product.sku,
      b.product.name,
      b.batchNumber,
      b.expiryDate.toISOString().slice(0, 10),
      b.qtyOnHand.toString(),
    ]),
  );
  return csvResponse("produk-kedaluwarsa.csv", csv);
}
