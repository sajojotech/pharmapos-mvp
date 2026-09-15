"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Prisma } from "@prisma/client";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { Modal } from "@/components/ui/modal";
import { formatRupiah, formatDate } from "@/lib/format";
import {
  createProductBranchPriceAction,
  setProductBranchPriceActiveAction,
  updateProductBranchPriceAction,
} from "../actions";

type BranchPriceRow = Prisma.ProductBranchPriceGetPayload<{
  include: { branch: { select: { id: true; code: true; name: true } } };
}>;

type BranchOption = { id: string; code: string; name: string };

export function BranchPriceSection({
  productId,
  branchPrices,
  branchOptions,
  canManage,
}: {
  productId: string;
  branchPrices: BranchPriceRow[];
  branchOptions: BranchOption[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<BranchPriceRow | "new" | null>(null);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Harga Override per Cabang
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Cabang tanpa override memakai Harga Jual Default di atas.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            + Tambah Harga Cabang
          </button>
        )}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2 pr-4">Cabang</th>
              <th className="py-2 pr-4">Harga</th>
              <th className="py-2 pr-4">Tanggal Efektif</th>
              <th className="py-2 pr-4">Status</th>
              {canManage && <th className="py-2 pr-4">Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {branchPrices.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-slate-400">
                  Belum ada harga override.
                </td>
              </tr>
            )}
            {branchPrices.map((bp) => (
              <tr key={bp.id} className="border-b border-slate-100">
                <td className="py-2 pr-4">
                  {bp.branch.code} — {bp.branch.name}
                </td>
                <td className="py-2 pr-4">{formatRupiah(bp.price.toString())}</td>
                <td className="py-2 pr-4">
                  {bp.effectiveDate ? formatDate(bp.effectiveDate) : "-"}
                </td>
                <td className="py-2 pr-4">
                  <StatusBadge isActive={bp.isActive} />
                </td>
                {canManage && (
                  <td className="py-2 pr-4">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(bp)}
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <ConfirmActionButton
                        label={bp.isActive ? "Nonaktifkan" : "Aktifkan"}
                        confirmTitle={
                          bp.isActive ? "Nonaktifkan harga ini?" : "Aktifkan harga ini?"
                        }
                        confirmDescription={`Harga override untuk cabang "${bp.branch.name}" akan di${bp.isActive ? "nonaktifkan" : "aktifkan"}.`}
                        variant={bp.isActive ? "danger" : "default"}
                        onConfirm={() =>
                          setProductBranchPriceActiveAction(
                            bp.id,
                            productId,
                            !bp.isActive,
                          )
                        }
                      />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <BranchPriceFormDialog
          productId={productId}
          branchPrice={editing === "new" ? null : editing}
          branchOptions={branchOptions}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function BranchPriceFormDialog({
  productId,
  branchPrice,
  branchOptions,
  onClose,
}: {
  productId: string;
  branchPrice: BranchPriceRow | null;
  branchOptions: BranchOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState(
    branchPrice?.branchId ?? branchOptions[0]?.id ?? "",
  );
  const [price, setPrice] = useState(
    branchPrice ? branchPrice.price.toString() : "",
  );
  const [effectiveDate, setEffectiveDate] = useState(
    branchPrice?.effectiveDate
      ? new Date(branchPrice.effectiveDate).toISOString().slice(0, 10)
      : "",
  );
  const [isActive, setIsActive] = useState(branchPrice?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const payload = {
      branchId,
      price: Number(price),
      effectiveDate: effectiveDate || undefined,
      isActive,
    };

    const result = branchPrice
      ? await updateProductBranchPriceAction(branchPrice.id, productId, payload)
      : await createProductBranchPriceAction(productId, payload);

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast.success("Harga cabang berhasil disimpan.");
    onClose();
    router.refresh();
  }

  return (
    <Modal
      title={branchPrice ? "Edit Harga Cabang" : "Tambah Harga Cabang"}
      open
      onClose={onClose}
      widthClassName="max-w-sm"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Cabang">
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            disabled={isSubmitting || !!branchPrice}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
          >
            {branchOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Harga Jual (Rp)">
          <input
            type="number"
            min={0}
            step="1"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
            disabled={isSubmitting}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
          />
        </Field>

        <Field label="Tanggal Efektif (opsional)">
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            disabled={isSubmitting}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            disabled={isSubmitting}
          />
          Aktif
        </label>

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {isSubmitting ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}
