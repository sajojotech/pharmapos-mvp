import { PosTransactionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Definisi "penjualan/omzet" laporan Fase 10 (lihat docs/REPORTS.md poin
 * desain #1): transaksi yang PERNAH dibayar (`paidAt` terisi) DAN belum
 * di-void — mencakup PAID, PARTIALLY_RETURNED, RETURNED. Angka GROSS,
 * belum dikurangi retur (retur punya laporan sendiri).
 */
export const SALES_WHERE_BASE = {
  paidAt: { not: null },
  status: { not: PosTransactionStatus.VOIDED },
};

function resolveBranchIds(allowedBranchIds: string[], requestedBranchId?: string): string[] {
  if (!requestedBranchId) return allowedBranchIds;
  return allowedBranchIds.includes(requestedBranchId) ? [requestedBranchId] : [];
}

export type SalesReportParams = {
  companyId: string;
  allowedBranchIds: string[];
  branchId?: string;
  dateFrom: Date;
  dateTo: Date;
};

export type DailyBranchSalesRow = {
  date: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  transactionCount: number;
  grossSales: Prisma.Decimal;
};

/**
 * Omzet HARIAN per cabang dalam rentang periode — satu-satunya laporan
 * yang butuh bucket per-hari, jadi dikerjakan lewat raw SQL (`date_trunc`,
 * lihat docs/REPORTS.md poin #2) alih-alih `groupBy` Prisma (yang tidak
 * bisa group-by ekspresi hasil truncate).
 *
 * PENTING: kolom `paidAt` bertipe `timestamp(3) WITHOUT time zone` (bukan
 * `timestamptz`) — Prisma selalu menyimpan/membaca `DateTime` sebagai
 * representasi UTC pada tipe naive ini. Karena itu `AT TIME ZONE 'zone'`
 * TIDAK dipakai di sini (semantiknya terbalik untuk kolom naive — ia akan
 * MENAFSIRKAN nilai yang sudah naive-UTC itu seolah-olah sudah dalam zona
 * tsb, lalu mengonversinya lagi, menghasilkan pergeseran hari yang salah).
 * Sebagai gantinya, offset Asia/Jakarta (+07:00, tanpa DST) ditambahkan
 * langsung sebagai interval SEBELUM `date_trunc`, murni aritmatika interval
 * yang tidak bergantung pada timezone session Postgres sama sekali.
 */
export async function getDailySalesByBranch(
  params: SalesReportParams,
): Promise<DailyBranchSalesRow[]> {
  const branchIds = resolveBranchIds(params.allowedBranchIds, params.branchId);
  if (branchIds.length === 0) return [];

  const rows = await prisma.$queryRaw<
    {
      date: string;
      branchId: string;
      branchCode: string;
      branchName: string;
      transactionCount: bigint;
      grossSales: Prisma.Decimal;
    }[]
  >`
    SELECT
      to_char(date_trunc('day', t."paidAt" + interval '7 hours'), 'YYYY-MM-DD') AS "date",
      b.id AS "branchId",
      b.code AS "branchCode",
      b.name AS "branchName",
      COUNT(DISTINCT t.id) AS "transactionCount",
      COALESCE(SUM(t."totalAmount"), 0) AS "grossSales"
    FROM "PosTransaction" t
    JOIN "Branch" b ON b.id = t."branchId"
    WHERE t."companyId" = ${params.companyId}
      AND t."branchId" IN (${Prisma.join(branchIds)})
      AND t."paidAt" IS NOT NULL
      AND t."status" != 'VOIDED'
      AND t."paidAt" >= ${params.dateFrom}
      AND t."paidAt" <= ${params.dateTo}
    GROUP BY "date", b.id, b.code, b.name
    ORDER BY "date" ASC, b.code ASC
  `;

  return rows.map((r) => ({ ...r, transactionCount: Number(r.transactionCount) }));
}

export type CashierSalesRow = {
  cashierId: string;
  cashierName: string;
  transactionCount: number;
  grossSales: Prisma.Decimal;
};

export async function getSalesByCashier(params: SalesReportParams): Promise<CashierSalesRow[]> {
  const branchIds = resolveBranchIds(params.allowedBranchIds, params.branchId);
  if (branchIds.length === 0) return [];

  const grouped = await prisma.posTransaction.groupBy({
    by: ["createdById"],
    where: {
      companyId: params.companyId,
      branchId: { in: branchIds },
      ...SALES_WHERE_BASE,
      paidAt: { gte: params.dateFrom, lte: params.dateTo },
    },
    _count: { _all: true },
    _sum: { totalAmount: true },
  });
  if (grouped.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: grouped.map((g) => g.createdById) } },
    select: { id: true, name: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u.name]));

  return grouped
    .map((g) => ({
      cashierId: g.createdById,
      cashierName: userMap.get(g.createdById) ?? "(tidak dikenal)",
      transactionCount: g._count._all,
      grossSales: g._sum.totalAmount ?? new Prisma.Decimal(0),
    }))
    .sort((a, b) => b.grossSales.comparedTo(a.grossSales));
}

export type PaymentMethodSalesRow = {
  method: string;
  paymentCount: number;
  totalAmount: Prisma.Decimal;
};

export async function getSalesByPaymentMethod(
  params: SalesReportParams,
): Promise<PaymentMethodSalesRow[]> {
  const branchIds = resolveBranchIds(params.allowedBranchIds, params.branchId);
  if (branchIds.length === 0) return [];

  const grouped = await prisma.payment.groupBy({
    by: ["method"],
    where: {
      transaction: {
        companyId: params.companyId,
        branchId: { in: branchIds },
        ...SALES_WHERE_BASE,
        paidAt: { gte: params.dateFrom, lte: params.dateTo },
      },
    },
    _count: { _all: true },
    _sum: { amount: true },
  });

  return grouped
    .map((g) => ({
      method: g.method,
      paymentCount: g._count._all,
      totalAmount: g._sum.amount ?? new Prisma.Decimal(0),
    }))
    .sort((a, b) => b.totalAmount.comparedTo(a.totalAmount));
}

export type ProductSalesRow = {
  productId: string;
  productSku: string;
  productName: string;
  categoryName: string;
  qtySold: Prisma.Decimal;
  revenue: Prisma.Decimal;
};

async function aggregateSalesByProduct(
  params: SalesReportParams & { categoryId?: string },
): Promise<ProductSalesRow[]> {
  const branchIds = resolveBranchIds(params.allowedBranchIds, params.branchId);
  if (branchIds.length === 0) return [];

  const grouped = await prisma.posTransactionItem.groupBy({
    by: ["productId"],
    where: {
      transaction: {
        companyId: params.companyId,
        branchId: { in: branchIds },
        ...SALES_WHERE_BASE,
        paidAt: { gte: params.dateFrom, lte: params.dateTo },
      },
      ...(params.categoryId ? { product: { categoryId: params.categoryId } } : {}),
    },
    _sum: { qty: true, lineTotal: true },
  });
  if (grouped.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: grouped.map((g) => g.productId) } },
    select: { id: true, sku: true, name: true, category: { select: { name: true } } },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  return grouped
    .map((g) => {
      const product = productMap.get(g.productId);
      if (!product) return null;
      return {
        productId: product.id,
        productSku: product.sku,
        productName: product.name,
        categoryName: product.category.name,
        qtySold: g._sum.qty ?? new Prisma.Decimal(0),
        revenue: g._sum.lineTotal ?? new Prisma.Decimal(0),
      };
    })
    .filter((row): row is ProductSalesRow => row !== null);
}

/** Penjualan per produk (+kategori) — diurutkan nama produk. */
export async function getSalesByProductCategory(
  params: SalesReportParams & { categoryId?: string },
): Promise<ProductSalesRow[]> {
  const rows = await aggregateSalesByProduct(params);
  return rows.sort((a, b) => a.productName.localeCompare(b.productName));
}

/** Produk terlaris — diurutkan qty terjual terbanyak, dibatasi `limit`. */
export async function getTopProducts(
  params: SalesReportParams & { categoryId?: string; limit?: number },
): Promise<ProductSalesRow[]> {
  const rows = await aggregateSalesByProduct(params);
  return rows
    .sort((a, b) => b.qtySold.comparedTo(a.qtySold))
    .slice(0, params.limit ?? 20);
}
