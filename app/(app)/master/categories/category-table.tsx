"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import type { Category } from "@prisma/client";
import { MasterTable } from "@/components/master/master-table";
import { MasterToolbar } from "@/components/master/master-toolbar";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { Modal } from "@/components/ui/modal";
import {
  createCategoryAction,
  setCategoryActiveAction,
  updateCategoryAction,
} from "./actions";

export function CategoryTable({
  categories,
  canManage,
}: {
  categories: Category[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<Category | "new" | null>(null);

  const columns: ColumnDef<Category>[] = [
    { header: "Nama", accessorKey: "name" },
    {
      header: "Status",
      cell: ({ row }) => <StatusBadge isActive={row.original.isActive} />,
    },
    ...(canManage
      ? [
          {
            header: "Aksi",
            id: "actions",
            cell: ({ row }: { row: { original: Category } }) => (
              <RowActions category={row.original} onEdit={setEditing} />
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <MasterToolbar
        searchPlaceholder="Cari nama kategori..."
        createSlot={
          canManage && (
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              + Tambah Kategori
            </button>
          )
        }
      />

      <MasterTable columns={columns} data={categories} emptyMessage="Belum ada kategori." />

      {editing && (
        <CategoryFormDialog
          category={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RowActions({
  category,
  onEdit,
}: {
  category: Category;
  onEdit: (c: Category) => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onEdit(category)}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
      >
        Edit
      </button>
      <ConfirmActionButton
        label={category.isActive ? "Nonaktifkan" : "Aktifkan"}
        confirmTitle={
          category.isActive ? "Nonaktifkan kategori?" : "Aktifkan kategori?"
        }
        confirmDescription={`Kategori "${category.name}" akan di${category.isActive ? "nonaktifkan" : "aktifkan"}.`}
        variant={category.isActive ? "danger" : "default"}
        onConfirm={() =>
          setCategoryActiveAction(category.id, !category.isActive)
        }
      />
    </div>
  );
}

function CategoryFormDialog({
  category,
  onClose,
}: {
  category: Category | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(category?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const result = category
      ? await updateCategoryAction(category.id, { name })
      : await createCategoryAction({ name });

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast.success("Kategori berhasil disimpan.");
    onClose();
    router.refresh();
  }

  return (
    <Modal
      title={category ? "Edit Kategori" : "Tambah Kategori"}
      open
      onClose={onClose}
      widthClassName="max-w-sm"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="category-name" className="text-sm font-medium text-slate-700">
            Nama Kategori
          </label>
          <input
            id="category-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={isSubmitting}
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
