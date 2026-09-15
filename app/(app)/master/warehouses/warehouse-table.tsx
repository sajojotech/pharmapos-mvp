"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import type { Prisma } from "@prisma/client";
import { MasterTable } from "@/components/master/master-table";
import { MasterToolbar } from "@/components/master/master-toolbar";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { Modal } from "@/components/ui/modal";
import {
  createWarehouseAction,
  setWarehouseActiveAction,
  updateWarehouseAction,
} from "./actions";

type WarehouseRow = Prisma.WarehouseGetPayload<{
  include: { branch: { select: { code: true; name: true } } };
}>;

type BranchOption = { id: string; code: string; name: string };

export function WarehouseTable({
  warehouses,
  branchOptions,
  canManage,
}: {
  warehouses: WarehouseRow[];
  branchOptions: BranchOption[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<WarehouseRow | "new" | null>(null);

  const columns: ColumnDef<WarehouseRow>[] = [
    {
      header: "Cabang",
      cell: ({ row }) => `${row.original.branch.code} — ${row.original.branch.name}`,
    },
    { header: "Kode", accessorKey: "code" },
    { header: "Nama", accessorKey: "name" },
    {
      header: "Default",
      cell: ({ row }) => (row.original.isDefault ? "Ya" : "-"),
    },
    {
      header: "Status",
      cell: ({ row }) => <StatusBadge isActive={row.original.isActive} />,
    },
    ...(canManage
      ? [
          {
            header: "Aksi",
            id: "actions",
            cell: ({ row }: { row: { original: WarehouseRow } }) => (
              <RowActions warehouse={row.original} onEdit={setEditing} />
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <MasterToolbar
        searchPlaceholder="Cari nama/kode warehouse..."
        createSlot={
          canManage && (
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              + Tambah Warehouse
            </button>
          )
        }
      />

      <MasterTable columns={columns} data={warehouses} emptyMessage="Belum ada warehouse." />

      {editing && (
        <WarehouseFormDialog
          warehouse={editing === "new" ? null : editing}
          branchOptions={branchOptions}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RowActions({
  warehouse,
  onEdit,
}: {
  warehouse: WarehouseRow;
  onEdit: (w: WarehouseRow) => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onEdit(warehouse)}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        Edit
      </button>
      <ConfirmActionButton
        label={warehouse.isActive ? "Nonaktifkan" : "Aktifkan"}
        confirmTitle={warehouse.isActive ? "Nonaktifkan warehouse?" : "Aktifkan warehouse?"}
        confirmDescription={`Warehouse "${warehouse.name}" akan di${warehouse.isActive ? "nonaktifkan" : "aktifkan"}.`}
        variant={warehouse.isActive ? "danger" : "default"}
        onConfirm={() => setWarehouseActiveAction(warehouse.id, !warehouse.isActive)}
      />
    </div>
  );
}

function WarehouseFormDialog({
  warehouse,
  branchOptions,
  onClose,
}: {
  warehouse: WarehouseRow | null;
  branchOptions: BranchOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState(
    warehouse?.branchId ?? branchOptions[0]?.id ?? "",
  );
  const [code, setCode] = useState(warehouse?.code ?? "");
  const [name, setName] = useState(warehouse?.name ?? "");
  const [isDefault, setIsDefault] = useState(warehouse?.isDefault ?? false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const payload = { branchId, code, name, isDefault };
    const result = warehouse
      ? await updateWarehouseAction(warehouse.id, payload)
      : await createWarehouseAction(payload);

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast.success("Warehouse berhasil disimpan.");
    onClose();
    router.refresh();
  }

  return (
    <Modal title={warehouse ? "Edit Warehouse" : "Tambah Warehouse"} open onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Cabang">
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            required
            disabled={isSubmitting}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
          >
            {branchOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Kode Warehouse">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              disabled={isSubmitting}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
            />
          </Field>
          <Field label="Nama Warehouse">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={isSubmitting}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            disabled={isSubmitting}
          />
          Jadikan warehouse default untuk cabang ini
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
