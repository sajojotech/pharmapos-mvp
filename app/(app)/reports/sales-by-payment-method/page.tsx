import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds, listActiveBranches } from "@/services/branch-service";
import { getSalesByPaymentMethod } from "@/services/reports/sales-report";
import { jakartaDayEnd, jakartaDayStart } from "@/lib/timezone";
import { parseDateRangeParams } from "@/lib/report-export";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { ReportExportLink } from "@/components/reports/report-export-link";
import { formatRupiah } from "@/lib/format";

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Tunai",
  QRIS: "QRIS",
  BANK_TRANSFER: "Transfer Bank",
  DEBIT_CARD: "Kartu Debit",
  E_WALLET: "E-Wallet",
};

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function SalesByPaymentMethodReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("report.read.branch");
  const resolved = await searchParams;
  const branchId = str(resolved.branchId);
  const { dateFrom, dateTo } = parseDateRangeParams({
    dateFrom: str(resolved.dateFrom),
    dateTo: str(resolved.dateTo),
  });

  const allowedBranchIds = await getAllowedBranchIds(user);
  const branches = await listActiveBranches(user.companyId);

  const rows = await getSalesByPaymentMethod({
    companyId: user.companyId,
    allowedBranchIds,
    branchId,
    dateFrom: jakartaDayStart(dateFrom),
    dateTo: jakartaDayEnd(dateTo),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Penjualan per Metode Pembayaran</h1>
        <p className="mt-1 text-sm text-slate-600">
          Total pembayaran per metode (Tunai, QRIS, dst.) dalam rentang
          tanggal yang dipilih.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ReportFilterBar
          branches={branches
            .filter((b) => allowedBranchIds.includes(b.id))
            .map((b) => ({ id: b.id, label: `${b.code} — ${b.name}` }))}
        />
        <ReportExportLink
          basePath="/reports/sales-by-payment-method"
          filters={{ branchId, dateFrom, dateTo }}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Metode</th>
              <th className="px-4 py-2 text-right">Jumlah Pembayaran</th>
              <th className="px-4 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-slate-400">
                  Tidak ada pembayaran untuk filter ini.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.method} className="border-b border-slate-100">
                <td className="px-4 py-2">{PAYMENT_METHOD_LABELS[row.method] ?? row.method}</td>
                <td className="px-4 py-2 text-right">{row.paymentCount}</td>
                <td className="px-4 py-2 text-right font-medium">
                  {formatRupiah(row.totalAmount.toString())}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
