import { StockMovementType } from "@prisma/client";
import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { listMovementsPaginated } from "@/services/stock-movement-service";
import { EXPORT_MAX_ROWS } from "@/lib/report-export";
import { csvResponse, toCsv } from "@/lib/csv";

export async function GET(request: Request) {
  const access = await checkPermission("report.read.branch");
  if (!access.ok) return new Response(access.error, { status: 403 });

  const { searchParams } = new URL(request.url);
  const branchId = searchParams.get("branchId") || undefined;
  const productId = searchParams.get("productId") || undefined;
  const movementType = (searchParams.get("movementType") as StockMovementType | null) || undefined;
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  const allowedBranchIds = await getAllowedBranchIds(access.user);
  const { data } = await listMovementsPaginated({
    companyId: access.user.companyId,
    allowedBranchIds,
    branchId,
    productId,
    movementType,
    dateFrom: dateFrom ? new Date(dateFrom) : undefined,
    dateTo: dateTo ? new Date(`${dateTo}T23:59:59`) : undefined,
    page: 1,
    pageSize: EXPORT_MAX_ROWS,
  });

  const csv = toCsv(
    ["Waktu", "Cabang", "SKU", "Produk", "No. Batch", "Jenis Mutasi", "Masuk", "Keluar", "Saldo", "Oleh"],
    data.map((m) => [
      m.occurredAt.toISOString(),
      m.branch.code,
      m.product.sku,
      m.product.name,
      m.stockBatch.batchNumber,
      m.movementType,
      m.qtyIn.toString(),
      m.qtyOut.toString(),
      m.balanceAfter.toString(),
      m.createdBy.name,
    ]),
  );
  return csvResponse("kartu-stok.csv", csv);
}
