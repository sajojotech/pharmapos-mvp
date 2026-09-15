"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { postOpnameAction } from "../actions";

export function PostOpnameButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function handlePost() {
    startTransition(async () => {
      const result = await postOpnameAction(id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Stock opname berhasil diposting.");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
      >
        Post Dokumen
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
      <p className="text-sm text-amber-800">
        Yakin posting? Selisih akan diterapkan ke stok dan dokumen tidak
        bisa diedit lagi.
      </p>
      <button
        type="button"
        onClick={() => setOpen(false)}
        disabled={isPending}
        className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        Batal
      </button>
      <button
        type="button"
        onClick={handlePost}
        disabled={isPending}
        className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {isPending ? "Memproses..." : "Ya, Post"}
      </button>
    </div>
  );
}
