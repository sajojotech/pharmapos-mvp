import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds } from "@/services/branch-service";
import { getReturnableSummary } from "@/services/sales-return-service";
import { toPlainJSON } from "@/lib/serialize";
import { ReturnForm, type ReturnableItem } from "./return-form";

export default async function SalesReturnPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("pos.sell");
  const { id } = await params;
  const allowedBranchIds = await getAllowedBranchIds(user);

  const summary = await getReturnableSummary(allowedBranchIds, id);
  if (!summary) notFound();

  const canReturn = ["PAID", "PARTIALLY_RETURNED"].includes(summary.transaction.status);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Retur Invoice {summary.transaction.documentNumber}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {summary.transaction.branch.code} — {summary.transaction.branch.name}
        </p>
      </div>

      {!canReturn ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Transaksi berstatus {summary.transaction.status}, tidak dapat diretur.
        </div>
      ) : (
        <ReturnForm
          transactionId={id}
          items={toPlainJSON<ReturnableItem[]>(summary.items)}
        />
      )}
    </div>
  );
}
