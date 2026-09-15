import { Prisma, StockBatchStatus, StockTransferStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { createWithSequentialNumber } from "@/lib/document-number";
import { recordAudit } from "@/services/audit-service";
import { deductStockFromBatch, receiveStockToBatch } from "@/services/stock-ledger";

/**
 * Transfer melibatkan DUA cabang (asal & tujuan) — berbeda dari dokumen
 * lain (PurchaseReceipt, StockAdjustment, dst.) yang cukup satu `branchId`.
 * User boleh melihat/memproses transfer bila salah satu sisi ada di
 * `allowedBranchIds`-nya; aksi spesifik (approve/ship vs receive) tetap
 * digerbangi ulang ke sisi yang benar di masing-masing fungsi mutasi.
 */
export function branchScopeWhere(allowedBranchIds: string[]): Prisma.StockTransferWhereInput {
  return {
    OR: [
      { sourceBranchId: { in: allowedBranchIds } },
      { destinationBranchId: { in: allowedBranchIds } },
    ],
  };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export type TransferListQuery = {
  companyId: string;
  allowedBranchIds: string[];
  branchId?: string;
  status?: StockTransferStatus;
  /** Fase 10: filter `createdAt` opsional, dipakai laporan
   * `/reports/transfers` — tidak memengaruhi pemanggil lama yang tidak
   * mengirim field ini (mis. halaman `/inventory/transfers`). */
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize?: number;
};

export async function listTransfersPaginated(query: TransferListQuery) {
  const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;

  const scoped = branchScopeWhere(query.allowedBranchIds);
  const createdAt =
    query.dateFrom || query.dateTo
      ? { gte: query.dateFrom, lte: query.dateTo }
      : undefined;
  const where: Prisma.StockTransferWhereInput = query.branchId
    ? {
        companyId: query.companyId,
        status: query.status,
        createdAt,
        AND: [scoped, { OR: [{ sourceBranchId: query.branchId }, { destinationBranchId: query.branchId }] }],
      }
    : { companyId: query.companyId, status: query.status, createdAt, ...scoped };

  const [data, totalCount] = await Promise.all([
    prisma.stockTransfer.findMany({
      where,
      include: {
        sourceBranch: { select: { code: true, name: true } },
        destinationBranch: { select: { code: true, name: true } },
        createdBy: { select: { name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stockTransfer.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getTransferById(allowedBranchIds: string[], id: string) {
  return prisma.stockTransfer.findFirst({
    where: { id, ...branchScopeWhere(allowedBranchIds) },
    include: {
      sourceBranch: { select: { code: true, name: true } },
      destinationBranch: { select: { code: true, name: true } },
      createdBy: { select: { name: true } },
      requestedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      rejectedBy: { select: { name: true } },
      shippedBy: { select: { name: true } },
      receivedBy: { select: { name: true } },
      cancelledBy: { select: { name: true } },
      items: {
        include: {
          product: { select: { sku: true, name: true } },
          sourceStockBatch: { select: { batchNumber: true } },
          destinationStockBatch: { select: { id: true, batchNumber: true, branchId: true } },
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Create / update draft
// ---------------------------------------------------------------------------

export type TransferItemInput = {
  productId: string;
  sourceStockBatchId: string;
  qtyRequested: number;
  notes?: string;
};

export type CreateTransferParams = {
  companyId: string;
  sourceBranchId: string;
  destinationBranchId: string;
  notes?: string;
  createdById: string;
  items: TransferItemInput[];
};

/**
 * Validasi & bangun data item transfer: batch harus milik cabang+produk
 * ASAL yang dipilih, AVAILABLE, belum lewat ED, qtyRequested > 0 dan
 * (soft-check) tidak melebihi qtyOnHand batch saat ini — hard-check atomic
 * yang sesungguhnya ada di `shipTransfer` (lewat `deductStockFromBatch`).
 */
async function buildItemsCreateData(
  client: Prisma.TransactionClient | typeof prisma,
  sourceBranchId: string,
  items: TransferItemInput[],
) {
  if (items.length === 0) {
    throw new Error("Transfer harus memiliki minimal satu item.");
  }

  const batches = await client.stockBatch.findMany({
    where: { id: { in: items.map((i) => i.sourceStockBatchId) } },
  });
  const batchMap = new Map(batches.map((b) => [b.id, b]));

  return items.map((item) => {
    if (item.qtyRequested <= 0) {
      throw new Error("Qty yang diminta harus lebih dari 0.");
    }
    const batch = batchMap.get(item.sourceStockBatchId);
    if (!batch || batch.branchId !== sourceBranchId || batch.productId !== item.productId) {
      throw new Error("Batch yang dipilih tidak ditemukan pada cabang/produk asal.");
    }
    if (batch.status !== StockBatchStatus.AVAILABLE) {
      throw new Error(`Batch "${batch.batchNumber}" berstatus ${batch.status}, tidak dapat ditransfer.`);
    }
    if (batch.expiryDate.getTime() < Date.now()) {
      throw new Error(`Batch "${batch.batchNumber}" sudah melewati ED, tidak dapat ditransfer.`);
    }
    if (new Prisma.Decimal(item.qtyRequested).greaterThan(batch.qtyOnHand)) {
      throw new Error(
        `Qty diminta untuk batch "${batch.batchNumber}" melebihi saldo (tersedia ${batch.qtyOnHand.toString()}).`,
      );
    }

    return {
      productId: item.productId,
      sourceStockBatchId: item.sourceStockBatchId,
      sourceBatchNumberSnapshot: batch.batchNumber,
      expiryDateSnapshot: batch.expiryDate,
      unitCostSnapshot: batch.unitCost,
      qtyRequested: item.qtyRequested.toString(),
      notes: item.notes?.trim() || null,
    };
  });
}

export async function createDraftTransfer(params: CreateTransferParams) {
  if (params.sourceBranchId === params.destinationBranchId) {
    throw new Error("Cabang asal dan cabang tujuan tidak boleh sama.");
  }

  const itemsCreateData = await buildItemsCreateData(prisma, params.sourceBranchId, params.items);

  const transfer = await createWithSequentialNumber({
    prefix: "TRF",
    countExisting: () => prisma.stockTransfer.count({ where: { companyId: params.companyId } }),
    attemptCreate: (documentNumber) =>
      prisma.stockTransfer.create({
        data: {
          companyId: params.companyId,
          sourceBranchId: params.sourceBranchId,
          destinationBranchId: params.destinationBranchId,
          documentNumber,
          notes: params.notes?.trim() || null,
          createdById: params.createdById,
          items: { create: itemsCreateData },
        },
        include: { items: true },
      }),
  });

  await recordAudit({
    companyId: params.companyId,
    branchId: params.sourceBranchId,
    actorId: params.createdById,
    action: "CREATE",
    entityType: "StockTransfer",
    entityId: transfer.id,
    newValue: {
      documentNumber: transfer.documentNumber,
      sourceBranchId: params.sourceBranchId,
      destinationBranchId: params.destinationBranchId,
      itemCount: transfer.items.length,
    },
  });

  return transfer;
}

export type UpdateTransferParams = Omit<CreateTransferParams, "companyId" | "createdById"> & {
  id: string;
  companyId: string;
  allowedBranchIds: string[];
};

/**
 * Update dokumen DRAFT: header + full-replace item, hanya bila status
 * masih DRAFT — pola sama `updateDraftReceipt`
 * (services/purchase-receipt-service.ts).
 */
export async function updateDraftTransfer(params: UpdateTransferParams) {
  if (params.sourceBranchId === params.destinationBranchId) {
    throw new Error("Cabang asal dan cabang tujuan tidak boleh sama.");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.stockTransfer.findFirst({
      where: { id: params.id, companyId: params.companyId, ...branchScopeWhere(params.allowedBranchIds) },
    });
    if (!existing) {
      throw new Error("Transfer tidak ditemukan atau di luar akses cabang Anda.");
    }
    if (existing.status !== StockTransferStatus.DRAFT) {
      throw new Error("Hanya dokumen berstatus DRAFT yang dapat diedit.");
    }

    const itemsCreateData = await buildItemsCreateData(tx, params.sourceBranchId, params.items);

    await tx.stockTransferItem.deleteMany({ where: { transferId: existing.id } });

    const updated = await tx.stockTransfer.update({
      where: { id: existing.id },
      data: {
        sourceBranchId: params.sourceBranchId,
        destinationBranchId: params.destinationBranchId,
        notes: params.notes?.trim() || null,
        items: { create: itemsCreateData },
      },
      include: { items: true },
    });

    await recordAudit(
      {
        companyId: params.companyId,
        branchId: params.sourceBranchId,
        actorId: existing.createdById,
        action: "UPDATE",
        entityType: "StockTransfer",
        entityId: updated.id,
        newValue: {
          documentNumber: updated.documentNumber,
          sourceBranchId: params.sourceBranchId,
          destinationBranchId: params.destinationBranchId,
          itemCount: updated.items.length,
        },
      },
      tx,
    );

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Transisi status
// ---------------------------------------------------------------------------

async function findTransferForAction(
  tx: Prisma.TransactionClient,
  params: { id: string; allowedBranchIds: string[] },
) {
  const transfer = await tx.stockTransfer.findFirst({
    where: { id: params.id, ...branchScopeWhere(params.allowedBranchIds) },
    include: { items: true },
  });
  if (!transfer) {
    throw new Error("Transfer tidak ditemukan atau di luar akses cabang Anda.");
  }
  return transfer;
}

function assertSourceBranchAccess(transfer: { sourceBranchId: string }, allowedBranchIds: string[]) {
  if (!allowedBranchIds.includes(transfer.sourceBranchId)) {
    throw new Error("Hanya cabang asal yang dapat melakukan aksi ini.");
  }
}

function assertDestinationBranchAccess(
  transfer: { destinationBranchId: string },
  allowedBranchIds: string[],
) {
  if (!allowedBranchIds.includes(transfer.destinationBranchId)) {
    throw new Error("Hanya cabang tujuan yang dapat melakukan aksi ini.");
  }
}

export async function submitTransferRequest(params: {
  allowedBranchIds: string[];
  id: string;
  actorId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const transfer = await findTransferForAction(tx, params);
    if (transfer.status !== StockTransferStatus.DRAFT) {
      throw new Error("Hanya dokumen berstatus DRAFT yang dapat diajukan.");
    }
    if (transfer.items.length === 0) {
      throw new Error("Transfer tidak memiliki item untuk diajukan.");
    }

    const updated = await tx.stockTransfer.update({
      where: { id: transfer.id },
      data: {
        status: StockTransferStatus.REQUESTED,
        requestedById: params.actorId,
        requestedAt: new Date(),
      },
    });

    await recordAudit(
      {
        companyId: transfer.companyId,
        branchId: transfer.destinationBranchId,
        actorId: params.actorId,
        action: "SUBMIT_TRANSFER",
        entityType: "StockTransfer",
        entityId: transfer.id,
        newValue: { documentNumber: transfer.documentNumber },
      },
      tx,
    );

    return updated;
  });
}

export async function approveTransferRequest(params: {
  allowedBranchIds: string[];
  id: string;
  actorId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const transfer = await findTransferForAction(tx, params);
    assertSourceBranchAccess(transfer, params.allowedBranchIds);
    if (transfer.status !== StockTransferStatus.REQUESTED) {
      throw new Error("Hanya dokumen berstatus REQUESTED yang dapat disetujui.");
    }

    const updated = await tx.stockTransfer.update({
      where: { id: transfer.id },
      data: {
        status: StockTransferStatus.APPROVED,
        approvedById: params.actorId,
        approvedAt: new Date(),
      },
    });

    await recordAudit(
      {
        companyId: transfer.companyId,
        branchId: transfer.sourceBranchId,
        actorId: params.actorId,
        action: "APPROVE_TRANSFER",
        entityType: "StockTransfer",
        entityId: transfer.id,
        newValue: { documentNumber: transfer.documentNumber },
      },
      tx,
    );

    return updated;
  });
}

export async function rejectTransferRequest(params: {
  allowedBranchIds: string[];
  id: string;
  actorId: string;
  reason: string;
}) {
  if (!params.reason.trim()) {
    throw new Error("Alasan penolakan wajib diisi.");
  }

  return prisma.$transaction(async (tx) => {
    const transfer = await findTransferForAction(tx, params);
    assertSourceBranchAccess(transfer, params.allowedBranchIds);
    if (transfer.status !== StockTransferStatus.REQUESTED) {
      throw new Error("Hanya dokumen berstatus REQUESTED yang dapat ditolak.");
    }

    const updated = await tx.stockTransfer.update({
      where: { id: transfer.id },
      data: {
        status: StockTransferStatus.REJECTED,
        rejectedById: params.actorId,
        rejectedAt: new Date(),
        rejectionReason: params.reason.trim(),
      },
    });

    await recordAudit(
      {
        companyId: transfer.companyId,
        branchId: transfer.sourceBranchId,
        actorId: params.actorId,
        action: "REJECT_TRANSFER",
        entityType: "StockTransfer",
        entityId: transfer.id,
        reason: params.reason.trim(),
        newValue: { documentNumber: transfer.documentNumber },
      },
      tx,
    );

    return updated;
  });
}

export type ShipItemOverride = { itemId: string; qty: number };

/**
 * Kirim: kurangi saldo batch ASAL per item (deductStockFromBatch, atomic —
 * lihat services/stock-ledger.ts) + StockMovement TRANSFER_OUT. Qty yang
 * dikirim default `qtyRequested`, bisa diturunkan lewat `itemOverrides`
 * (mis. stok fisik ternyata kurang dari yang diminta). Gagal pada item mana
 * pun (termasuk stok tidak cukup) membatalkan SELURUH pengiriman — tidak
 * ada movement/qty yang berubah parsial (pola sama
 * purchase-receipt-service.ts::postReceipt & pos-transaction-service.ts::
 * createPaidTransaction).
 */
export async function shipTransfer(params: {
  allowedBranchIds: string[];
  id: string;
  actorId: string;
  itemOverrides?: ShipItemOverride[];
}) {
  return prisma.$transaction(async (tx) => {
    const transfer = await findTransferForAction(tx, params);
    assertSourceBranchAccess(transfer, params.allowedBranchIds);
    if (transfer.status !== StockTransferStatus.APPROVED) {
      throw new Error("Hanya dokumen berstatus APPROVED yang dapat dikirim.");
    }

    const overrideMap = new Map((params.itemOverrides ?? []).map((o) => [o.itemId, o.qty]));

    for (const item of transfer.items) {
      const qtyShipped = overrideMap.get(item.id) ?? Number(item.qtyRequested);
      if (qtyShipped <= 0) {
        throw new Error("Qty yang dikirim harus lebih dari 0.");
      }

      await deductStockFromBatch(tx, {
        stockBatchId: item.sourceStockBatchId,
        qty: qtyShipped,
        movementType: "TRANSFER_OUT",
        referenceType: "StockTransfer",
        referenceId: transfer.id,
        createdById: params.actorId,
      });

      await tx.stockTransferItem.update({
        where: { id: item.id },
        data: { qtyShipped: qtyShipped.toString() },
      });
    }

    const updated = await tx.stockTransfer.update({
      where: { id: transfer.id },
      data: {
        status: StockTransferStatus.SHIPPED,
        shippedById: params.actorId,
        shippedAt: new Date(),
      },
    });

    await recordAudit(
      {
        companyId: transfer.companyId,
        branchId: transfer.sourceBranchId,
        actorId: params.actorId,
        action: "SHIP_TRANSFER",
        entityType: "StockTransfer",
        entityId: transfer.id,
        newValue: { documentNumber: transfer.documentNumber, itemCount: transfer.items.length },
      },
      tx,
    );

    return updated;
  });
}

export type ReceiveItemInput = { itemId: string; qtyReceived: number; discrepancyReason?: string };

/**
 * Terima: tambahkan stok ke batch TUJUAN per item (receiveStockToBatch,
 * find-or-create by batchNumber — lihat services/stock-ledger.ts) memakai
 * PERSIS batchNumber/expiryDate/unitCost snapshot dari batch asal (inilah
 * yang membuat identitas batch "ikut" pindah cabang — genealogy lewat
 * sourceStockBatchId + destinationStockBatchId) + StockMovement
 * TRANSFER_IN. qtyReceived boleh kurang dari qtyShipped (selisih WAJIB
 * disertai discrepancyReason) tapi TIDAK boleh melebihinya. Status akhir
 * ditentukan dari agregat seluruh item: RECEIVED bila semua item diterima
 * penuh, PARTIALLY_RECEIVED bila ada yang kurang. Ini aksi SEKALI JALAN
 * (bukan sesi penerimaan bertahap) — sejalan dengan larangan membangun
 * modul retur/susulan pada fase ini.
 */
export async function receiveTransfer(params: {
  allowedBranchIds: string[];
  id: string;
  actorId: string;
  items: ReceiveItemInput[];
}) {
  return prisma.$transaction(async (tx) => {
    const transfer = await findTransferForAction(tx, params);
    assertDestinationBranchAccess(transfer, params.allowedBranchIds);
    if (transfer.status !== StockTransferStatus.SHIPPED) {
      throw new Error("Hanya dokumen berstatus SHIPPED yang dapat diterima.");
    }

    const warehouse = await tx.warehouse.findFirst({
      where: { branchId: transfer.destinationBranchId, isDefault: true, isActive: true },
    });
    if (!warehouse) {
      throw new Error("Cabang tujuan belum memiliki warehouse default yang aktif.");
    }

    const receiptMap = new Map(params.items.map((i) => [i.itemId, i]));
    let allFullyReceived = true;

    for (const item of transfer.items) {
      const receipt = receiptMap.get(item.id);
      if (!receipt) {
        throw new Error("Semua item wajib diisi qty yang diterima.");
      }

      const qtyShipped = new Prisma.Decimal((item.qtyShipped ?? 0).toString());
      const qtyReceived = new Prisma.Decimal(receipt.qtyReceived.toString());

      if (qtyReceived.lessThan(0)) {
        throw new Error("Qty yang diterima tidak boleh negatif.");
      }
      if (qtyReceived.greaterThan(qtyShipped)) {
        throw new Error(
          `Qty diterima untuk produk ini (${qtyReceived.toString()}) tidak boleh melebihi qty dikirim (${qtyShipped.toString()}).`,
        );
      }
      if (qtyReceived.lessThan(qtyShipped) && !receipt.discrepancyReason?.trim()) {
        throw new Error("Alasan selisih wajib diisi bila qty yang diterima kurang dari qty yang dikirim.");
      }
      if (qtyReceived.lessThan(qtyShipped)) {
        allFullyReceived = false;
      }

      let destinationStockBatchId: string | null = null;
      if (qtyReceived.greaterThan(0)) {
        const received = await receiveStockToBatch(tx, {
          companyId: transfer.companyId,
          branchId: transfer.destinationBranchId,
          warehouseId: warehouse.id,
          productId: item.productId,
          batchNumber: item.sourceBatchNumberSnapshot,
          expiryDate: item.expiryDateSnapshot,
          receivedDate: new Date(),
          unitCost: item.unitCostSnapshot,
          qty: qtyReceived,
          movementType: "TRANSFER_IN",
          referenceType: "StockTransfer",
          referenceId: transfer.id,
          createdById: params.actorId,
        });
        destinationStockBatchId = received.batchId;
      }

      await tx.stockTransferItem.update({
        where: { id: item.id },
        data: {
          qtyReceived: qtyReceived.toString(),
          destinationStockBatchId,
          discrepancyReason: receipt.discrepancyReason?.trim() || null,
        },
      });
    }

    const finalStatus = allFullyReceived
      ? StockTransferStatus.RECEIVED
      : StockTransferStatus.PARTIALLY_RECEIVED;

    const updated = await tx.stockTransfer.update({
      where: { id: transfer.id },
      data: {
        status: finalStatus,
        receivedById: params.actorId,
        receivedAt: new Date(),
      },
    });

    await recordAudit(
      {
        companyId: transfer.companyId,
        branchId: transfer.destinationBranchId,
        actorId: params.actorId,
        action: "RECEIVE_TRANSFER",
        entityType: "StockTransfer",
        entityId: transfer.id,
        newValue: { documentNumber: transfer.documentNumber, status: finalStatus },
      },
      tx,
    );

    return updated;
  });
}

/**
 * Batalkan (hanya DRAFT/REQUESTED/APPROVED — SENGAJA tidak boleh setelah
 * SHIPPED, karena stok sudah berpindah fisik dari cabang asal dan MVP ini
 * belum membangun alur retur/reversal penuh; lihat docs/TRANSFER.md).
 */
export async function cancelTransfer(params: {
  allowedBranchIds: string[];
  id: string;
  actorId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const transfer = await findTransferForAction(tx, params);

    const cancellableStatuses: StockTransferStatus[] = [
      StockTransferStatus.DRAFT,
      StockTransferStatus.REQUESTED,
      StockTransferStatus.APPROVED,
    ];
    if (!cancellableStatuses.includes(transfer.status)) {
      throw new Error(
        "Transfer yang sudah SHIPPED tidak dapat dibatalkan — stok sudah berpindah fisik dari cabang asal. Perlu alur retur/reversal yang belum dibangun pada fase ini.",
      );
    }

    const updated = await tx.stockTransfer.update({
      where: { id: transfer.id },
      data: {
        status: StockTransferStatus.CANCELLED,
        cancelledById: params.actorId,
        cancelledAt: new Date(),
      },
    });

    await recordAudit(
      {
        companyId: transfer.companyId,
        branchId: transfer.destinationBranchId,
        actorId: params.actorId,
        action: "CANCEL_TRANSFER",
        entityType: "StockTransfer",
        entityId: transfer.id,
        newValue: { documentNumber: transfer.documentNumber },
      },
      tx,
    );

    return updated;
  });
}
