import { CashierShiftStatus } from "@prisma/client";
import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds, listActiveBranches } from "@/services/branch-service";
import { listShiftsPaginated } from "@/services/cashier-shift-service";
import { jakartaDayEnd, jakartaDayStart } from "@/lib/timezone";
import { parseDateRangeParams } from "@/lib/report-export";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { ReportExportLink } from "@/components/reports/report-export-link";
import { MasterPagination } from "@/components/master/master-pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { formatDateTime, formatRupiah } from "@/lib/format";

const STATUS_LABELS: Record<CashierShiftStatus, string> = {
  OPEN: "Terbuka",
  PENDING_APPROVAL: "Menunggu Persetujuan",
  CLOSED: "Ditutup",
};

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function ShiftRecapReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("report.read.branch");
  const resolved = await searchParams;
  const branchId = str(resolved.branchId);
  const status = str(resolved.status) as CashierShiftStatus | undefined;
  const { dateFrom, dateTo } = parseDateRangeParams({
    dateFrom: str(resolved.dateFrom),
    dateTo: str(resolved.dateTo),
  });
  const page = Math.max(1, Number.parseInt(str(resolved.page) ?? "1", 10) || 1);

  const allowedBranchIds = await getAllowedBranchIds(user);
  const branches = await listActiveBranches(user.companyId);

  const { data, totalCount } = await listShiftsPaginated({
    companyId: user.companyId,
    allowedBranchIds,
    branchId,
    status,
    dateFrom: jakartaDayStart(dateFrom),
    dateTo: jakartaDayEnd(dateTo),
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Rekap Shift &amp; Variance Kas</h1>
        <p className="mt-1 text-sm text-slate-600">
          Riwayat shift kasir beserta selisih kas (variance) saat tutup.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ReportFilterBar
          branches={branches
            .filter((b) => allowedBranchIds.includes(b.id))
            .map((b) => ({ id: b.id, label: `${b.code} — ${b.name}` }))}
          statusOptions={Object.entries(STATUS_LABELS).map(([id, label]) => ({ id, label }))}
        />
        <ReportExportLink
          basePath="/reports/shift-recap"
          filters={{ branchId, status, dateFrom, dateTo }}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Cabang</th>
              <th className="px-4 py-2">Kasir</th>
              <th className="px-4 py-2">Dibuka</th>
              <th className="px-4 py-2 text-right">Modal Awal</th>
              <th className="px-4 py-2 text-right">Kas Aktual</th>
              <th className="px-4 py-2 text-right">Variance</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Tidak ada shift untuk filter ini.
                </td>
              </tr>
            )}
            {data.map((shift) => (
              <tr key={shift.id} className="border-b border-slate-100">
                <td className="px-4 py-2">{shift.branch.code}</td>
                <td className="px-4 py-2">{shift.user.name}</td>
                <td className="px-4 py-2 whitespace-nowrap">{formatDateTime(shift.openedAt)}</td>
                <td className="px-4 py-2 text-right">{formatRupiah(shift.openingCash.toString())}</td>
                <td className="px-4 py-2 text-right">
                  {shift.actualCash ? formatRupiah(shift.actualCash.toString()) : "-"}
                </td>
                <td className="px-4 py-2 text-right">
                  {shift.variance ? formatRupiah(shift.variance.toString()) : "-"}
                </td>
                <td className="px-4 py-2">{STATUS_LABELS[shift.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <MasterPagination
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        totalCount={totalCount}
        searchParams={{ branchId, status, dateFrom, dateTo }}
        basePath="/reports/shift-recap"
      />
    </div>
  );
}
