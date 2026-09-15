"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useRef, useState } from "react";

/**
 * Toolbar pencarian + filter status yang dipakai di seluruh halaman master.
 * State disimpan di URL search params (`q`, `status`) sehingga
 * pagination/filter/search sepenuhnya server-driven dan bisa di-share lewat
 * URL (mis. bookmark hasil filter tertentu).
 */
export function MasterToolbar({
  searchPlaceholder = "Cari...",
  createSlot,
}: {
  searchPlaceholder?: string;
  createSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  function handleSearchChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParams({ q: value || null });
    }, 350);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => handleSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
        />
        <select
          value={searchParams.get("status") ?? "all"}
          onChange={(event) => updateParams({ status: event.target.value })}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
        >
          <option value="all">Semua status</option>
          <option value="active">Aktif</option>
          <option value="inactive">Nonaktif</option>
        </select>
      </div>
      {createSlot}
    </div>
  );
}
