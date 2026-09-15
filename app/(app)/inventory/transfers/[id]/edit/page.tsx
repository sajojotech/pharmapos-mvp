import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { listActiveBranches } from "@/services/branch-service";
import { getTransferById } from "@/services/stock-transfer-service";
import { TransferForm } from "../../transfer-form";

export default async function EditStockTransferPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("transfer.manage");
  const { id } = await params;
  const allowedBranchIds = await getAllowedBranchIds(user);

  const transfer = await getTransferById(allowedBranchIds, id);
  if (!transfer) notFound();

  if (transfer.status !== "DRAFT") {
    redirect(`/inventory/transfers/${id}`);
  }

  const branches = await listActiveBranches(user.companyId);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Edit Transfer {transfer.documentNumber}
        </h1>
      </div>

      <TransferForm
        branches={branches}
        existingTransfer={{
          id: transfer.id,
          sourceBranchId: transfer.sourceBranchId,
          destinationBranchId: transfer.destinationBranchId,
          notes: transfer.notes,
          items: transfer.items.map((item) => ({
            productId: item.productId,
            sourceStockBatchId: item.sourceStockBatchId,
            qtyRequested: item.qtyRequested.toString(),
            notes: item.notes,
          })),
        }}
      />
    </div>
  );
}
