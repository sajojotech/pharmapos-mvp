"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import type { Unit } from "@prisma/client";
import { MasterTable } from "@/components/master/master-table";
import { MasterToolbar } from "@/components/master/master-toolbar";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { Modal } from "@/components/ui/modal";
import { createUnitAction, setUnitActiveAction, updateUnitAction } from "./actions";

export function UnitTable({
  units,
  canManage,
}: {
  units: Unit[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<Unit | "new" | null>(null);

  const columns: ColumnDef<Unit>[] = [
    { header: "Nama", accessorKey: "name" },
    { header: "Simbol", accessorKey: "symbol", cell: ({ row }) => row.original.symbol || "-" },
    {
      header: "Status",
      cell: ({ row }) => <StatusBadge isActive={row.original.isActive} />,
    },
    ...(canManage
      ? [
          {
            header: "Aksi",
            id: "actions",
            cell: ({ row }: { row: { original: Unit } }) => (
              <RowActions unit={row.original} onEdit={setEditing} />
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <MasterToolbar
        searchPlaceholder="Cari nama satuan..."
        createSlot={
          canManage && (
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              + Tambah Satuan
            </button>
          )
        }
      />

      <MasterTable columns={columns} data={units} emptyMessage="Belum ada satuan." />

      {editing && (
        <UnitFormDialog unit={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function RowActions({ unit, onEdit }: { unit: Unit; onEdit: (u: Unit) => void }) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onEdit(unit)}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        Edit
      </button>
      <ConfirmActionButton
        label={unit.isActive ? "Nonaktifkan" : "Aktifkan"}
        confirmTitle={unit.isActive ? "Nonaktifkan satuan?" : "Aktifkan satuan?"}
        confirmDescription={`Satuan "${unit.name}" akan di${unit.isActive ? "nonaktifkan" : "aktifkan"}.`}
        variant={unit.isActive ? "danger" : "default"}
        onConfirm={() => setUnitActiveAction(unit.id, !unit.isActive)}
      />
    </div>
  );
}

function UnitFormDialog({ unit, onClose }: { unit: Unit | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(unit?.name ?? "");
  const [symbol, setSymbol] = useState(unit?.symbol ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const payload = { name, symbol: symbol || undefined };
    const result = unit
      ? await updateUnitAction(unit.id, payload)
      : await createUnitAction(payload);

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast.success("Satuan berhasil disimpan.");
    onClose();
    router.refresh();
  }

  return (
    <Modal title={unit ? "Edit Satuan" : "Tambah Satuan"} open onClose={onClose} widthClassName="max-w-sm">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="unit-name" className="text-sm font-medium text-slate-700">
            Nama Satuan
          </label>
          <input
            id="unit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={isSubmitting}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="unit-symbol" className="text-sm font-medium text-slate-700">
            Simbol (opsional)
          </label>
          <input
            id="unit-symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            disabled={isSubmitting}
            placeholder="mis. tab, box"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
          />
        </div>

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
