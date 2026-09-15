import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds, listActiveBranches } from "@/services/branch-service";
import { listActiveProducts } from "@/services/product-service";
import { listStockBalance } from "@/services/stock-batch-service";
import { InventoryFilterBar } from "@/components/inventory/inventory-filter-bar";
import { formatDecimalQty } from "@/lib/format";

export default async function InventoryStockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("inventory.read");
  const resolved = await searchParams;
  const branchId = typeof resolved.branchId === "string" ? resolved.branchId : undefined;
  const productId = typeof resolved.productId === "string" ? resolved.productId : undefined;

  const allowedBranchIds = await getAllowedBranchIds(user);

  const [rows, branches, products] = await Promise.all([
    listStockBalance({ companyId: user.companyId, allowedBranchIds, branchId, productId }),
    listActiveBranches(user.companyId),
    listActiveProducts(user.companyId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Saldo Stok</h1>
        <p className="mt-1 text-sm text-slate-600">
          Saldo fisik teragregasi per cabang &amp; produk (dijumlahkan dari
          seluruh batch, apa pun statusnya). Lihat{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
            /inventory/batches
          </code>{" "}
          untuk rincian per batch/status.
        </p>
      </div>

      <InventoryFilterBar
        branches={branches
          .filter((b) => allowedBranchIds.includes(b.id))
          .map((b) => ({ id: b.id, label: `${b.code} — ${b.name}` }))}
        products={products.map((p) => ({ id: p.id, label: `${p.sku} — ${p.name}` }))}
      />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Cabang</th>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Produk</th>
              <th className="px-4 py-2 text-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                  Belum ada stok untuk filter ini.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr
                key={`${row.branchId}-${row.productId}`}
                className="border-b border-slate-100"
              >
                <td className="px-4 py-2">
                  {row.branchCode} — {row.branchName}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{row.productSku}</td>
                <td className="px-4 py-2">{row.productName}</td>
                <td className="px-4 py-2 text-right font-medium">
                  {formatDecimalQty(row.qtyOnHand.toString())}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
