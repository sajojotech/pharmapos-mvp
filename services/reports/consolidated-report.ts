import { Prisma } from "@prisma/client";
import { getDailySalesByBranch, getTopProducts } from "@/services/reports/sales-report";
import { getNearExpiryReport, getStockMinimumReport } from "@/services/reports/inventory-report";
import { listPendingTransfers } from "@/services/reports/transfer-report";

const TOP_PRODUCTS_LIMIT = 10;

export type BranchTotalRow = {
  branchId: string;
  branchCode: string;
  branchName: string;
  transactionCount: number;
  grossSales: Prisma.Decimal;
};

/**
 * Versi `/reports/consolidated` (date-range, permission `report.read.all`)
 * dari snapshot dashboard global — reuse `getDailySalesByBranch` lalu
 * dijumlahkan per cabang di sisi aplikasi (array kecil, aman tanpa query
 * tambahan) supaya ringkasan per-cabang tidak pecah per-hari seperti
 * `/reports/sales-by-branch`.
 */
export async function getConsolidatedReport(params: {
  companyId: string;
  allowedBranchIds: string[];
  dateFrom: Date;
  dateTo: Date;
}) {
  const [dailyRows, topProducts, stockMinimum, nearExpiry, pendingTransfers] = await Promise.all([
    getDailySalesByBranch({
      companyId: params.companyId,
      allowedBranchIds: params.allowedBranchIds,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    }),
    getTopProducts({
      companyId: params.companyId,
      allowedBranchIds: params.allowedBranchIds,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      limit: TOP_PRODUCTS_LIMIT,
    }),
    getStockMinimumReport({
      companyId: params.companyId,
      allowedBranchIds: params.allowedBranchIds,
    }),
    getNearExpiryReport({
      companyId: params.companyId,
      allowedBranchIds: params.allowedBranchIds,
      page: 1,
      pageSize: TOP_PRODUCTS_LIMIT,
    }),
    listPendingTransfers({
      companyId: params.companyId,
      allowedBranchIds: params.allowedBranchIds,
    }),
  ]);

  const byBranch = new Map<string, BranchTotalRow>();
  for (const row of dailyRows) {
    const existing = byBranch.get(row.branchId);
    if (existing) {
      existing.transactionCount += row.transactionCount;
      existing.grossSales = existing.grossSales.plus(row.grossSales);
    } else {
      byBranch.set(row.branchId, {
        branchId: row.branchId,
        branchCode: row.branchCode,
        branchName: row.branchName,
        transactionCount: row.transactionCount,
        grossSales: row.grossSales,
      });
    }
  }
  const branchTotals = [...byBranch.values()].sort((a, b) => a.branchCode.localeCompare(b.branchCode));

  return {
    totalRevenue: branchTotals.reduce((sum, r) => sum.plus(r.grossSales), new Prisma.Decimal(0)),
    totalTransactionCount: branchTotals.reduce((sum, r) => r.transactionCount + sum, 0),
    branchTotals,
    topProducts,
    stockMinimumCount: stockMinimum.length,
    nearExpiryCount: nearExpiry.totalCount,
    pendingTransfers,
  };
}
