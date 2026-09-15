import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getConsolidatedReport } from "@/services/reports/consolidated-report";
import { jakartaDayEnd, jakartaDayStart } from "@/lib/timezone";
import { parseDateRangeParams } from "@/lib/report-export";
import { csvResponse, toCsv } from "@/lib/csv";

export async function GET(request: Request) {
  const access = await checkPermission("report.read.all");
  if (!access.ok) return new Response(access.error, { status: 403 });

  const { searchParams } = new URL(request.url);
  const { dateFrom, dateTo } = parseDateRangeParams({
    dateFrom: searchParams.get("dateFrom") || undefined,
    dateTo: searchParams.get("dateTo") || undefined,
  });

  const allowedBranchIds = await getAllowedBranchIds(access.user);
  const report = await getConsolidatedReport({
    companyId: access.user.companyId,
    allowedBranchIds,
    dateFrom: jakartaDayStart(dateFrom),
    dateTo: jakartaDayEnd(dateTo),
  });

  const csv = toCsv(
    ["Cabang", "Jumlah Transaksi", "Omzet"],
    report.branchTotals.map((r) => [`${r.branchCode} — ${r.branchName}`, r.transactionCount, r.grossSales.toString()]),
  );
  return csvResponse(`konsolidasi-per-cabang_${dateFrom}_${dateTo}.csv`, csv);
}
