import { StockTransferStatus } from "@prisma/client";
import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { listTransfersPaginated } from "@/services/stock-transfer-service";
import { jakartaDayEnd, jakartaDayStart } from "@/lib/timezone";
import { parseDateRangeParams, EXPORT_MAX_ROWS } from "@/lib/report-export";
import { csvResponse, toCsv } from "@/lib/csv";

export async function GET(request: Request) {
  const access = await checkPermission("report.read.branch");
  if (!access.ok) return new Response(access.error, { status: 403 });

  const { searchParams } = new URL(request.url);
  const branchId = searchParams.get("branchId") || undefined;
  const status = (searchParams.get("status") as StockTransferStatus | null) || undefined;
  const { dateFrom, dateTo } = parseDateRangeParams({
    dateFrom: searchParams.get("dateFrom") || undefined,
    dateTo: searchParams.get("dateTo") || undefined,
  });

  const allowedBranchIds = await getAllowedBranchIds(access.user);
  const { data } = await listTransfersPaginated({
    companyId: access.user.companyId,
    allowedBranchIds,
    branchId,
    status,
    dateFrom: jakartaDayStart(dateFrom),
    dateTo: jakartaDayEnd(dateTo),
    page: 1,
    pageSize: EXPORT_MAX_ROWS,
  });

  const csv = toCsv(
    ["No. Dokumen", "Asal", "Tujuan", "Dibuat", "Jumlah Item", "Status"],
    data.map((t) => [
      t.documentNumber,
      t.sourceBranch.code,
      t.destinationBranch.code,
      t.createdAt.toISOString(),
      t._count.items,
      t.status,
    ]),
  );
  return csvResponse(`transfer-antar-cabang_${dateFrom}_${dateTo}.csv`, csv);
}
