import { AdjustmentDirection, Prisma, StockDocumentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { createWithSequentialNumber } from "@/lib/document-number";
import { recordAudit } from "@/services/audit-service";
import {
  deductStockFromBatch,
  receiveStockToExistingBatch,
} from "@/services/stock-ledger";

function resolveEffectiveBranchIds(
  allowedBranchIds: string[],
  requestedBranchId?: string,
): string[] {
  if (!requestedBranchId) return allowedBranchIds;
  return allowedBranchIds.includes(requestedBranchId) ? [requestedBranchId] : [];
}

export type AdjustmentListQuery = {
  companyId: string;
  allowedBranchIds: string[];
  branchId?: string;
  status?: StockDocumentStatus;
  page: number;
  pageSize?: number;
};

export async function listAdjustmentsPaginated(query: AdjustmentListQuery) {
  const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;
  const branchIds = resolveEffectiveBranchIds(query.allowedBranchIds, query.branchId);

  const where: Prisma.StockAdjustmentWhereInput = {
    companyId: query.companyId,
    branchId: { in: branchIds },
    status: query.status,
  };

  const [data, totalCount] = await Promise.all([
    prisma.stockAdjustment.findMany({
      where,
      include: {
        branch: { select: { code: true, name: true } },
        createdBy: { select: { name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stockAdjustment.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getAdjustmentById(allowedBranchIds: string[], id: string) {
  return prisma.stockAdjustment.findFirst({
    where: { id, branchId: { in: allowedBranchIds } },
    include: {
      branch: { select: { code: true, name: true } },
      createdBy: { select: { name: true } },
      postedBy: { select: { name: true } },
      items: {
        include: {
          batch: {
            select: {
              batchNumber: true,
              expiryDate: true,
              qtyOnHand: true,
              product: { select: { sku: true, name: true } },
            },
          },
        },
      },
    },
  });
}

export type CreateAdjustmentItemInput = {
  stockBatchId: string;
  direction: AdjustmentDirection;
  qty: number | string;
};

export type CreateAdjustmentParams = {
  companyId: string;
  branchId: string;
  reason: string;
  createdById: string;
  items: CreateAdjustmentItemInput[];
};

/**
 * Buat dokumen adjustment berstatus DRAFT. Belum mengubah stok apa pun —
 * perubahan stok baru terjadi saat postAdjustment() dipanggil.
 *
 * Setiap `stockBatchId` item WAJIB divalidasi milik `companyId`+`branchId`
 * dokumen ini SEBELUM dibuat (Fase 11 hardening) — tanpa ini, item bisa
 * merujuk batch cabang/company LAIN (dokumen sendiri lolos branch-access
 * check, tapi batch di dalamnya tidak pernah dicek), yang saat diposting
 * akan mengubah `qtyOnHand` batch tsb walau dokumennya "milik" cabang yang
 * berbeda. Pola sama seperti `buildItemsCreateData` di
 * services/stock-transfer-service.ts.
 */
export async function createDraftAdjustment(params: CreateAdjustmentParams) {
  if (params.items.length === 0) {
    throw new Error("Adjustment harus memiliki minimal satu item.");
  }
  if (!params.reason.trim()) {
    throw new Error("Alasan adjustment wajib diisi.");
  }

  const batches = await prisma.stockBatch.findMany({
    where: { id: { in: params.items.map((item) => item.stockBatchId) } },
  });
  const batchMap = new Map(batches.map((b) => [b.id, b]));
  for (const item of params.items) {
    const batch = batchMap.get(item.stockBatchId);
    if (!batch || batch.companyId !== params.companyId || batch.branchId !== params.branchId) {
      throw new Error("Batch yang dipilih tidak ditemukan pada cabang ini.");
    }
  }

  return createWithSequentialNumber({
    prefix: "ADJ",
    countExisting: () =>
      prisma.stockAdjustment.count({ where: { companyId: params.companyId } }),
    attemptCreate: (documentNumber) =>
      prisma.stockAdjustment.create({
        data: {
          companyId: params.companyId,
          branchId: params.branchId,
          documentNumber,
          reason: params.reason,
          createdById: params.createdById,
          items: {
            create: params.items.map((item) => ({
              stockBatchId: item.stockBatchId,
              direction: item.direction,
              qty: item.qty.toString(),
            })),
          },
        },
        include: { items: true },
      }),
  });
}

/**
 * Posting adjustment: untuk setiap item, panggil primitif ledger yang
 * sesuai (IN -> receiveStockToExistingBatch, OUT -> deductStockFromBatch —
 * yang otomatis menolak bila qty OUT melebihi saldo batch atau batch tidak
 * AVAILABLE). Seluruh item + perubahan status dokumen + audit log berjalan
 * dalam SATU transaction — gagal di tengah jalan berarti semuanya rollback,
 * dokumen tetap DRAFT dan stok tidak berubah sama sekali (all-or-nothing).
 */
export async function postAdjustment(params: {
  companyId: string;
  allowedBranchIds: string[];
  id: string;
  postedById: string;
}) {
  return prisma.$transaction(async (tx) => {
    const adjustment = await tx.stockAdjustment.findFirst({
      where: {
        id: params.id,
        companyId: params.companyId,
        branchId: { in: params.allowedBranchIds },
      },
      include: { items: true },
    });
    if (!adjustment) {
      throw new Error("Adjustment tidak ditemukan atau di luar akses cabang Anda.");
    }
    if (adjustment.status !== StockDocumentStatus.DRAFT) {
      throw new Error("Hanya dokumen berstatus DRAFT yang dapat diposting.");
    }

    for (const item of adjustment.items) {
      if (item.direction === AdjustmentDirection.IN) {
        await receiveStockToExistingBatch(tx, {
          stockBatchId: item.stockBatchId,
          qty: item.qty,
          movementType: "STOCK_ADJUSTMENT_IN",
          referenceType: "StockAdjustment",
          referenceId: adjustment.id,
          createdById: params.postedById,
          notes: adjustment.reason,
        });
      } else {
        await deductStockFromBatch(tx, {
          stockBatchId: item.stockBatchId,
          qty: item.qty,
          movementType: "STOCK_ADJUSTMENT_OUT",
          referenceType: "StockAdjustment",
          referenceId: adjustment.id,
          createdById: params.postedById,
          notes: adjustment.reason,
        });
      }
    }

    const posted = await tx.stockAdjustment.update({
      where: { id: adjustment.id },
      data: {
        status: StockDocumentStatus.POSTED,
        postedAt: new Date(),
        postedById: params.postedById,
      },
    });

    await recordAudit(
      {
        companyId: adjustment.companyId,
        branchId: adjustment.branchId,
        actorId: params.postedById,
        action: "POST",
        entityType: "StockAdjustment",
        entityId: adjustment.id,
        newValue: {
          documentNumber: adjustment.documentNumber,
          itemCount: adjustment.items.length,
        },
        reason: adjustment.reason,
      },
      tx,
    );

    return posted;
  });
}
