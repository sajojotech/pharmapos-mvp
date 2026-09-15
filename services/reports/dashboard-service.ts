import { Prisma } from "@prisma/client";
import { getOpenShiftForUser } from "@/services/cashier-shift-service";
import { getDailySalesByBranch, getTopProducts } from "@/services/reports/sales-report";
import { getNearExpiryReport, getStockMinimumReport } from "@/services/reports/inventory-report";
import { listPendingTransfers } from "@/services/reports/transfer-report";
import { jakartaDayEnd, jakartaDayStart, jakartaToday } from "@/lib/timezone";

const DASHBOARD_WIDGET_LIMIT = 5;

function todayRange() {
  const today = jakartaToday();
  return { dateFrom: jakartaDayStart(today), dateTo: jakartaDayEnd(today) };
}

export async function getBranchDashboardSnapshot(params: {
  companyId: string;
  branchId: string;
  userId: string;
}) {
  const { dateFrom, dateTo } = todayRange();

  const [salesRows, openShift, stockMinimum, nearExpiry, pendingTransfers] = await Promise.all([
    getDailySalesByBranch({
      companyId: params.companyId,
      allowedBranchIds: [params.branchId],
      branchId: params.branchId,
      dateFrom,
      dateTo,
    }),
    getOpenShiftForUser(params.userId),
    getStockMinimumReport({
      companyId: params.companyId,
      allowedBranchIds: [params.branchId],
      branchId: params.branchId,
    }),
    getNearExpiryReport({
      companyId: params.companyId,
      allowedBranchIds: [params.branchId],
      branchId: params.branchId,
      page: 1,
      pageSize: DASHBOARD_WIDGET_LIMIT,
    }),
    listPendingTransfers({
      companyId: params.companyId,
      allowedBranchIds: [params.branchId],
      branchId: params.branchId,
      limit: DASHBOARD_WIDGET_LIMIT,
    }),
  ]);

  return {
    todayRevenue: salesRows.reduce((sum, r) => sum.plus(r.grossSales), new Prisma.Decimal(0)),
    todayTransactionCount: salesRows.reduce((sum, r) => sum + r.transactionCount, 0),
    openShift,
    stockMinimumCount: stockMinimum.length,
    stockMinimumSample: stockMinimum.slice(0, DASHBOARD_WIDGET_LIMIT),
    nearExpiryCount: nearExpiry.totalCount,
    nearExpirySample: nearExpiry.data,
    pendingTransfers,
  };
}

export async function getGlobalDashboardSnapshot(params: {
  companyId: string;
  allowedBranchIds: string[];
}) {
  const { dateFrom, dateTo } = todayRange();

  const [salesRows, topProducts, stockMinimum, nearExpiry, pendingTransfers] = await Promise.all([
    getDailySalesByBranch({
      companyId: params.companyId,
      allowedBranchIds: params.allowedBranchIds,
      dateFrom,
      dateTo,
    }),
    getTopProducts({
      companyId: params.companyId,
      allowedBranchIds: params.allowedBranchIds,
      dateFrom,
      dateTo,
      limit: DASHBOARD_WIDGET_LIMIT,
    }),
    getStockMinimumReport({
      companyId: params.companyId,
      allowedBranchIds: params.allowedBranchIds,
    }),
    getNearExpiryReport({
      companyId: params.companyId,
      allowedBranchIds: params.allowedBranchIds,
      page: 1,
      pageSize: DASHBOARD_WIDGET_LIMIT,
    }),
    listPendingTransfers({
      companyId: params.companyId,
      allowedBranchIds: params.allowedBranchIds,
      limit: DASHBOARD_WIDGET_LIMIT,
    }),
  ]);

  return {
    todayRevenue: salesRows.reduce((sum, r) => sum.plus(r.grossSales), new Prisma.Decimal(0)),
    todayTransactionCount: salesRows.reduce((sum, r) => sum + r.transactionCount, 0),
    salesByBranchToday: salesRows,
    topProducts,
    stockMinimumCount: stockMinimum.length,
    stockMinimumSample: stockMinimum.slice(0, DASHBOARD_WIDGET_LIMIT),
    nearExpiryCount: nearExpiry.totalCount,
    nearExpirySample: nearExpiry.data,
    pendingTransfers,
  };
}
