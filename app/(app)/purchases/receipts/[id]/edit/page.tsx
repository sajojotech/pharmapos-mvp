import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getReceiptById } from "@/services/purchase-receipt-service";
import { listActiveProductsWithPurchasableUnits } from "@/services/product-service";
import { prisma } from "@/lib/prisma";
import { ReceiptForm } from "../../receipt-form";

export default async function EditPurchaseReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("purchase.manage");
  const { id } = await params;
  const allowedBranchIds = await getAllowedBranchIds(user);

  const receipt = await getReceiptById(allowedBranchIds, id);
  if (!receipt) notFound();

  if (receipt.status !== "DRAFT") {
    redirect(`/purchases/receipts/${id}`);
  }

  const [suppliers, products] = await Promise.all([
    prisma.supplier.findMany({
      where: { companyId: user.companyId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    listActiveProductsWithPurchasableUnits(user.companyId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Edit Penerimaan {receipt.documentNumber}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Cabang: {receipt.branch.code} — {receipt.branch.name}
        </p>
      </div>

      <ReceiptForm
        branchId={receipt.branchId}
        branchLabel={`${receipt.branch.code} — ${receipt.branch.name}`}
        suppliers={suppliers}
        products={products}
        existingReceipt={{
          id: receipt.id,
          branchId: receipt.branchId,
          supplierId: receipt.supplierId,
          supplierInvoiceNumber: receipt.supplierInvoiceNumber,
          supplierInvoiceDate: receipt.supplierInvoiceDate.toISOString(),
          receivedDate: receipt.receivedDate.toISOString(),
          notes: receipt.notes,
          items: receipt.items.map((item) => ({
            productId: item.productId,
            unitId: item.unitId,
            qty: item.qty.toString(),
            unitCost: item.unitCost.toString(),
            discountAmount: item.discountAmount.toString(),
            batchNumber: item.batchNumber,
            expiryDate: item.expiryDate ? item.expiryDate.toISOString() : null,
            notes: item.notes,
          })),
        }}
      />
    </div>
  );
}
