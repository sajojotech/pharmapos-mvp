import { Prisma, type StockMovementType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

function resolveEffectiveBranchIds(
  allowedBranchIds: string[],
  requestedBranchId?: string,
): string[] {
  if (!requestedBranchId) return allowedBranchIds;
  return allowedBranchIds.includes(requestedBranchId) ? [requestedBranchId] : [];
}

export type MovementListQuery = {
  companyId: string;
  allowedBranchIds: string[];
  branchId?: string;
  productId?: string;
  stockBatchId?: string;
  movementType?: StockMovementType;
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize?: number;
};

/**
 * Kartu stok — daftar StockMovement (ledger append-only) dengan filter.
 * Diurutkan occurredAt DESC (terbaru dulu) agar aktivitas terkini langsung
 * terlihat.
 */
export async function listMovementsPaginated(query: MovementListQuery) {
  const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;
  const branchIds = resolveEffectiveBranchIds(query.allowedBranchIds, query.branchId);

  const where: Prisma.StockMovementWhereInput = {
    companyId: query.companyId,
    branchId: { in: branchIds },
    productId: query.productId,
    stockBatchId: query.stockBatchId,
    movementType: query.movementType,
    occurredAt:
      query.dateFrom || query.dateTo
        ? { gte: query.dateFrom, lte: query.dateTo }
        : undefined,
  };

  const [data, totalCount] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      include: {
        product: { select: { id: true, sku: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        stockBatch: { select: { id: true, batchNumber: true, expiryDate: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { occurredAt: "desc" },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stockMovement.count({ where }),
  ]);

  return { data, totalCount };
}
