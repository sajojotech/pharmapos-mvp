import { CashierShiftStatus } from "@prisma/client";
import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { listShiftsPaginated } from "@/services/cashier-shift-service";
import { jakartaDayEnd, jakartaDayStart } from "@/lib/timezone";
import { parseDateRangeParams, EXPORT_MAX_ROWS } from "@/lib/report-export";
import { csvResponse, toCsv } from "@/lib/csv";

export async function GET(request: Request) {
  const access = await checkPermission("report.read.branch");
  if (!access.ok) return new Response(access.error, { status: 403 });

  const { searchParams } = new URL(request.url);
  const branchId = searchParams.get("branchId") || undefined;
  const status = (searchParams.get("status") as CashierShiftStatus | null) || undefined;
  const { dateFrom, dateTo } = parseDateRangeParams({
    dateFrom: searchParams.get("dateFrom") || undefined,
    dateTo: searchParams.get("dateTo") || undefined,
  });

  const allowedBranchIds = await getAllowedBranchIds(access.user);
  const { data } = await listShiftsPaginated({
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
    ["Cabang", "Kasir", "Dibuka", "Modal Awal", "Kas Aktual", "Variance", "Status"],
    data.map((s) => [
      s.branch.code,
      s.user.name,
      s.openedAt.toISOString(),
      s.openingCash.toString(),
      s.actualCash?.toString() ?? "",
      s.variance?.toString() ?? "",
      s.status,
    ]),
  );
  return csvResponse(`rekap-shift_${dateFrom}_${dateTo}.csv`, csv);
}
