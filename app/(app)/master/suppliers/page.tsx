import { can, requirePermission } from "@/lib/rbac";
import { listSuppliersPaginated } from "@/services/supplier-service";
import { parseListSearchParams, DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { MasterPagination } from "@/components/master/master-pagination";
import { SupplierTable } from "./supplier-table";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("master.read");
  const resolvedSearchParams = await searchParams;
  const { page, status, q } = parseListSearchParams(resolvedSearchParams);

  const { data, totalCount } = await listSuppliersPaginated({
    companyId: user.companyId,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    q,
    status,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Supplier</h1>
        <p className="mt-1 text-sm text-slate-600">
          Data pemasok yang dipakai pada penerimaan barang (fase berikutnya).
        </p>
      </div>

      <SupplierTable suppliers={data} canManage={can(user, "master.manage")} />

      <MasterPagination
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        totalCount={totalCount}
        searchParams={{ q, status }}
        basePath="/master/suppliers"
      />
    </div>
  );
}
