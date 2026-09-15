import { StockBatchStatus } from "@prisma/client";
import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds, listActiveBranches } from "@/services/branch-service";
import { listActiveProducts } from "@/services/product-service";
import { listBatchesPaginated } from "@/services/stock-batch-service";
import { InventoryFilterBar } from "@/components/inventory/inventory-filter-bar";
import { BatchStatusBadge } from "@/components/inventory/batch-status-badge";
import { MasterPagination } from "@/components/master/master-pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { formatDate, formatDecimalQty, formatRupiah } from "@/lib/format";

const STATUS_LABELS: Record<StockBatchStatus, string> = {
  AVAILABLE: "Tersedia",
  QUARANTINED: "Karantina",
  BLOCKED: "Diblokir",
  EXPIRED: "Kedaluwarsa",
  DAMAGED: "Rusak",
};

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function BatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("inventory.read");
  const resolved = await searchParams;

  const branchId = str(resolved.branchId);
  const productId = str(resolved.productId);
  const status = str(resolved.status) as StockBatchStatus | undefined;
  const expiryFrom = str(resolved.expiryFrom);
  const expiryTo = str(resolved.expiryTo);
  const page = Math.max(1, Number.parseInt(str(resolved.page) ?? "1", 10) || 1);

  const allowedBranchIds = await getAllowedBranchIds(user);

  const [{ data, totalCount }, branches, products] = await Promise.all([
    listBatchesPaginated({
      companyId: user.companyId,
      allowedBranchIds,
      branchId,
      productId,
      status,
      expiryFrom: expiryFrom ? new Date(expiryFrom) : undefined,
      expiryTo: expiryTo ? new Date(`${expiryTo}T23:59:59`) : undefined,
      page,
      pageSize: DEFAULT_PAGE_SIZE,
    }),
    listActiveBranches(user.companyId),
    listActiveProducts(user.companyId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Batch Stok</h1>
        <p className="mt-1 text-sm text-slate-600">
          Rincian per batch/lot, termasuk status dan tanggal kedaluwarsa (ED).
        </p>
      </div>

      <InventoryFilterBar
        branches={branches
          .filter((b) => allowedBranchIds.includes(b.id))
          .map((b) => ({ id: b.id, label: `${b.code} — ${b.name}` }))}
        products={products.map((p) => ({ id: p.id, label: `${p.sku} — ${p.name}` }))}
        statusOptions={Object.entries(STATUS_LABELS).map(([id, label]) => ({ id, label }))}
        showExpiryRange
      />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Cabang</th>
              <th className="px-4 py-2">Produk</th>
              <th className="px-4 py-2">No. Batch</th>
              <th className="px-4 py-2">ED</th>
              <th className="px-4 py-2 text-right">Qty</th>
              <th className="px-4 py-2 text-right">Harga Modal</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Tidak ada batch untuk filter ini.
                </td>
              </tr>
            )}
            {data.map((batch) => (
              <tr key={batch.id} className="border-b border-slate-100">
                <td className="px-4 py-2">{batch.branch.code}</td>
                <td className="px-4 py-2">
                  {batch.product.sku} — {batch.product.name}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{batch.batchNumber}</td>
                <td className="px-4 py-2">{formatDate(batch.expiryDate)}</td>
                <td className="px-4 py-2 text-right">
                  {formatDecimalQty(batch.qtyOnHand.toString())}
                </td>
                <td className="px-4 py-2 text-right">
                  {formatRupiah(batch.unitCost.toString())}
                </td>
                <td className="px-4 py-2">
                  <BatchStatusBadge status={batch.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <MasterPagination
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        totalCount={totalCount}
        searchParams={{ branchId, productId, status, expiryFrom, expiryTo }}
        basePath="/inventory/batches"
      />
    </div>
  );
}
