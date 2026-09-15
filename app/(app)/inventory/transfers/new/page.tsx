import { requirePermission } from "@/lib/rbac";
import { listActiveBranches } from "@/services/branch-service";
import { TransferForm } from "../transfer-form";

export default async function NewStockTransferPage() {
  const user = await requirePermission("transfer.manage");
  const branches = await listActiveBranches(user.companyId);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Buat Transfer Stok</h1>
        <p className="mt-1 text-sm text-slate-600">
          Dokumen tersimpan sebagai Draft — stok baru berubah setelah
          disetujui &amp; dikirim oleh cabang asal.
        </p>
      </div>

      <TransferForm branches={branches} />
    </div>
  );
}
