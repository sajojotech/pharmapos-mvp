import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SALES_WHERE_BASE } from "./sales-report";

function resolveBranchIds(allowedBranchIds: string[], requestedBranchId?: string): string[] {
  if (!requestedBranchId) return allowedBranchIds;
  return allowedBranchIds.includes(requestedBranchId) ? [requestedBranchId] : [];
}

export type ReportDateRangeParams = {
  companyId: string;
  allowedBranchIds: string[];
  branchId?: string;
  dateFrom: Date;
  dateTo: Date;
};

export type VoidReportRow = {
  transactionId: string;
  documentNumber: string;
  branchCode: string;
  branchName: string;
  totalAmount: Prisma.Decimal;
  voidedAt: Date;
  voidedByName: string;
  voidReason: string;
};

/** Transaksi yang di-void dalam periode — lihat services/pos-void-service.ts. */
export async function getVoidReport(params: ReportDateRangeParams): Promise<VoidReportRow[]> {
  const branchIds = resolveBranchIds(params.allowedBranchIds, params.branchId);
  if (branchIds.length === 0) return [];

  const rows = await prisma.posTransaction.findMany({
    where: {
      companyId: params.companyId,
      branchId: { in: branchIds },
      voidedAt: { gte: params.dateFrom, lte: params.dateTo },
    },
    include: {
      branch: { select: { code: true, name: true } },
      voidedBy: { select: { name: true } },
    },
    orderBy: { voidedAt: "desc" },
  });

  return rows
    .filter((r) => r.voidedAt)
    .map((r) => ({
      transactionId: r.id,
      documentNumber: r.documentNumber,
      branchCode: r.branch.code,
      branchName: r.branch.name,
      totalAmount: r.totalAmount,
      voidedAt: r.voidedAt as Date,
      voidedByName: r.voidedBy?.name ?? "(tidak diketahui)",
      voidReason: r.voidReason ?? "",
    }));
}

export type ReturnReportRow = {
  salesReturnId: string;
  documentNumber: string;
  branchCode: string;
  branchName: string;
  createdAt: Date;
  createdByName: string;
  reason: string;
  itemCount: number;
  totalQtyReturned: Prisma.Decimal;
};

/** Retur penjualan dalam periode — lihat services/sales-return-service.ts. */
export async function getReturnReport(params: ReportDateRangeParams): Promise<ReturnReportRow[]> {
  const branchIds = resolveBranchIds(params.allowedBranchIds, params.branchId);
  if (branchIds.length === 0) return [];

  const rows = await prisma.salesReturn.findMany({
    where: {
      companyId: params.companyId,
      branchId: { in: branchIds },
      createdAt: { gte: params.dateFrom, lte: params.dateTo },
    },
    include: {
      branch: { select: { code: true, name: true } },
      createdBy: { select: { name: true } },
      posTransaction: { select: { documentNumber: true } },
      items: { select: { qtyReturned: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((r) => ({
    salesReturnId: r.id,
    documentNumber: r.posTransaction.documentNumber,
    branchCode: r.branch.code,
    branchName: r.branch.name,
    createdAt: r.createdAt,
    createdByName: r.createdBy.name,
    reason: r.reason,
    itemCount: r.items.length,
    totalQtyReturned: r.items.reduce(
      (sum, item) => sum.plus(item.qtyReturned),
      new Prisma.Decimal(0),
    ),
  }));
}

export type DiscountReportRow = {
  branchId: string;
  branchCode: string;
  branchName: string;
  transactionCount: number;
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  discountPct: number;
};

/**
 * Ringkasan diskon per cabang — dari transaksi "penjualan" (lihat
 * SALES_WHERE_BASE di sales-report.ts), membandingkan total subtotal vs
 * total diskon yang diberikan.
 */
export async function getDiscountReport(params: ReportDateRangeParams): Promise<DiscountReportRow[]> {
  const branchIds = resolveBranchIds(params.allowedBranchIds, params.branchId);
  if (branchIds.length === 0) return [];

  const grouped = await prisma.posTransaction.groupBy({
    by: ["branchId"],
    where: {
      companyId: params.companyId,
      branchId: { in: branchIds },
      ...SALES_WHERE_BASE,
      paidAt: { gte: params.dateFrom, lte: params.dateTo },
    },
    _count: { _all: true },
    _sum: { subtotal: true, discountAmount: true, totalAmount: true },
  });
  if (grouped.length === 0) return [];

  const branches = await prisma.branch.findMany({
    where: { id: { in: grouped.map((g) => g.branchId) } },
    select: { id: true, code: true, name: true },
  });
  const branchMap = new Map(branches.map((b) => [b.id, b]));

  return grouped
    .map((g) => {
      const branch = branchMap.get(g.branchId);
      if (!branch) return null;
      const subtotal = g._sum.subtotal ?? new Prisma.Decimal(0);
      const discountAmount = g._sum.discountAmount ?? new Prisma.Decimal(0);
      return {
        branchId: branch.id,
        branchCode: branch.code,
        branchName: branch.name,
        transactionCount: g._count._all,
        subtotal,
        discountAmount,
        totalAmount: g._sum.totalAmount ?? new Prisma.Decimal(0),
        discountPct: subtotal.isZero() ? 0 : discountAmount.dividedBy(subtotal).times(100).toNumber(),
      };
    })
    .filter((row): row is DiscountReportRow => row !== null)
    .sort((a, b) => a.branchCode.localeCompare(b.branchCode));
}
