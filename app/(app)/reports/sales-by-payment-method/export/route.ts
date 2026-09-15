import { checkPermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getSalesByPaymentMethod } from "@/services/reports/sales-report";
import { jakartaDayEnd, jakartaDayStart } from "@/lib/timezone";
import { parseDateRangeParams } from "@/lib/report-export";
import { csvResponse, toCsv } from "@/lib/csv";

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Tunai",
  QRIS: "QRIS",
  BANK_TRANSFER: "Transfer Bank",
  DEBIT_CARD: "Kartu Debit",
  E_WALLET: "E-Wallet",
};

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
  const rows = await getSalesByPaymentMethod({
    companyId: access.user.companyId,
    allowedBranchIds,
    branchId,
    dateFrom: jakartaDayStart(dateFrom),
    dateTo: jakartaDayEnd(dateTo),
  });

  const csv = toCsv(
    ["Metode", "Jumlah Pembayaran", "Total"],
    rows.map((r) => [PAYMENT_METHOD_LABELS[r.method] ?? r.method, r.paymentCount, r.totalAmount.toString()]),
  );
  return csvResponse(`penjualan-per-metode-pembayaran_${dateFrom}_${dateTo}.csv`, csv);
}
