import { can, requirePermission } from "@/lib/rbac";
import { listCategoriesPaginated } from "@/services/category-service";
import { parseListSearchParams, DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { MasterPagination } from "@/components/master/master-pagination";
import { CategoryTable } from "./category-table";

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("master.read");
  const resolvedSearchParams = await searchParams;
  const { page, status, q } = parseListSearchParams(resolvedSearchParams);

  const { data, totalCount } = await listCategoriesPaginated({
    companyId: user.companyId,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    q,
    status,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Kategori Produk</h1>
        <p className="mt-1 text-sm text-slate-600">
          Kategori dipakai untuk mengelompokkan produk pada master produk.
        </p>
      </div>

      <CategoryTable categories={data} canManage={can(user, "master.manage")} />

      <MasterPagination
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        totalCount={totalCount}
        searchParams={{ q, status }}
        basePath="/master/categories"
      />
    </div>
  );
}
