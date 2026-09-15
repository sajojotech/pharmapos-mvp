import { requirePermission } from "@/lib/rbac";
import { listUsersPaginated } from "@/services/user-service";
import { listActiveBranches } from "@/services/branch-service";
import { parseListSearchParams, DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { MasterPagination } from "@/components/master/master-pagination";
import { UserTable } from "./user-table";

export default async function UsersSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("user.manage");
  const resolvedSearchParams = await searchParams;
  const { page, status, q } = parseListSearchParams(resolvedSearchParams);

  const [{ data, totalCount }, branches] = await Promise.all([
    listUsersPaginated({
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
        <h1 className="text-2xl font-bold text-slate-900">Manajemen User</h1>
        <p className="mt-1 text-sm text-slate-600">
          Hanya Owner &amp; Admin Pusat yang dapat mengelola akun user.
        </p>
      </div>

      <UserTable users={data} branchOptions={branches} currentUserId={user.id} />

      <MasterPagination
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        totalCount={totalCount}
        searchParams={{ q, status }}
        basePath="/settings/users"
      />
    </div>
  );
}
