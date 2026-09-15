"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import type { Supplier } from "@prisma/client";
import { MasterTable } from "@/components/master/master-table";
import { MasterToolbar } from "@/components/master/master-toolbar";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { Modal } from "@/components/ui/modal";
import {
  createSupplierAction,
  setSupplierActiveAction,
  updateSupplierAction,
} from "./actions";

export function SupplierTable({
  suppliers,
  canManage,
}: {
  suppliers: Supplier[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);

  const columns: ColumnDef<Supplier>[] = [
    { header: "Kode", accessorKey: "code", cell: ({ row }) => row.original.code || "-" },
    { header: "Nama", accessorKey: "name" },
    { header: "Telepon", accessorKey: "phone", cell: ({ row }) => row.original.phone || "-" },
    {
      header: "Status",
      cell: ({ row }) => <StatusBadge isActive={row.original.isActive} />,
    },
    ...(canManage
      ? [
          {
            header: "Aksi",
            id: "actions",
            cell: ({ row }: { row: { original: Supplier } }) => (
              <RowActions supplier={row.original} onEdit={setEditing} />
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <MasterToolbar
        searchPlaceholder="Cari nama/kode supplier..."
        createSlot={
          canManage && (
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              + Tambah Supplier
            </button>
          )
        }
      />

      <MasterTable columns={columns} data={suppliers} emptyMessage="Belum ada supplier." />

      {editing && (
        <SupplierFormDialog
          supplier={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RowActions({
  supplier,
  onEdit,
}: {
  supplier: Supplier;
  onEdit: (s: Supplier) => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onEdit(supplier)}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        Edit
      </button>
      <ConfirmActionButton
        label={supplier.isActive ? "Nonaktifkan" : "Aktifkan"}
        confirmTitle={supplier.isActive ? "Nonaktifkan supplier?" : "Aktifkan supplier?"}
        confirmDescription={`Supplier "${supplier.name}" akan di${supplier.isActive ? "nonaktifkan" : "aktifkan"}.`}
        variant={supplier.isActive ? "danger" : "default"}
        onConfirm={() => setSupplierActiveAction(supplier.id, !supplier.isActive)}
      />
    </div>
  );
}

function SupplierFormDialog({
  supplier,
  onClose,
}: {
  supplier: Supplier | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState(supplier?.code ?? "");
  const [name, setName] = useState(supplier?.name ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const payload = {
      code: code || undefined,
      name,
      phone: phone || undefined,
      address: address || undefined,
    };
    const result = supplier
      ? await updateSupplierAction(supplier.id, payload)
      : await createSupplierAction(payload);

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast.success("Supplier berhasil disimpan.");
    onClose();
    router.refresh();
  }

  return (
    <Modal
      title={supplier ? "Edit Supplier" : "Tambah Supplier"}
      open
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Kode (opsional)">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={isSubmitting}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
            />
          </Field>
          <Field label="Telepon (opsional)">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={isSubmitting}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
            />
          </Field>
        </div>

        <Field label="Nama Supplier">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={isSubmitting}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
          />
        </Field>

        <Field label="Alamat (opsional)">
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={isSubmitting}
            rows={2}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
          />
        </Field>

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
