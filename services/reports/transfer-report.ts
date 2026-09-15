import { StockTransferStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { branchScopeWhere } from "@/services/stock-transfer-service";

const PENDING_STATUSES: StockTransferStatus[] = [
  StockTransferStatus.REQUESTED,
  StockTransferStatus.APPROVED,
  StockTransferStatus.SHIPPED,
];

/**
 * Transfer yang masih "in-transit/pending" (REQUESTED/APPROVED belum
 * dikirim, SHIPPED sedang dalam perjalanan) — dipakai widget dashboard
 * (lihat docs/TRANSFER.md poin 4 untuk semantik stok in-transit).
 */
export async function listPendingTransfers(params: {
  companyId: string;
  allowedBranchIds: string[];
  branchId?: string;
  limit?: number;
}) {
  // `branchId` (bila diisi) mempersempit HASIL, bukan menggantikan
  // `allowedBranchIds` — jika langsung dipakai sendiri tanpa di-AND-kan,
  // pemanggil yang lupa memvalidasi `branchId` di lapisan atas bisa
  // menembus batasan akses cabangnya sendiri. Pola sama seperti
  // `listTransfersPaginated` di services/stock-transfer-service.ts.
  const scoped = branchScopeWhere(params.allowedBranchIds);
  const requestedScope = params.branchId
    ? { OR: [{ sourceBranchId: params.branchId }, { destinationBranchId: params.branchId }] }
    : undefined;

  return prisma.stockTransfer.findMany({
    where: {
      companyId: params.companyId,
      status: { in: PENDING_STATUSES },
      AND: requestedScope ? [scoped, requestedScope] : [scoped],
    },
    include: {
      sourceBranch: { select: { code: true, name: true } },
      destinationBranch: { select: { code: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: params.limit,
  });
}
