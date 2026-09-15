import { LogOut } from "lucide-react";
import { Role } from "@prisma/client";
import type { SessionUser } from "@/lib/rbac";
import { logoutAction } from "@/lib/actions/auth-actions";
import { BranchSelector } from "./branch-selector";

const ROLE_LABELS: Record<Role, string> = {
  [Role.OWNER]: "Owner",
  [Role.CENTRAL_ADMIN]: "Admin Pusat",
  [Role.BRANCH_MANAGER]: "Manager Cabang",
  [Role.PHARMACIST]: "Apoteker",
  [Role.CASHIER]: "Kasir",
  [Role.WAREHOUSE_STAFF]: "Staff Gudang",
  [Role.FINANCE_AUDITOR]: "Finance Auditor",
};

type BranchOption = { id: string; code: string; name: string };

export function Header({
  user,
  activeBranchId,
  selectableBranches,
}: {
  user: SessionUser;
  activeBranchId: string | null;
  selectableBranches: BranchOption[];
}) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 print:hidden">
      <div>
        <p className="text-sm font-semibold text-slate-900">{user.name}</p>
        <p className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
      </div>

      <div className="flex items-center gap-4">
        {selectableBranches.length > 1 && (
          <BranchSelector
            branches={selectableBranches}
            activeBranchId={activeBranchId}
          />
        )}

        <form action={logoutAction}>
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Keluar
          </button>
        </form>
      </div>
    </header>
  );
}
