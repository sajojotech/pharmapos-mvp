"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { approveShiftAction } from "../actions";

export function ApproveShiftButton({ shiftId }: { shiftId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleApprove() {
    startTransition(async () => {
      const result = await approveShiftAction(shiftId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Shift disetujui dan ditutup.");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleApprove}
      disabled={isPending}
      className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
    >
      {isPending ? "Memproses..." : "Setujui & Tutup Shift"}
    </button>
  );
}
