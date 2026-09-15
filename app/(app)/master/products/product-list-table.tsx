"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import type { Prisma } from "@prisma/client";
import { MasterTable } from "@/components/master/master-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { formatRupiah } from "@/lib/format";
import { setProductActiveAction } from "./actions";

type ProductRow = Prisma.ProductGetPayload<{
  include: { category: true; baseUnit: true; barcodes: true };
}>;

export function ProductListTable({
  products,
  canManage,
}: {
  products: ProductRow[];
  canManage: boolean;
}) {
  const columns: ColumnDef<ProductRow>[] = [
    { header: "SKU", accessorKey: "sku" },
    {
      header: "Nama",
      cell: ({ row }) => (
        <Link
          href={`/master/products/${row.original.id}`}
          className="font-medium text-emerald-700 hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    },
    { header: "Kategori", cell: ({ row }) => row.original.category.name },
    { header: "Satuan", cell: ({ row }) => row.original.baseUnit.name },
    {
      header: "Resep",
      cell: ({ row }) => (row.original.requiresPrescription ? "Ya" : "Tidak"),
    },
    {
      header: "Harga",
      cell: ({ row }) => formatRupiah(row.original.defaultSellingPrice.toString()),
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
            cell: ({ row }: { row: { original: ProductRow } }) => (
              <div className="flex gap-2">
                <Link
                  href={`/master/products/${row.original.id}`}
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Edit
                </Link>
                <ConfirmActionButton
                  label={row.original.isActive ? "Nonaktifkan" : "Aktifkan"}
                  confirmTitle={
                    row.original.isActive
                      ? "Nonaktifkan produk?"
                      : "Aktifkan produk?"
                  }
                  confirmDescription={`Produk "${row.original.name}" akan di${row.original.isActive ? "nonaktifkan" : "aktifkan"}. Produk nonaktif tidak muncul di pencarian POS.`}
                  variant={row.original.isActive ? "danger" : "default"}
                  onConfirm={() =>
                    setProductActiveAction(row.original.id, !row.original.isActive)
                  }
                />
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <MasterTable columns={columns} data={products} emptyMessage="Belum ada produk." />
  );
}
