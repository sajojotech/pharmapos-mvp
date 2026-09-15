"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { cancelReceiptAction, postReceiptAction } from "../actions";

export function ReceiptActions({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<"post" | "cancel" | null>(null);

  function handlePost() {
    startTransition(async () => {
      const result = await postReceiptAction(id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Purchase receipt berhasil diposting — stok bertambah.");
      router.refresh();
    });
  }

  function handleCancel() {
    startTransition(async () => {
      const result = await cancelReceiptAction(id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Draft berhasil dibatalkan.");
      router.refresh();
    });
  }

  if (confirming) {
    const isPost = confirming === "post";
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
        <p className="text-sm text-amber-800">
          {isPost
            ? "Yakin posting? Stok akan bertambah dan dokumen tidak bisa diedit lagi."
            : "Yakin batalkan draft ini?"}
        </p>
        <button
          type="button"
          onClick={() => setConfirming(null)}
          disabled={isPending}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Batal
        </button>
        <button
          type="button"
          onClick={isPost ? handlePost : handleCancel}
          disabled={isPending}
          className={
            isPost
              ? "rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              : "rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
          }
        >
          {isPending ? "Memproses..." : isPost ? "Ya, Post" : "Ya, Batalkan"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Link
        href={`/purchases/receipts/${id}/edit`}
        className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
      >
        Edit
      </Link>
      <button
        type="button"
        onClick={() => setConfirming("cancel")}
        className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
      >
        Batalkan Draft
      </button>
      <button
        type="button"
        onClick={() => setConfirming("post")}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
      >
        Post Dokumen
      </button>
    </div>
  );
}
