"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  approveTransferAction,
  cancelTransferAction,
  rejectTransferAction,
  shipTransferAction,
  submitTransferAction,
} from "../actions";

type Action = "submit" | "approve" | "reject" | "ship" | "cancel";

export function TransferActions({
  id,
  status,
  isSourceUser,
  isDestinationUser,
}: {
  id: string;
  status: string;
  isSourceUser: boolean;
  isDestinationUser: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  function run(action: Action, promise: Promise<{ success: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await promise;
      if (!result.success) {
        toast.error(result.error ?? "Terjadi kesalahan.");
        return;
      }
      const messages: Record<Action, string> = {
        submit: "Transfer diajukan ke cabang asal.",
        approve: "Transfer disetujui.",
        reject: "Transfer ditolak.",
        ship: "Transfer dikirim — stok cabang asal berkurang.",
        cancel: "Transfer dibatalkan.",
      };
      toast.success(messages[action]);
      setConfirming(null);
      router.refresh();
    });
  }

  const canEditOrCancelPreShip =
    (isSourceUser || isDestinationUser) && ["DRAFT", "REQUESTED", "APPROVED"].includes(status);

  const buttons: React.ReactNode[] = [];

  if (status === "DRAFT" && (isSourceUser || isDestinationUser)) {
    buttons.push(
      <Link
        key="edit"
        href={`/inventory/transfers/${id}/edit`}
        className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
      >
        Edit
      </Link>,
    );
    buttons.push(
      <button
        key="submit"
        type="button"
        onClick={() => run("submit", submitTransferAction(id))}
        disabled={isPending}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        Ajukan ke Cabang Asal
      </button>,
    );
  }

  if (status === "REQUESTED" && isSourceUser) {
    buttons.push(
      <button
        key="approve"
        type="button"
        onClick={() => run("approve", approveTransferAction(id))}
        disabled={isPending}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        Setujui
      </button>,
    );
    buttons.push(
      <button
        key="reject"
        type="button"
        onClick={() => setConfirming("reject")}
        disabled={isPending}
        className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
      >
        Tolak
      </button>,
    );
  }

  if (status === "APPROVED" && isSourceUser) {
    buttons.push(
      <button
        key="ship"
        type="button"
        onClick={() => setConfirming("ship")}
        disabled={isPending}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        Kirim
      </button>,
    );
  }

  if (canEditOrCancelPreShip) {
    buttons.push(
      <button
        key="cancel"
        type="button"
        onClick={() => setConfirming("cancel")}
        disabled={isPending}
        className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
      >
        Batalkan
      </button>,
    );
  }

  if (status === "SHIPPED") {
    buttons.push(
      <p key="no-cancel" className="text-xs text-slate-500">
        Sudah dikirim — stok telah berpindah fisik dari cabang asal.
        Pembatalan tidak tersedia (butuh alur retur/reversal yang belum
        dibangun fase ini).
      </p>,
    );
  }

  if (confirming === "reject") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 sm:w-96">
        <label className="text-sm text-red-800">Alasan penolakan</label>
        <textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          rows={2}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          disabled={isPending}
        />
        <div className="flex justify-end gap-2">
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
            onClick={() => run("reject", rejectTransferAction(id, rejectReason))}
            disabled={isPending || !rejectReason.trim()}
            className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {isPending ? "Memproses..." : "Ya, Tolak"}
          </button>
        </div>
      </div>
    );
  }

  if (confirming === "ship") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
        <p className="text-sm text-amber-800">
          Yakin kirim? Stok cabang asal akan berkurang sekarang.
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
          onClick={() => run("ship", shipTransferAction(id))}
          disabled={isPending}
          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {isPending ? "Memproses..." : "Ya, Kirim"}
        </button>
      </div>
    );
  }

  if (confirming === "cancel") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
        <p className="text-sm text-amber-800">Yakin batalkan transfer ini?</p>
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
          onClick={() => run("cancel", cancelTransferAction(id))}
          disabled={isPending}
          className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
        >
          {isPending ? "Memproses..." : "Ya, Batalkan"}
        </button>
      </div>
    );
  }

  if (buttons.length === 0) return null;

  return <div className="flex flex-wrap items-center gap-2">{buttons}</div>;
}
