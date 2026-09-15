"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setActiveBranchAction } from "@/lib/actions/active-branch-actions";

type BranchOption = { id: string; code: string; name: string };

export function BranchSelector({
  branches,
  activeBranchId,
}: {
  branches: BranchOption[];
  activeBranchId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const branchId = event.target.value;
    setError(null);
    startTransition(async () => {
      const result = await setActiveBranchAction(branchId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        value={activeBranchId ?? ""}
        onChange={handleChange}
        disabled={isPending}
        aria-label="Pilih cabang aktif"
        className="rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
      >
        {!activeBranchId && <option value="">Pilih cabang</option>}
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.code} — {branch.name}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
