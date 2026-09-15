import Link from "next/link";
import { CashierShiftStatus } from "@prisma/client";
import { getActiveBranchContext, requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getOpenShiftForUser, listShiftsPaginated } from "@/services/cashier-shift-service";
import { MasterPagination } from "@/components/master/master-pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { toPlainJSON } from "@/lib/serialize";
import { ShiftPanel } from "./shift-panel";

const STATUS_LABELS: Record<CashierShiftStatus, string> = {
  OPEN: "Terbuka",
  PENDING_APPROVAL: "Menunggu Persetujuan",
  CLOSED: "Ditutup",
};

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function CashierShiftsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("shift.manage");
  const resolved = await searchParams;
  const page = Math.max(1, Number.parseInt(str(resolved.page) ?? "1", 10) || 1);

  const [context, allowedBranchIds, openShift] = await Promise.all([
    getActiveBranchContext(),
    getAllowedBranchIds(user),
    getOpenShiftForUser(user.id),
  ]);

  const { data, totalCount } = await listShiftsPaginated({
    companyId: user.companyId,
    allowedBranchIds,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  if (!context.activeBranchId || !context.activeBranch) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Anda belum ditugaskan ke cabang mana pun, sehingga shift kasir tidak
        dapat dibuka. Hubungi Admin Pusat untuk penugasan cabang.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Shift Kasir</h1>
        <p className="mt-1 text-sm text-slate-600">
          Cabang aktif: {context.activeBranch.code} — {context.activeBranch.name}
        </p>
      </div>

      <ShiftPanel
        branchId={context.activeBranchId}
        branchLabel={`${context.activeBranch.code} — ${context.activeBranch.name}`}
        openShift={toPlainJSON(openShift)}
      />

      <div>
        <h2 className="text-sm font-semibold text-slate-900">Riwayat Shift</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Cabang</th>
                <th className="px-4 py-2">Kasir</th>
                <th className="px-4 py-2">Dibuka</th>
                <th className="px-4 py-2 text-right">Modal Awal</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Belum ada shift.
                  </td>
                </tr>
              )}
              {data.map((shift) => (
                <tr key={shift.id} className="border-b border-slate-100">
                  <td className="px-4 py-2">{shift.branch.code}</td>
                  <td className="px-4 py-2">{shift.user.name}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatDateTime(shift.openedAt)}</td>
                  <td className="px-4 py-2 text-right">
                    {formatRupiah(shift.openingCash.toString())}
                  </td>
                  <td className="px-4 py-2">{STATUS_LABELS[shift.status]}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/cashier/shifts/${shift.id}`}
                      className="text-emerald-700 hover:underline"
                    >
                      Detail
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-2">
          <MasterPagination
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            totalCount={totalCount}
            searchParams={{}}
            basePath="/cashier/shifts"
          />
        </div>
      </div>
    </div>
  );
}
