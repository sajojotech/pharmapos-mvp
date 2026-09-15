import Link from "next/link";
import { getActiveBranchContext, requireBranchAccess, requirePermission } from "@/lib/rbac";
import { getOpenShiftForUser } from "@/services/cashier-shift-service";
import { listActiveCustomers } from "@/services/customer-service";
import { toPlainJSON } from "@/lib/serialize";
import { PosTerminal } from "./pos-terminal";

export default async function PosPage() {
  const user = await requirePermission("pos.sell");
  const context = await getActiveBranchContext();

  if (!context.activeBranchId || !context.activeBranch) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Anda belum ditugaskan ke cabang mana pun, sehingga kasir (POS) tidak
        dapat dibuka. Hubungi Admin Pusat untuk penugasan cabang.
      </div>
    );
  }

  const { branch } = await requireBranchAccess(context.activeBranchId);
  const openShift = await getOpenShiftForUser(user.id);

  if (!openShift || openShift.branchId !== branch.id) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Anda belum membuka shift kasir di cabang {branch.code} — {branch.name}.{" "}
        <Link href="/cashier/shifts" className="font-semibold underline">
          Buka shift di sini
        </Link>{" "}
        sebelum dapat melakukan transaksi.
      </div>
    );
  }

  const customers = await listActiveCustomers(user.companyId);

  return (
    <PosTerminal
      branchId={branch.id}
      branchLabel={`${branch.code} — ${branch.name}`}
      shiftId={openShift.id}
      customers={toPlainJSON(customers)}
    />
  );
}
