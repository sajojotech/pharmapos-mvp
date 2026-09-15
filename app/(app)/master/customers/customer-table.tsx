"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import type { Customer } from "@prisma/client";
import { MasterTable } from "@/components/master/master-table";
import { MasterToolbar } from "@/components/master/master-toolbar";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { Modal } from "@/components/ui/modal";
import {
  createCustomerAction,
  setCustomerActiveAction,
  updateCustomerAction,
} from "./actions";

export function CustomerTable({
  customers,
  canManage,
}: {
  customers: Customer[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<Customer | "new" | null>(null);

  const columns: ColumnDef<Customer>[] = [
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
            cell: ({ row }: { row: { original: Customer } }) => (
              <RowActions customer={row.original} onEdit={setEditing} />
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <MasterToolbar
        searchPlaceholder="Cari nama/kode/telepon customer..."
        createSlot={
          canManage && (
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              + Tambah Customer
            </button>
          )
        }
      />

      <MasterTable columns={columns} data={customers} emptyMessage="Belum ada customer." />

      {editing && (
        <CustomerFormDialog
          customer={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RowActions({
  customer,
  onEdit,
}: {
  customer: Customer;
  onEdit: (c: Customer) => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onEdit(customer)}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        Edit
      </button>
      <ConfirmActionButton
        label={customer.isActive ? "Nonaktifkan" : "Aktifkan"}
        confirmTitle={customer.isActive ? "Nonaktifkan customer?" : "Aktifkan customer?"}
        confirmDescription={`Customer "${customer.name}" akan di${customer.isActive ? "nonaktifkan" : "aktifkan"}.`}
        variant={customer.isActive ? "danger" : "default"}
        onConfirm={() => setCustomerActiveAction(customer.id, !customer.isActive)}
      />
    </div>
  );
}

function CustomerFormDialog({
  customer,
  onClose,
}: {
  customer: Customer | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState(customer?.code ?? "");
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [address, setAddress] = useState(customer?.address ?? "");
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
    const result = customer
      ? await updateCustomerAction(customer.id, payload)
      : await createCustomerAction(payload);

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast.success("Customer berhasil disimpan.");
    onClose();
    router.refresh();
  }

  return (
    <Modal
      title={customer ? "Edit Customer" : "Tambah Customer"}
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

        <Field label="Nama Customer">
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
