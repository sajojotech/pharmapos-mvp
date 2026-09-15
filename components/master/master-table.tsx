"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";

/**
 * Wrapper TanStack Table generik untuk seluruh tabel master data. Sengaja
 * hanya memakai getCoreRowModel() — sorting/filtering/pagination dilakukan
 * server-side (lihat MasterToolbar/MasterPagination), bukan di client.
 */
export function MasterTable<T>({
  columns,
  data,
  emptyMessage = "Belum ada data.",
}: {
  // TValue berbeda-beda per kolom pada wrapper generik ini; `any` di sini
  // adalah pola yang sama dipakai dokumentasi resmi TanStack Table untuk
  // komponen tabel generik lintas tipe data.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  data: T[];
  emptyMessage?: string;
}) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="px-4 py-2">
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-slate-400"
              >
                {emptyMessage}
              </td>
            </tr>
          )}
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-2 align-middle">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
