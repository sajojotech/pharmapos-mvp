import Link from "next/link";
import { can, requirePermission } from "@/lib/rbac";
import { listProductsPaginated } from "@/services/product-service";
import { parseListSearchParams, DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { MasterPagination } from "@/components/master/master-pagination";
import { MasterToolbar } from "@/components/master/master-toolbar";
import { toPlainJSON } from "@/lib/serialize";
import { ProductListTable } from "./product-list-table";

export default async function MasterProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("master.read");
  const resolvedSearchParams = await searchParams;
  const { page, status, q } = parseListSearchParams(resolvedSearchParams);
  const canManage = can(user, "master.manage");

  const { data, totalCount } = await listProductsPaginated({
    companyId: user.companyId,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    q,
    status,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Master Produk</h1>
        <p className="mt-1 text-sm text-slate-600">
          Master produk terpusat, dipakai oleh seluruh cabang. Produk
          nonaktif tidak muncul di pencarian POS (fase berikutnya).
        </p>
      </div>

      <MasterToolbar
        searchPlaceholder="Cari SKU/nama/generik/barcode..."
        createSlot={
          canManage && (
            <Link
              href="/master/products/new"
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              + Tambah Produk
            </Link>
          )
        }
      />

      <ProductListTable products={toPlainJSON(data)} canManage={canManage} />

      <MasterPagination
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        totalCount={totalCount}
        searchParams={{ q, status }}
        basePath="/master/products"
      />
    </div>
  );
}
