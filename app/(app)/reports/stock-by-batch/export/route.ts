import { StockBatchStatus } from "@prisma/client";
import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { listBatchesPaginated } from "@/services/stock-batch-service";
import { EXPORT_MAX_ROWS } from "@/lib/report-export";
import { csvResponse, toCsv } from "@/lib/csv";

export async function GET(request: Request) {
  const access = await checkPermission("report.read.branch");
  if (!access.ok) return new Response(access.error, { status: 403 });

  const { searchParams } = new URL(request.url);
  const branchId = searchParams.get("branchId") || undefined;
  const productId = searchParams.get("productId") || undefined;
  const status = (searchParams.get("status") as StockBatchStatus | null) || undefined;
  const expiryFrom = searchParams.get("expiryFrom");
  const expiryTo = searchParams.get("expiryTo");

  const allowedBranchIds = await getAllowedBranchIds(access.user);
  const { data } = await listBatchesPaginated({
    companyId: access.user.companyId,
    allowedBranchIds,
    branchId,
    productId,
    status,
    expiryFrom: expiryFrom ? new Date(expiryFrom) : undefined,
    expiryTo: expiryTo ? new Date(`${expiryTo}T23:59:59`) : undefined,
    page: 1,
    pageSize: EXPORT_MAX_ROWS,
  });

  const csv = toCsv(
    ["Cabang", "SKU", "Produk", "No. Batch", "ED", "Qty", "Harga Modal", "Status"],
    data.map((b) => [
      b.branch.code,
      b.product.sku,
      b.product.name,
      b.batchNumber,
      b.expiryDate.toISOString().slice(0, 10),
      b.qtyOnHand.toString(),
      b.unitCost.toString(),
      b.status,
    ]),
  );
  return csvResponse("stok-per-batch.csv", csv);
}
