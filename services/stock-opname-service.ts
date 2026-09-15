import { Prisma, StockDocumentStatus } from "@prisma/client";
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

export type OpnameListQuery = {
  companyId: string;
  allowedBranchIds: string[];
  branchId?: string;
  status?: StockDocumentStatus;
  page: number;
  pageSize?: number;
};

export async function listOpnamesPaginated(query: OpnameListQuery) {
  const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;
  const branchIds = resolveEffectiveBranchIds(query.allowedBranchIds, query.branchId);

  const where: Prisma.StockOpnameWhereInput = {
    companyId: query.companyId,
    branchId: { in: branchIds },
    status: query.status,
  };

  const [data, totalCount] = await Promise.all([
    prisma.stockOpname.findMany({
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
    prisma.stockOpname.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getOpnameById(allowedBranchIds: string[], id: string) {
  return prisma.stockOpname.findFirst({
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
              product: { select: { sku: true, name: true } },
            },
          },
        },
      },
    },
  });
}

export type CreateOpnameItemInput = {
  stockBatchId: string;
  countedQty: number | string;
};

export type CreateOpnameParams = {
  companyId: string;
  branchId: string;
  notes?: string;
  createdById: string;
  items: CreateOpnameItemInput[];
};

/**
 * Buat dokumen opname DRAFT. systemQty di-SNAPSHOT dari qtyOnHand batch
 * SAAT DOKUMEN DIBUAT — nilai ini dipakai untuk menghitung selisih
 * (countedQty - systemQty) yang akan diterapkan sebagai movement saat
 * posting. Selisih ini diterapkan sebagai delta terhadap saldo batch yang
 * SEBENARNYA pada saat posting (bukan menimpa qtyOnHand langsung ke
 * countedQty) — sehingga bila ada movement lain yang terjadi di antara
 * create dan post, ledger tetap konsisten (delta yang sama diterapkan
 * secara atomic terhadap saldo terkini, bukan menimpa angka absolut yang
 * berpotensi sudah usang).
 */
export async function createDraftOpname(params: CreateOpnameParams) {
  if (params.items.length === 0) {
    throw new Error("Stock opname harus memiliki minimal satu item.");
  }

  // Batch WAJIB divalidasi milik companyId+branchId dokumen ini (Fase 11
  // hardening) — tanpa ini, item bisa merujuk batch cabang/company LAIN
  // walau dokumen opname-nya sendiri lolos branch-access check. Pola sama
  // seperti buildItemsCreateData di services/stock-transfer-service.ts.
  const batches = await prisma.stockBatch.findMany({
    where: { id: { in: params.items.map((i) => i.stockBatchId) } },
  });
  const batchMap = new Map(batches.map((b) => [b.id, b]));

  return createWithSequentialNumber({
    prefix: "OPN",
    countExisting: () =>
      prisma.stockOpname.count({ where: { companyId: params.companyId } }),
    attemptCreate: (documentNumber) =>
      prisma.stockOpname.create({
        data: {
          companyId: params.companyId,
          branchId: params.branchId,
          documentNumber,
          notes: params.notes,
          createdById: params.createdById,
          items: {
            create: params.items.map((item) => {
              const batch = batchMap.get(item.stockBatchId);
              if (
                !batch ||
                batch.companyId !== params.companyId ||
                batch.branchId !== params.branchId
              ) {
                throw new Error("Batch yang dipilih tidak ditemukan pada cabang ini.");
              }
              return {
                stockBatchId: item.stockBatchId,
                systemQty: batch.qtyOnHand,
                countedQty: item.countedQty.toString(),
              };
            }),
          },
        },
        include: { items: true },
      }),
  });
}

/**
 * Posting opname: untuk tiap item, hitung selisih (countedQty - systemQty
 * snapshot), lalu terapkan sebagai movement STOCK_OPNAME (IN bila lebih,
 * OUT bila kurang) lewat primitif ledger yang sama dipakai Adjustment.
 * Item dengan selisih nol dilewati (tidak menghasilkan movement kosong).
 * Seluruh item + audit log berjalan dalam satu transaction (all-or-nothing).
 */
export async function postOpname(params: {
  companyId: string;
  allowedBranchIds: string[];
  id: string;
  postedById: string;
}) {
  return prisma.$transaction(async (tx) => {
    const opname = await tx.stockOpname.findFirst({
      where: {
        id: params.id,
        companyId: params.companyId,
        branchId: { in: params.allowedBranchIds },
      },
      include: { items: true },
    });
    if (!opname) {
      throw new Error("Stock opname tidak ditemukan atau di luar akses cabang Anda.");
    }
    if (opname.status !== StockDocumentStatus.DRAFT) {
      throw new Error("Hanya dokumen berstatus DRAFT yang dapat diposting.");
    }

    for (const item of opname.items) {
      const diff = new Prisma.Decimal(item.countedQty.toString()).minus(
        item.systemQty.toString(),
      );
      if (diff.isZero()) continue;

      if (diff.greaterThan(0)) {
        await receiveStockToExistingBatch(tx, {
          stockBatchId: item.stockBatchId,
          qty: diff,
          movementType: "STOCK_OPNAME",
          referenceType: "StockOpname",
          referenceId: opname.id,
          createdById: params.postedById,
          notes: opname.notes ?? undefined,
        });
      } else {
        await deductStockFromBatch(tx, {
          stockBatchId: item.stockBatchId,
          qty: diff.abs(),
          movementType: "STOCK_OPNAME",
          referenceType: "StockOpname",
          referenceId: opname.id,
          createdById: params.postedById,
          notes: opname.notes ?? undefined,
        });
      }
    }

    const posted = await tx.stockOpname.update({
      where: { id: opname.id },
      data: {
        status: StockDocumentStatus.POSTED,
        postedAt: new Date(),
        postedById: params.postedById,
      },
    });

    await recordAudit(
      {
        companyId: opname.companyId,
        branchId: opname.branchId,
        actorId: params.postedById,
        action: "POST",
        entityType: "StockOpname",
        entityId: opname.id,
        newValue: {
          documentNumber: opname.documentNumber,
          itemCount: opname.items.length,
        },
        reason: opname.notes ?? undefined,
      },
      tx,
    );

    return posted;
  });
}
