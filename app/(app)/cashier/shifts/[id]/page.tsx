import { notFound } from "next/navigation";
import { CashierShiftStatus } from "@prisma/client";
import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getShiftById } from "@/services/cashier-shift-service";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { ApproveShiftButton } from "./approve-button";

const STATUS_LABELS: Record<CashierShiftStatus, string> = {
  OPEN: "Terbuka",
  PENDING_APPROVAL: "Menunggu Persetujuan",
  CLOSED: "Ditutup",
};

export default async function ShiftDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("shift.manage");
  const { id } = await params;
  const allowedBranchIds = await getAllowedBranchIds(user);

  const shift = await getShiftById(allowedBranchIds, id);
  if (!shift) notFound();

  const canApprove =
    shift.status === "PENDING_APPROVAL" &&
    (user.role === "OWNER" || user.role === "BRANCH_MANAGER");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Shift {shift.branch.code} — {shift.user.name}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Dibuka {formatDateTime(shift.openedAt)}
          </p>
        </div>
        {canApprove && <ApproveShiftButton shiftId={shift.id} />}
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <Info label="Status" value={STATUS_LABELS[shift.status]} />
        <Info label="Modal Kas Awal" value={formatRupiah(shift.openingCash.toString())} />
        <Info
          label="Kas Aktual"
          value={shift.actualCash ? formatRupiah(shift.actualCash.toString()) : "-"}
        />
        <Info
          label="Kas Diharapkan (Sistem)"
          value={shift.expectedCash ? formatRupiah(shift.expectedCash.toString()) : "-"}
        />
        <Info
          label="Selisih (Variance)"
          value={shift.variance ? formatRupiah(shift.variance.toString()) : "-"}
        />
        <Info
          label="Ditutup"
          value={
            shift.closedAt
              ? `${formatDateTime(shift.closedAt)} — ${shift.closedBy?.name ?? "-"}`
              : "-"
          }
        />
        {shift.approvedAt && (
          <Info
            label="Disetujui"
            value={`${formatDateTime(shift.approvedAt)} — ${shift.approvedBy?.name ?? "-"}`}
          />
        )}
        {shift.closingNotes && (
          <div className="sm:col-span-3">
            <Info label="Catatan Kasir" value={shift.closingNotes} />
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-900">Mutasi Kas</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Waktu</th>
                <th className="px-4 py-2">Arah</th>
                <th className="px-4 py-2 text-right">Jumlah</th>
                <th className="px-4 py-2">Alasan</th>
                <th className="px-4 py-2">Oleh</th>
              </tr>
            </thead>
            <tbody>
              {shift.cashMovements.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    Belum ada mutasi kas.
                  </td>
                </tr>
              )}
              {shift.cashMovements.map((movement) => (
                <tr key={movement.id} className="border-b border-slate-100">
                  <td className="px-4 py-2 whitespace-nowrap">
                    {formatDateTime(movement.createdAt)}
                  </td>
                  <td className="px-4 py-2">{movement.direction === "IN" ? "Masuk" : "Keluar"}</td>
                  <td className="px-4 py-2 text-right">{formatRupiah(movement.amount.toString())}</td>
                  <td className="px-4 py-2">{movement.reason}</td>
                  <td className="px-4 py-2">{movement.createdBy.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Total transaksi POS pada shift ini: {shift._count.posTransactions}
        </p>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm text-slate-900">{value}</p>
    </div>
  );
}
