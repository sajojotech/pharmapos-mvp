import { getActiveBranchContext, requireAuth } from "@/lib/rbac";
import { listSelectableBranches } from "@/services/branch-service";
import { Sidebar } from "@/components/app-shell/sidebar";
import { Header } from "@/components/app-shell/header";

/**
 * Layout ini membungkus seluruh halaman operasional (dashboard, master data,
 * inventory, pos, dst). requireAuth() dijalankan di server pada SETIAP
 * request ke halaman-halaman ini — bukan pengecekan client-side — sehingga
 * memenuhi syarat "semua halaman contoh memerlukan login" & "RBAC dan
 * branch access diverifikasi di server-side".
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuth();
  const branchContext = await getActiveBranchContext();
  const selectableBranches = await listSelectableBranches({
    companyId: user.companyId,
    role: user.role,
    assignedBranchIds: user.assignedBranchIds,
  });

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar user={user} />
      <div className="flex flex-1 flex-col">
        <Header
          user={user}
          activeBranchId={branchContext.activeBranchId}
          selectableBranches={selectableBranches}
        />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
