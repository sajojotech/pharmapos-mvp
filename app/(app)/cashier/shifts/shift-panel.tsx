"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatRupiah } from "@/lib/format";
import { cashMovementAction, closeShiftAction, openShiftAction } from "./actions";

type OpenShift = {
  id: string;
  branchId: string;
  openingCash: string;
  openedAt: string;
  branch: { id: string; code: string; name: string };
} | null;

const inputClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60";

export function ShiftPanel({
  branchId,
  branchLabel,
  openShift,
}: {
  branchId: string;
  branchLabel: string;
  openShift: OpenShift;
}) {
  const router = useRouter();

  if (!openShift) {
    return <OpenShiftForm branchId={branchId} branchLabel={branchLabel} />;
  }

  if (openShift.branchId !== branchId) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Anda memiliki shift OPEN di cabang{" "}
        <span className="font-semibold">
          {openShift.branch.code} — {openShift.branch.name}
        </span>
        , bukan di cabang aktif saat ini ({branchLabel}). Tutup shift tersebut
        terlebih dahulu, atau pindah ke cabang tsb lewat header.
      </div>
    );
  }

  return (
    <ActiveShiftPanel
      shift={openShift}
      onChanged={() => router.refresh()}
    />
  );
}

function OpenShiftForm({ branchId, branchLabel }: { branchId: string; branchLabel: string }) {
  const router = useRouter();
  const [openingCash, setOpeningCash] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const result = await openShiftAction({
      branchId,
      openingCash: Number(openingCash) || 0,
    });

    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success("Shift berhasil dibuka.");
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="text-sm font-semibold text-slate-900">Buka Shift — {branchLabel}</h2>
      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <label className="text-sm font-medium text-slate-700">Modal Kas Awal (Rp)</label>
        <input
          type="number"
          min={0}
          step="1"
          required
          value={openingCash}
          onChange={(e) => setOpeningCash(e.target.value)}
          disabled={isSubmitting}
          className={inputClass}
        />
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {isSubmitting ? "Membuka..." : "Buka Shift"}
        </button>
      </div>
    </form>
  );
}

function ActiveShiftPanel({
  shift,
  onChanged,
}: {
  shift: NonNullable<OpenShift>;
  onChanged: () => void;
}) {
  const [movementDirection, setMovementDirection] = useState<"IN" | "OUT">("IN");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [isSubmittingMovement, setIsSubmittingMovement] = useState(false);
  const [movementError, setMovementError] = useState<string | null>(null);

  const [showCloseForm, setShowCloseForm] = useState(false);
  const [actualCash, setActualCash] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  async function handleCashMovement(event: React.FormEvent) {
    event.preventDefault();
    setMovementError(null);
    setIsSubmittingMovement(true);

    const result = await cashMovementAction({
      shiftId: shift.id,
      direction: movementDirection,
      amount: Number(movementAmount) || 0,
      reason: movementReason,
    });

    setIsSubmittingMovement(false);
    if (!result.success) {
      setMovementError(result.error);
      return;
    }
    toast.success(movementDirection === "IN" ? "Kas masuk dicatat." : "Kas keluar dicatat.");
    setMovementAmount("");
    setMovementReason("");
    onChanged();
  }

  async function handleClose(event: React.FormEvent) {
    event.preventDefault();
    setCloseError(null);
    setIsClosing(true);

    const result = await closeShiftAction({
      shiftId: shift.id,
      actualCash: Number(actualCash) || 0,
      closingNotes: closingNotes || undefined,
    });

    setIsClosing(false);
    if (!result.success) {
      setCloseError(result.error);
      return;
    }
    toast.success(
      result.data.status === "CLOSED"
        ? "Shift berhasil ditutup."
        : "Shift ditutup, tapi selisih kas melebihi batas — menunggu persetujuan Manager/Owner.",
    );
    onChanged();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm text-emerald-800">
          Shift sedang <span className="font-semibold">OPEN</span> — modal awal{" "}
          <span className="font-semibold">{formatRupiah(shift.openingCash)}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form
          onSubmit={handleCashMovement}
          className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4"
        >
          <h3 className="text-sm font-semibold text-slate-900">Kas Masuk / Keluar</h3>
          <div className="flex gap-2">
            <select
              value={movementDirection}
              onChange={(e) => setMovementDirection(e.target.value as "IN" | "OUT")}
              disabled={isSubmittingMovement}
              className={inputClass}
            >
              <option value="IN">Kas Masuk</option>
              <option value="OUT">Kas Keluar</option>
            </select>
            <input
              type="number"
              min={0}
              step="1"
              placeholder="Jumlah (Rp)"
              value={movementAmount}
              onChange={(e) => setMovementAmount(e.target.value)}
              disabled={isSubmittingMovement}
              className={`${inputClass} flex-1`}
            />
          </div>
          <input
            placeholder="Alasan"
            value={movementReason}
            onChange={(e) => setMovementReason(e.target.value)}
            disabled={isSubmittingMovement}
            className={inputClass}
          />
          {movementError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {movementError}
            </p>
          )}
          <div>
            <button
              type="submit"
              disabled={isSubmittingMovement}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {isSubmittingMovement ? "Menyimpan..." : "Catat Mutasi Kas"}
            </button>
          </div>
        </form>

        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Tutup Shift</h3>
          {!showCloseForm ? (
            <button
              type="button"
              onClick={() => setShowCloseForm(true)}
              className="self-start rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
            >
              Tutup Shift
            </button>
          ) : (
            <form onSubmit={handleClose} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700">Kas Aktual (Rp)</label>
                <input
                  type="number"
                  min={0}
                  step="1"
                  required
                  value={actualCash}
                  onChange={(e) => setActualCash(e.target.value)}
                  disabled={isClosing}
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-700">Catatan (opsional)</label>
                <textarea
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                  rows={2}
                  disabled={isClosing}
                  className={inputClass}
                />
              </div>
              {closeError && (
                <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {closeError}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowCloseForm(false)}
                  disabled={isClosing}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isClosing}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {isClosing ? "Menutup..." : "Konfirmasi Tutup Shift"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
