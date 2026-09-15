import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import {
  getDiscountReport,
  getReturnReport,
  getVoidReport,
} from "@/services/reports/void-return-discount-report";
import { jakartaDayEnd, jakartaDayStart } from "@/lib/timezone";
import { parseDateRangeParams } from "@/lib/report-export";
import { csvResponse, toCsv } from "@/lib/csv";

export async function GET(request: Request) {
  const access = await checkPermission("report.read.branch");
  if (!access.ok) return new Response(access.error, { status: 403 });

  const { searchParams } = new URL(request.url);
  const section = searchParams.get("section") || "void";
  const branchId = searchParams.get("branchId") || undefined;
  const { dateFrom, dateTo } = parseDateRangeParams({
    dateFrom: searchParams.get("dateFrom") || undefined,
    dateTo: searchParams.get("dateTo") || undefined,
  });

  const allowedBranchIds = await getAllowedBranchIds(access.user);
  const params = {
    companyId: access.user.companyId,
    allowedBranchIds,
    branchId,
    dateFrom: jakartaDayStart(dateFrom),
    dateTo: jakartaDayEnd(dateTo),
  };

  if (section === "return") {
    const rows = await getReturnReport(params);
    const csv = toCsv(
      ["Invoice", "Cabang", "Waktu", "Oleh", "Jumlah Item", "Qty Retur", "Alasan"],
      rows.map((r) => [
        r.documentNumber,
        `${r.branchCode} — ${r.branchName}`,
        r.createdAt.toISOString(),
        r.createdByName,
        r.itemCount,
        r.totalQtyReturned.toString(),
        r.reason,
      ]),
    );
    return csvResponse(`retur-penjualan_${dateFrom}_${dateTo}.csv`, csv);
  }

  if (section === "discount") {
    const rows = await getDiscountReport(params);
    const csv = toCsv(
      ["Cabang", "Jumlah Transaksi", "Subtotal", "Diskon", "Total", "% Diskon"],
      rows.map((r) => [
        `${r.branchCode} — ${r.branchName}`,
        r.transactionCount,
        r.subtotal.toString(),
        r.discountAmount.toString(),
        r.totalAmount.toString(),
        r.discountPct.toFixed(2),
      ]),
    );
    return csvResponse(`ringkasan-diskon_${dateFrom}_${dateTo}.csv`, csv);
  }

  const rows = await getVoidReport(params);
  const csv = toCsv(
    ["Invoice", "Cabang", "Waktu Void", "Oleh", "Total", "Alasan"],
    rows.map((r) => [
      r.documentNumber,
      `${r.branchCode} — ${r.branchName}`,
      r.voidedAt.toISOString(),
      r.voidedByName,
      r.totalAmount.toString(),
      r.voidReason,
    ]),
  );
  return csvResponse(`transaksi-void_${dateFrom}_${dateTo}.csv`, csv);
}
