import { Prisma, StockBatchStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listBatchesPaginated, listStockBalance } from "@/services/stock-batch-service";

const DEFAULT_NEAR_EXPIRY_WINDOW_DAYS = 90;

/**
 * Window "mendekati ED" (hari) — dari `AppSetting` key
 * `NEAR_EXPIRY_WINDOW_DAYS` bila ada, default 90. Pola identik
 * `readVarianceThreshold` di services/cashier-shift-service.ts.
 */
export async function resolveNearExpiryWindowDays(companyId: string): Promise<number> {
  const setting = await prisma.appSetting.findUnique({
    where: { companyId_key: { companyId, key: "NEAR_EXPIRY_WINDOW_DAYS" } },
  });
  if (!setting) return DEFAULT_NEAR_EXPIRY_WINDOW_DAYS;
  const value = setting.value;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_NEAR_EXPIRY_WINDOW_DAYS;
}

/** Stok tersedia per cabang — thin re-export supaya halaman laporan cukup
 * import dari satu tempat (services/reports/*). Lihat listStockBalance di
 * services/stock-batch-service.ts (Fase 04) untuk detail agregasi. */
export const getStockAvailableReport = listStockBalance;

export type StockMinimumRow = {
  branchId: string;
  branchCode: string;
  branchName: string;
  productId: string;
  productSku: string;
  productName: string;
  categoryName: string;
  qtyOnHand: Prisma.Decimal;
  minStock: Prisma.Decimal;
};

/**
 * Produk yang saldonya sudah di/bawah `defaultMinStock`, per cabang.
 * Reuse `listStockBalance` (agregasi qtyOnHand per branch+product) lalu
 * enrich dengan defaultMinStock/kategori & filter di sisi aplikasi — tidak
 * menambah query N+1 (satu query groupBy + satu batch-fetch produk, sama
 * seperti listStockBalance sendiri).
 */
export async function getStockMinimumReport(params: {
  companyId: string;
  allowedBranchIds: string[];
  branchId?: string;
  categoryId?: string;
}): Promise<StockMinimumRow[]> {
  const balances = await listStockBalance(params);
  if (balances.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: [...new Set(balances.map((b) => b.productId))] } },
    select: {
      id: true,
      defaultMinStock: true,
      categoryId: true,
      category: { select: { name: true } },
    },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  return balances
    .map((balance) => {
      const product = productMap.get(balance.productId);
      if (!product) return null;
      if (params.categoryId && product.categoryId !== params.categoryId) return null;
      if (balance.qtyOnHand.greaterThan(product.defaultMinStock)) return null;
      return {
        branchId: balance.branchId,
        branchCode: balance.branchCode,
        branchName: balance.branchName,
        productId: balance.productId,
        productSku: balance.productSku,
        productName: balance.productName,
        categoryName: product.category.name,
        qtyOnHand: balance.qtyOnHand,
        minStock: product.defaultMinStock,
      };
    })
    .filter((row): row is StockMinimumRow => row !== null);
}

export type NearExpiryQuery = {
  companyId: string;
  allowedBranchIds: string[];
  branchId?: string;
  productId?: string;
  windowDays?: number;
  page: number;
  pageSize?: number;
};

/**
 * Batch AVAILABLE yang ED-nya jatuh dalam window (default/AppSetting) —
 * belum lewat ED sama sekali (dipisah tegas dari getExpiredReport).
 */
export async function getNearExpiryReport(query: NearExpiryQuery) {
  const windowDays = query.windowDays ?? (await resolveNearExpiryWindowDays(query.companyId));
  const now = new Date();
  const expiryTo = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

  return listBatchesPaginated({
    companyId: query.companyId,
    allowedBranchIds: query.allowedBranchIds,
    branchId: query.branchId,
    productId: query.productId,
    status: StockBatchStatus.AVAILABLE,
    expiryFrom: now,
    expiryTo,
    page: query.page,
    pageSize: query.pageSize,
  });
}

export type ExpiredQuery = {
  companyId: string;
  allowedBranchIds: string[];
  branchId?: string;
  productId?: string;
  page: number;
  pageSize?: number;
};

/**
 * Batch yang sudah lewat ED (status EXPIRED — `listBatchesPaginated`
 * memanggil `syncExpiredBatchStatus` di awal, jadi status selalu akurat
 * tanpa bergantung cron job terpisah).
 */
export async function getExpiredReport(query: ExpiredQuery) {
  return listBatchesPaginated({
    companyId: query.companyId,
    allowedBranchIds: query.allowedBranchIds,
    branchId: query.branchId,
    productId: query.productId,
    status: StockBatchStatus.EXPIRED,
    page: query.page,
    pageSize: query.pageSize,
  });
}
