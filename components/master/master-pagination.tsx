import Link from "next/link";

export function MasterPagination({
  page,
  pageSize,
  totalCount,
  searchParams,
  basePath,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  searchParams: Record<string, string | undefined>;
  basePath: string;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  function hrefForPage(targetPage: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value) params.set(key, value);
    }
    params.set("page", String(targetPage));
    return `${basePath}?${params.toString()}`;
  }

  return (
    <div className="flex items-center justify-between text-sm text-slate-500">
      <p>
        Menampilkan {from}-{to} dari {totalCount} data
      </p>
      <div className="flex items-center gap-2">
        <Link
          href={hrefForPage(Math.max(1, page - 1))}
          aria-disabled={page <= 1}
          className={
            page <= 1
              ? "pointer-events-none rounded-md border border-slate-200 px-3 py-1 text-slate-300"
              : "rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50"
          }
        >
          Sebelumnya
        </Link>
        <span>
          Halaman {page} / {totalPages}
        </span>
        <Link
          href={hrefForPage(Math.min(totalPages, page + 1))}
          aria-disabled={page >= totalPages}
          className={
            page >= totalPages
              ? "pointer-events-none rounded-md border border-slate-200 px-3 py-1 text-slate-300"
              : "rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50"
          }
        >
          Berikutnya
        </Link>
      </div>
    </div>
  );
}
