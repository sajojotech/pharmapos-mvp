"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDecimalQty } from "@/lib/format";
import { createSalesReturnAction } from "../../actions";

export type ReturnableItem = {
  itemId: string;
  productSku: string;
  productName: string;
  qty: string;
  totalReturnable: string;
  allocations: {
    allocationId: string;
    batchNumberSnapshot: string;
    qtyOut: string;
    alreadyReturned: string;
    returnable: string;
  }[];
};

type Condition = "SELLABLE" | "DAMAGED" | "QUARANTINE";

const CONDITION_LABELS: Record<Condition, string> = {
  SELLABLE: "Bisa Dijual Lagi",
  DAMAGED: "Rusak",
  QUARANTINE: "Karantina (perlu verifikasi)",
};

const inputClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60";

export function ReturnForm({
  transactionId,
  items,
}: {
  transactionId: string;
  items: ReturnableItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, { qty: string; condition: Condition }>>(
    Object.fromEntries(items.map((item) => [item.itemId, { qty: "", condition: "SELLABLE" as Condition }])),
  );

  function updateRow(itemId: string, patch: Partial<{ qty: string; condition: Condition }>) {
    setRows((prev) => ({ ...prev, [itemId]: { ...prev[itemId]!, ...patch } }));
  }

  function submit() {
    setError(null);
    if (!reason.trim()) {
      setError("Alasan retur wajib diisi.");
      return;
    }

    const selected = items
      .map((item) => ({ item, row: rows[item.itemId]! }))
      .filter(({ row }) => Number(row.qty) > 0);

    if (selected.length === 0) {
      setError("Isi minimal satu qty retur.");
      return;
    }

    for (const { item, row } of selected) {
      if (Number(row.qty) > Number(item.totalReturnable)) {
        setError(
          `Qty retur "${item.productName}" (${row.qty}) melebihi sisa returnable (${formatDecimalQty(item.totalReturnable)}).`,
        );
        return;
      }
    }

    startTransition(async () => {
      const result = await createSalesReturnAction(transactionId, {
        reason,
        items: selected.map(({ item, row }) => ({
          posTransactionItemId: item.itemId,
          qty: Number(row.qty),
          condition: row.condition,
        })),
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      toast.success("Retur berhasil diproses.");
      router.push(`/pos/transactions/${transactionId}`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Produk</th>
              <th className="px-4 py-2 text-right">Sisa Returnable</th>
              <th className="px-4 py-2 text-right">Qty Retur</th>
              <th className="px-4 py-2">Kondisi</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.itemId} className="border-b border-slate-100">
                <td className="px-4 py-2">
                  <p className="font-medium text-slate-900">{item.productName}</p>
                  <p className="text-xs text-slate-500">{item.productSku}</p>
                </td>
                <td className="px-4 py-2 text-right">
                  {formatDecimalQty(item.totalReturnable)}
                </td>
                <td className="px-4 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    max={Number(item.totalReturnable)}
                    step="0.001"
                    value={rows[item.itemId]?.qty ?? ""}
                    onChange={(e) => updateRow(item.itemId, { qty: e.target.value })}
                    disabled={isPending || Number(item.totalReturnable) <= 0}
                    className={`${inputClass} w-24 text-right`}
                  />
                </td>
                <td className="px-4 py-2">
                  <select
                    value={rows[item.itemId]?.condition ?? "SELLABLE"}
                    onChange={(e) => updateRow(item.itemId, { condition: e.target.value as Condition })}
                    disabled={isPending || Number(item.totalReturnable) <= 0}
                    className={inputClass}
                  >
                    {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="text-sm font-medium text-slate-700">Alasan Retur (wajib)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className={`${inputClass} mt-1.5 w-full`}
          disabled={isPending}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className="self-start rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {isPending ? "Memproses..." : "Proses Retur"}
      </button>
    </div>
  );
}
