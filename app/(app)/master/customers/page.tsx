import { can, requirePermission } from "@/lib/rbac";
import { listCustomersPaginated } from "@/services/customer-service";
import { parseListSearchParams, DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { MasterPagination } from "@/components/master/master-pagination";
import { CustomerTable } from "./customer-table";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("master.read");
  const resolvedSearchParams = await searchParams;
  const { page, status, q } = parseListSearchParams(resolvedSearchParams);

  const { data, totalCount } = await listCustomersPaginated({
    companyId: user.companyId,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    q,
    status,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Customer</h1>
        <p className="mt-1 text-sm text-slate-600">
          Data pelanggan untuk transaksi POS (fase berikutnya). Customer
          &quot;Umum&quot; dipakai sebagai default transaksi tanpa nama.
        </p>
      </div>

      <CustomerTable customers={data} canManage={can(user, "master.manage")} />

      <MasterPagination
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        totalCount={totalCount}
        searchParams={{ q, status }}
        basePath="/master/customers"
      />
    </div>
  );
}
