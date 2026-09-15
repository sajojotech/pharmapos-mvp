import { getActiveBranchContext, requirePermission } from "@/lib/rbac";
import { listActiveProductsWithPurchasableUnits } from "@/services/product-service";
import { prisma } from "@/lib/prisma";
import { ReceiptForm } from "../receipt-form";

export default async function NewPurchaseReceiptPage() {
  await requirePermission("purchase.manage");
  const context = await getActiveBranchContext();

  if (!context.activeBranchId || !context.activeBranch) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Anda belum memiliki cabang aktif, sehingga tidak dapat membuat
        penerimaan barang. Pilih cabang di header atau hubungi Admin Pusat.
      </div>
    );
  }

  const [suppliers, products] = await Promise.all([
    prisma.supplier.findMany({
      where: { companyId: context.companyId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    listActiveProductsWithPurchasableUnits(context.companyId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Buat Penerimaan Barang</h1>
        <p className="mt-1 text-sm text-slate-600">
          Dokumen tersimpan sebagai Draft — stok baru berubah setelah diposting.
        </p>
      </div>

      <ReceiptForm
        branchId={context.activeBranchId}
        branchLabel={`${context.activeBranch.code} — ${context.activeBranch.name}`}
        suppliers={suppliers}
        products={products}
      />
    </div>
  );
}
