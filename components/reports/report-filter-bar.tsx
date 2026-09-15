"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

type Option = { id: string; label: string };

/**
 * Filter bar generik untuk halaman laporan (Fase 10) — mirror
 * components/inventory/inventory-filter-bar.tsx (state di URL search
 * params, server-driven) tapi rentang tanggal tampil DEFAULT (laporan
 * pada dasarnya selalu periode-based), plus opsi kategori.
 */
export function ReportFilterBar({
  branches,
  categories,
  products,
  statusOptions,
  showDateRange = true,
}: {
  branches?: Option[];
  categories?: Option[];
  products?: Option[];
  statusOptions?: Option[];
  showDateRange?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  const selectClass =
    "rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {branches && branches.length > 1 && (
        <select
          value={searchParams.get("branchId") ?? ""}
          onChange={(e) => updateParams({ branchId: e.target.value || null })}
          className={selectClass}
        >
          <option value="">Semua cabang</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      )}

      {categories && (
        <select
          value={searchParams.get("categoryId") ?? ""}
          onChange={(e) => updateParams({ categoryId: e.target.value || null })}
          className={selectClass}
        >
          <option value="">Semua kategori</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      )}

      {products && (
        <select
          value={searchParams.get("productId") ?? ""}
          onChange={(e) => updateParams({ productId: e.target.value || null })}
          className={selectClass}
        >
          <option value="">Semua produk</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      )}

      {statusOptions && (
        <select
          value={searchParams.get("status") ?? ""}
          onChange={(e) => updateParams({ status: e.target.value || null })}
          className={selectClass}
        >
          <option value="">Semua status</option>
          {statusOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      )}

      {showDateRange && (
        <>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            Tanggal dari
            <input
              type="date"
              value={searchParams.get("dateFrom") ?? ""}
              onChange={(e) => updateParams({ dateFrom: e.target.value || null })}
              className={selectClass}
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            s.d.
            <input
              type="date"
              value={searchParams.get("dateTo") ?? ""}
              onChange={(e) => updateParams({ dateTo: e.target.value || null })}
              className={selectClass}
            />
          </label>
        </>
      )}
    </div>
  );
}
