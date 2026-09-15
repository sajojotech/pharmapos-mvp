import { getActiveBranchContext, requirePermission } from "@/lib/rbac";
import { listAvailableBatchesForBranch } from "@/services/stock-batch-service";
import { toPlainJSON } from "@/lib/serialize";
import { OpnameForm, type BatchOption } from "./opname-form";

export default async function NewOpnamePage() {
  await requirePermission("inventory.adjust");
  const context = await getActiveBranchContext();

  if (!context.activeBranchId || !context.activeBranch) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Anda belum memiliki cabang aktif, sehingga tidak dapat membuat stock
        opname. Pilih cabang di header atau hubungi Admin Pusat.
      </div>
    );
  }

  const batches = await listAvailableBatchesForBranch(context.companyId, context.activeBranchId);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Buat Stock Opname</h1>
        <p className="mt-1 text-sm text-slate-600">
          Saldo sistem akan di-snapshot saat dokumen ini dibuat. Selisih
          terhadap hasil hitung fisik akan diterapkan otomatis saat
          diposting.
        </p>
      </div>

      <OpnameForm
        branchId={context.activeBranchId}
        branchLabel={`${context.activeBranch.code} — ${context.activeBranch.name}`}
        batches={toPlainJSON<BatchOption[]>(batches)}
      />
    </div>
  );
}
