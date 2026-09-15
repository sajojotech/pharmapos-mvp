"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import type { Branch } from "@prisma/client";
import { MasterTable } from "@/components/master/master-table";
import { MasterToolbar } from "@/components/master/master-toolbar";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { Modal } from "@/components/ui/modal";
import { createBranchAction, setBranchActiveAction, updateBranchAction } from "./actions";

export function BranchTable({
  branches,
  canManage,
}: {
  branches: Branch[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<Branch | "new" | null>(null);

  const columns: ColumnDef<Branch>[] = [
    { header: "Kode", accessorKey: "code" },
    { header: "Nama", accessorKey: "name" },
    { header: "Telepon", accessorKey: "phone" },
    {
      header: "Status",
      cell: ({ row }) => <StatusBadge isActive={row.original.isActive} />,
    },
    ...(canManage
      ? [
          {
            header: "Aksi",
            id: "actions",
            cell: ({ row }: { row: { original: Branch } }) => (
              <RowActions branch={row.original} onEdit={setEditing} />
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <MasterToolbar
        searchPlaceholder="Cari nama/kode cabang..."
        createSlot={
          canManage && (
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              + Tambah Cabang
            </button>
          )
        }
      />

      <MasterTable columns={columns} data={branches} emptyMessage="Belum ada cabang." />

      {editing && (
        <BranchFormDialog
          branch={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RowActions({ branch, onEdit }: { branch: Branch; onEdit: (b: Branch) => void }) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onEdit(branch)}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        Edit
      </button>
      <ConfirmActionButton
        label={branch.isActive ? "Nonaktifkan" : "Aktifkan"}
        confirmTitle={branch.isActive ? "Nonaktifkan cabang?" : "Aktifkan cabang?"}
        confirmDescription={`Cabang "${branch.name}" akan di${branch.isActive ? "nonaktifkan" : "aktifkan"}. Cabang nonaktif tidak akan muncul sebagai pilihan operasional.`}
        variant={branch.isActive ? "danger" : "default"}
        onConfirm={() => setBranchActiveAction(branch.id, !branch.isActive)}
      />
    </div>
  );
}

function BranchFormDialog({
  branch,
  onClose,
}: {
  branch: Branch | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState(branch?.code ?? "");
  const [name, setName] = useState(branch?.name ?? "");
  const [address, setAddress] = useState(branch?.address ?? "");
  const [phone, setPhone] = useState(branch?.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const payload = { code, name, address, phone };
    const result = branch
      ? await updateBranchAction(branch.id, payload)
      : await createBranchAction(payload);

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast.success("Cabang berhasil disimpan.");
    onClose();
    router.refresh();
  }

  return (
    <Modal title={branch ? "Edit Cabang" : "Tambah Cabang"} open onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Kode Cabang">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              disabled={isSubmitting}
              placeholder="mis. PUSAT"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
            />
          </Field>
          <Field label="Telepon">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              disabled={isSubmitting}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
            />
          </Field>
        </div>

        <Field label="Nama Cabang">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={isSubmitting}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
          />
        </Field>

        <Field label="Alamat">
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
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
