export const DEFAULT_PAGE_SIZE = 10;

export type StatusFilter = "all" | "active" | "inactive";

export type PaginatedQuery = {
  companyId: string;
  page: number;
  pageSize: number;
  q?: string;
  status?: StatusFilter;
};

/**
 * Bangun klausa `isActive` Prisma dari filter status URL. `undefined`
 * berarti tidak memfilter sama sekali (status "all").
 */
export function isActiveWhereClause(status: StatusFilter | undefined) {
  if (status === "active") return true;
  if (status === "inactive") return false;
  return undefined;
}

/**
 * Parse `page`/`status` dari searchParams halaman (string | string[] |
 * undefined khas Next.js) menjadi bentuk yang aman dipakai query.
 */
export function parseListSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
) {
  const rawPage = Array.isArray(searchParams.page)
    ? searchParams.page[0]
    : searchParams.page;
  const rawStatus = Array.isArray(searchParams.status)
    ? searchParams.status[0]
    : searchParams.status;
  const rawQ = Array.isArray(searchParams.q) ? searchParams.q[0] : searchParams.q;

  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const status: StatusFilter =
    rawStatus === "active" || rawStatus === "inactive" ? rawStatus : "all";
  const q = rawQ?.trim() || undefined;

  return { page, status, q };
}
