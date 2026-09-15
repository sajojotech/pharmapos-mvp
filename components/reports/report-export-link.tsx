/**
 * Link "Export CSV" — server component biasa (BUKAN "use client"): cukup
 * navigasi native browser ke Route Handler `.../export` yang mengembalikan
 * file attachment, tidak butuh interaktivitas apa pun. `filters` adalah
 * nilai filter yang SAMA dengan yang dipakai halaman (dateFrom/dateTo/
 * branchId/dst.) supaya CSV selalu mengikuti filter tabel yang sedang
 * ditampilkan — lihat docs/REPORTS.md poin desain #5.
 */
export function ReportExportLink({
  basePath,
  filters,
}: {
  basePath: string;
  filters: Record<string, string | undefined>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();

  return (
    <a
      href={`${basePath}/export${qs ? `?${qs}` : ""}`}
      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
    >
      Export CSV
    </a>
  );
}
