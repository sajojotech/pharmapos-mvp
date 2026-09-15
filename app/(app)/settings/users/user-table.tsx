"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Role } from "@prisma/client";
import type { ColumnDef } from "@tanstack/react-table";
import { MasterTable } from "@/components/master/master-table";
import { MasterToolbar } from "@/components/master/master-toolbar";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { Modal } from "@/components/ui/modal";
import { isGlobalBranchRole } from "@/lib/permissions";
import { createUserAction, setUserActiveAction, updateUserAction } from "./actions";

const ROLE_LABELS: Record<Role, string> = {
  [Role.OWNER]: "Owner",
  [Role.CENTRAL_ADMIN]: "Admin Pusat",
  [Role.BRANCH_MANAGER]: "Manager Cabang",
  [Role.PHARMACIST]: "Apoteker",
  [Role.CASHIER]: "Kasir",
  [Role.WAREHOUSE_STAFF]: "Staff Gudang",
  [Role.FINANCE_AUDITOR]: "Finance Auditor",
};

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  branchAssignments: { branch: { id: string; code: string; name: string } }[];
};

type BranchOption = { id: string; code: string; name: string };

export function UserTable({
  users,
  branchOptions,
  currentUserId,
}: {
  users: UserRow[];
  branchOptions: BranchOption[];
  currentUserId: string;
}) {
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);

  const columns: ColumnDef<UserRow>[] = [
    { header: "Nama", accessorKey: "name" },
    { header: "Email", accessorKey: "email" },
    { header: "Role", cell: ({ row }) => ROLE_LABELS[row.original.role] },
    {
      header: "Cabang",
      cell: ({ row }) =>
        isGlobalBranchRole(row.original.role)
          ? "Semua cabang"
          : row.original.branchAssignments.map((a) => a.branch.code).join(", ") || "-",
    },
    {
      header: "Status",
      cell: ({ row }) => <StatusBadge isActive={row.original.isActive} />,
    },
    {
      header: "Aksi",
      id: "actions",
      cell: ({ row }) => (
        <RowActions user={row.original} currentUserId={currentUserId} onEdit={setEditing} />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <MasterToolbar
        searchPlaceholder="Cari nama/email..."
        createSlot={
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            + Tambah User
          </button>
        }
      />

      <MasterTable columns={columns} data={users} emptyMessage="Belum ada user." />

      {editing && (
        <UserFormDialog
          user={editing === "new" ? null : editing}
          branchOptions={branchOptions}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RowActions({
  user,
  currentUserId,
  onEdit,
}: {
  user: UserRow;
  currentUserId: string;
  onEdit: (u: UserRow) => void;
}) {
  const isSelf = user.id === currentUserId;
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onEdit(user)}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        Edit
      </button>
      <ConfirmActionButton
        label={user.isActive ? "Nonaktifkan" : "Aktifkan"}
        confirmTitle={user.isActive ? "Nonaktifkan user?" : "Aktifkan user?"}
        confirmDescription={
          isSelf && user.isActive
            ? "Anda tidak bisa menonaktifkan akun Anda sendiri."
            : `User "${user.name}" akan di${user.isActive ? "nonaktifkan" : "aktifkan"}.`
        }
        variant={user.isActive ? "danger" : "default"}
        triggerClassName={
          isSelf && user.isActive
            ? "rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-300 cursor-not-allowed"
            : undefined
        }
        onConfirm={() => setUserActiveAction(user.id, !user.isActive)}
      />
    </div>
  );
}

function UserFormDialog({
  user,
  branchOptions,
  onClose,
}: {
  user: UserRow | null;
  branchOptions: BranchOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? Role.CASHIER);
  const [branchIds, setBranchIds] = useState<string[]>(
    user?.branchAssignments.map((a) => a.branch.id) ?? [],
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const showBranchPicker = !isGlobalBranchRole(role);

  function toggleBranch(branchId: string) {
    setBranchIds((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId],
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const payload = {
      name,
      email,
      role,
      branchIds: showBranchPicker ? branchIds : [],
      password,
    };

    const result = user
      ? await updateUserAction(user.id, payload)
      : await createUserAction(payload);

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast.success("User berhasil disimpan.");
    onClose();
    router.refresh();
  }

  return (
    <Modal title={user ? "Edit User" : "Tambah User"} open onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nama">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={isSubmitting}
              className={inputClass}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isSubmitting}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Role">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            disabled={isSubmitting}
            className={inputClass}
          >
            {Object.values(Role).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>

        {showBranchPicker ? (
          <div>
            <p className="text-sm font-medium text-slate-700">Cabang Ditugaskan</p>
            <div className="mt-1.5 flex flex-col gap-1.5 rounded-md border border-slate-200 p-2">
              {branchOptions.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={branchIds.includes(b.id)}
                    onChange={() => toggleBranch(b.id)}
                    disabled={isSubmitting}
                  />
                  {b.code} — {b.name}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Role ini memiliki akses ke semua cabang secara otomatis — tidak
            perlu penugasan cabang.
          </p>
        )}

        <Field label={user ? "Password Baru (kosongkan jika tidak diubah)" : "Password"}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={!user}
            disabled={isSubmitting}
            minLength={user ? undefined : 8}
            className={inputClass}
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

const inputClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:opacity-60";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}
