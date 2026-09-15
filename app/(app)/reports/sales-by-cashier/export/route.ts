import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getSalesByCashier } from "@/services/reports/sales-report";
import { jakartaDayEnd, jakartaDayStart } from "@/lib/timezone";
import { parseDateRangeParams } from "@/lib/report-export";
import { csvResponse, toCsv } from "@/lib/csv";

export async function GET(request: Request) {
  const access = await checkPermission("report.read.branch");
  if (!access.ok) return new Response(access.error, { status: 403 });

  const { searchParams } = new URL(request.url);
  const branchId = searchParams.get("branchId") || undefined;
  const { dateFrom, dateTo } = parseDateRangeParams({
    dateFrom: searchParams.get("dateFrom") || undefined,
    dateTo: searchParams.get("dateTo") || undefined,
  });

  const allowedBranchIds = await getAllowedBranchIds(access.user);
  const rows = await getSalesByCashier({
    companyId: access.user.companyId,
    allowedBranchIds,
    branchId,
    dateFrom: jakartaDayStart(dateFrom),
    dateTo: jakartaDayEnd(dateTo),
  });

  const csv = toCsv(
    ["Kasir", "Jumlah Transaksi", "Omzet"],
    rows.map((r) => [r.cashierName, r.transactionCount, r.grossSales.toString()]),
  );
  return csvResponse(`penjualan-per-kasir_${dateFrom}_${dateTo}.csv`, csv);
}
