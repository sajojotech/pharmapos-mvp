import { can, requirePermission } from "@/lib/rbac";
import { listWarehousesPaginated } from "@/services/warehouse-service";
import { listActiveBranches } from "@/services/branch-service";
import { parseListSearchParams, DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { MasterPagination } from "@/components/master/master-pagination";
import { WarehouseTable } from "./warehouse-table";

export default async function WarehousesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("master.read");
  const resolvedSearchParams = await searchParams;
  const { page, status, q } = parseListSearchParams(resolvedSearchParams);

  const [{ data, totalCount }, branches] = await Promise.all([
    listWarehousesPaginated({
      companyId: user.companyId,
      page,
      pageSize: DEFAULT_PAGE_SIZE,
      q,
      status,
    }),
    listActiveBranches(user.companyId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Warehouse</h1>
        <p className="mt-1 text-sm text-slate-600">
          Lokasi penyimpanan stok di dalam sebuah cabang. Setiap cabang
          sebaiknya punya tepat satu warehouse default.
        </p>
      </div>

      <WarehouseTable
        warehouses={data}
        branchOptions={branches}
        canManage={can(user, "master.manage")}
      />

      <MasterPagination
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        totalCount={totalCount}
        searchParams={{ q, status }}
        basePath="/master/warehouses"
      />
    </div>
  );
}
