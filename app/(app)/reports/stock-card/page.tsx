import { StockMovementType } from "@prisma/client";
import { requirePermission } from "@/lib/rbac";
import { getAllowedBranchIds, listActiveBranches } from "@/services/branch-service";
import { listActiveProducts } from "@/services/product-service";
import { listMovementsPaginated } from "@/services/stock-movement-service";
import { InventoryFilterBar } from "@/components/inventory/inventory-filter-bar";
import { ReportExportLink } from "@/components/reports/report-export-link";
import { MasterPagination } from "@/components/master/master-pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { formatDateTime, formatDecimalQty } from "@/lib/format";

const MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  OPENING_BALANCE: "Saldo Awal",
  PURCHASE_RECEIPT: "Penerimaan Barang",
  POS_SALE: "Penjualan POS",
  SALES_RETURN: "Retur Penjualan",
  SUPPLIER_RETURN: "Retur ke Supplier",
  TRANSFER_OUT: "Transfer Keluar",
  TRANSFER_IN: "Transfer Masuk",
  STOCK_ADJUSTMENT_IN: "Adjustment Masuk",
  STOCK_ADJUSTMENT_OUT: "Adjustment Keluar",
  STOCK_OPNAME: "Stock Opname",
  VOID_REVERSAL: "Pembatalan Transaksi",
  EXPIRED_WRITE_OFF: "Write-off Kedaluwarsa",
  DAMAGED_WRITE_OFF: "Write-off Rusak",
};

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function StockCardReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("report.read.branch");
  const resolved = await searchParams;

  const branchId = str(resolved.branchId);
  const productId = str(resolved.productId);
  const movementType = str(resolved.movementType) as StockMovementType | undefined;
  const dateFrom = str(resolved.dateFrom);
  const dateTo = str(resolved.dateTo);
  const page = Math.max(1, Number.parseInt(str(resolved.page) ?? "1", 10) || 1);

  const allowedBranchIds = await getAllowedBranchIds(user);

  const [{ data, totalCount }, branches, products] = await Promise.all([
    listMovementsPaginated({
      companyId: user.companyId,
      allowedBranchIds,
      branchId,
      productId,
      movementType,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(`${dateTo}T23:59:59`) : undefined,
      page,
      pageSize: DEFAULT_PAGE_SIZE,
    }),
    listActiveBranches(user.companyId),
    listActiveProducts(user.companyId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Kartu Stok</h1>
        <p className="mt-1 text-sm text-slate-600">
          Ledger mutasi stok — append-only, urut dari yang terbaru.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <InventoryFilterBar
          branches={branches
            .filter((b) => allowedBranchIds.includes(b.id))
            .map((b) => ({ id: b.id, label: `${b.code} — ${b.name}` }))}
          products={products.map((p) => ({ id: p.id, label: `${p.sku} — ${p.name}` }))}
          movementTypeOptions={Object.entries(MOVEMENT_TYPE_LABELS).map(([id, label]) => ({
            id,
            label,
          }))}
          showDateRange
        />
        <ReportExportLink
          basePath="/reports/stock-card"
          filters={{ branchId, productId, movementType, dateFrom, dateTo }}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Waktu</th>
              <th className="px-4 py-2">Cabang</th>
              <th className="px-4 py-2">Produk</th>
              <th className="px-4 py-2">No. Batch</th>
              <th className="px-4 py-2">Jenis Mutasi</th>
              <th className="px-4 py-2 text-right">Masuk</th>
              <th className="px-4 py-2 text-right">Keluar</th>
              <th className="px-4 py-2 text-right">Saldo</th>
              <th className="px-4 py-2">Oleh</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  Tidak ada mutasi untuk filter ini.
                </td>
              </tr>
            )}
            {data.map((m) => (
              <tr key={m.id} className="border-b border-slate-100">
                <td className="px-4 py-2 whitespace-nowrap">{formatDateTime(m.occurredAt)}</td>
                <td className="px-4 py-2">{m.branch.code}</td>
                <td className="px-4 py-2">
                  {m.product.sku} — {m.product.name}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{m.stockBatch.batchNumber}</td>
                <td className="px-4 py-2">{MOVEMENT_TYPE_LABELS[m.movementType]}</td>
                <td className="px-4 py-2 text-right text-emerald-700">
                  {Number(m.qtyIn) > 0 ? `+${formatDecimalQty(m.qtyIn.toString())}` : "-"}
                </td>
                <td className="px-4 py-2 text-right text-red-700">
                  {Number(m.qtyOut) > 0 ? `-${formatDecimalQty(m.qtyOut.toString())}` : "-"}
                </td>
                <td className="px-4 py-2 text-right font-medium">
                  {formatDecimalQty(m.balanceAfter.toString())}
                </td>
                <td className="px-4 py-2">{m.createdBy.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <MasterPagination
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        totalCount={totalCount}
        searchParams={{ branchId, productId, movementType, dateFrom, dateTo }}
        basePath="/reports/stock-card"
      />
    </div>
  );
}
