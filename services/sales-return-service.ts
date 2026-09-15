import {
  PosTransactionStatus,
  Prisma,
  SalesReturnItemCondition,
  StockBatchStatus,
  type Role,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { recordAudit } from "@/services/audit-service";
import { receiveStockToBatch, receiveStockToExistingBatch } from "@/services/stock-ledger";

const RETURNABLE_STATUSES: PosTransactionStatus[] = [
  PosTransactionStatus.PAID,
  PosTransactionStatus.PARTIALLY_RETURNED,
];

/**
 * Ringkasan sisa qty yang dapat diretur PER alokasi asal (bukan hanya per
 * item — satu item yang dulu di-split FEFO ke >1 batch punya sisa
 * returnable independen per batch), dipakai UI form retur. `returnable`
 * = `qtyOut` alokasi dikurangi total `SalesReturnItem.qtyReturned` yang
 * sudah tercatat untuk alokasi tsb dari retur manapun sebelumnya.
 */
export async function getReturnableSummary(allowedBranchIds: string[], posTransactionId: string) {
  const transaction = await prisma.posTransaction.findFirst({
    where: { id: posTransactionId, branchId: { in: allowedBranchIds } },
    include: {
      branch: { select: { code: true, name: true } },
      items: {
        include: {
          product: { select: { sku: true, name: true } },
          allocations: {
            include: { returnItems: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  if (!transaction) return null;

  const items = transaction.items.map((item) => {
    const allocations = item.allocations.map((allocation) => {
      const alreadyReturned = allocation.returnItems.reduce(
        (sum, ri) => sum.plus(ri.qtyReturned),
        new Prisma.Decimal(0),
      );
      const returnable = allocation.qtyOut.minus(alreadyReturned);
      return {
        allocationId: allocation.id,
        batchNumberSnapshot: allocation.batchNumberSnapshot,
        qtyOut: allocation.qtyOut,
        alreadyReturned,
        returnable,
      };
    });
    const totalReturnable = allocations.reduce(
      (sum, a) => sum.plus(a.returnable),
      new Prisma.Decimal(0),
    );
    return {
      itemId: item.id,
      productSku: item.product.sku,
      productName: item.product.name,
      qty: item.qty,
      totalReturnable,
      allocations,
    };
  });

  return { transaction, items };
}

export type SalesReturnItemInput = {
  posTransactionItemId: string;
  qty: number;
  condition: SalesReturnItemCondition;
};

/**
 * Proses retur penjualan (Fase 09). Untuk tiap item diminta, serap qty
 * secara berurutan lintas alokasi asal item itu (urutan `createdAt ASC`,
 * mirror urutan alokasi FEFO saat penjualan) — bila total diminta melebihi
 * total returnable, SELURUH retur ditolak (atomic, tidak ada perubahan
 * parsial, lihat pembungkus `$transaction`).
 *
 * `SELLABLE` mengembalikan stok ke batch ASAL apa adanya. `DAMAGED`/
 * `QUARANTINE` dialihkan ke batch SEGREGASI terpisah (identitas stabil:
 * `<batchNumberSnapshot>-RETURN-<condition>`, status DAMAGED/QUARANTINED)
 * supaya TIDAK diam-diam menambah saldo yang bisa dijual — lihat
 * docs/PRESCRIPTION_VOID_RETURN.md.
 */
export async function createSalesReturn(params: {
  companyId: string;
  allowedBranchIds: string[];
  posTransactionId: string;
  actorId: string;
  actorRole: Role;
  reason: string;
  items: SalesReturnItemInput[];
}) {
  if (!hasPermission(params.actorRole, "pos.sell")) {
    throw new Error("Anda tidak memiliki izin untuk memproses retur penjualan.");
  }
  if (!params.reason.trim()) {
    throw new Error("Alasan retur wajib diisi.");
  }
  if (params.items.length === 0) {
    throw new Error("Minimal satu item retur wajib diisi.");
  }

  return prisma.$transaction(async (tx) => {
    const transaction = await tx.posTransaction.findFirst({
      where: { id: params.posTransactionId, branchId: { in: params.allowedBranchIds } },
      include: {
        items: {
          include: {
            product: { select: { name: true } },
            allocations: {
              include: { returnItems: true },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });
    if (!transaction) {
      throw new Error("Transaksi tidak ditemukan atau di luar akses cabang Anda.");
    }
    if (!RETURNABLE_STATUSES.includes(transaction.status)) {
      throw new Error(
        `Transaksi berstatus ${transaction.status}, tidak dapat diretur.`,
      );
    }

    const itemMap = new Map(transaction.items.map((item) => [item.id, item]));

    const salesReturn = await tx.salesReturn.create({
      data: {
        companyId: params.companyId,
        branchId: transaction.branchId,
        posTransactionId: transaction.id,
        reason: params.reason.trim(),
        createdById: params.actorId,
      },
    });

    for (const requested of params.items) {
      if (requested.qty <= 0) {
        throw new Error("Qty retur harus lebih dari 0.");
      }
      const item = itemMap.get(requested.posTransactionItemId);
      if (!item) {
        throw new Error("Item transaksi tidak ditemukan pada invoice ini.");
      }

      let remaining = new Prisma.Decimal(requested.qty.toString());

      for (const allocation of item.allocations) {
        if (remaining.lessThanOrEqualTo(0)) break;

        const alreadyReturned = allocation.returnItems.reduce(
          (sum, ri) => sum.plus(ri.qtyReturned),
          new Prisma.Decimal(0),
        );
        const returnable = allocation.qtyOut.minus(alreadyReturned);
        if (returnable.lessThanOrEqualTo(0)) continue;

        const take = returnable.lessThan(remaining) ? returnable : remaining;

        const sourceBatch = await tx.stockBatch.findUniqueOrThrow({
          where: { id: allocation.stockBatchId },
        });

        let destinationStockBatchId: string;
        if (requested.condition === SalesReturnItemCondition.SELLABLE) {
          await receiveStockToExistingBatch(tx, {
            stockBatchId: sourceBatch.id,
            qty: take,
            movementType: "SALES_RETURN",
            referenceType: "SalesReturn",
            referenceId: salesReturn.id,
            createdById: params.actorId,
            notes: `Retur invoice ${transaction.documentNumber}`,
          });
          destinationStockBatchId = sourceBatch.id;
        } else {
          const segregatedStatus =
            requested.condition === SalesReturnItemCondition.DAMAGED
              ? StockBatchStatus.DAMAGED
              : StockBatchStatus.QUARANTINED;
          const received = await receiveStockToBatch(tx, {
            companyId: sourceBatch.companyId,
            branchId: sourceBatch.branchId,
            warehouseId: sourceBatch.warehouseId,
            productId: sourceBatch.productId,
            batchNumber: `${allocation.batchNumberSnapshot}-RETURN-${requested.condition}`,
            expiryDate: allocation.expiryDateSnapshot,
            receivedDate: new Date(),
            unitCost: allocation.unitCostSnapshot,
            qty: take,
            movementType: "SALES_RETURN",
            referenceType: "SalesReturn",
            referenceId: salesReturn.id,
            createdById: params.actorId,
            notes: `Retur invoice ${transaction.documentNumber} (${requested.condition})`,
            status: segregatedStatus,
          });
          destinationStockBatchId = received.batchId;
        }

        await tx.salesReturnItem.create({
          data: {
            salesReturnId: salesReturn.id,
            posTransactionItemId: item.id,
            sourceAllocationId: allocation.id,
            qtyReturned: take.toString(),
            condition: requested.condition,
            destinationStockBatchId,
          },
        });

        remaining = remaining.minus(take);
      }

      if (remaining.greaterThan(0)) {
        throw new Error(
          `Qty retur untuk "${item.product.name}" melebihi sisa yang dapat diretur (kurang ${remaining.toString()}).`,
        );
      }
    }

    const itemsWithReturns = await tx.posTransactionItem.findMany({
      where: { posTransactionId: transaction.id },
      include: { salesReturnItems: true },
    });

    const allFullyReturned = itemsWithReturns.every((item) => {
      const totalReturned = item.salesReturnItems.reduce(
        (sum, ri) => sum.plus(ri.qtyReturned),
        new Prisma.Decimal(0),
      );
      return totalReturned.greaterThanOrEqualTo(item.qty);
    });

    await tx.posTransaction.update({
      where: { id: transaction.id },
      data: {
        status: allFullyReturned
          ? PosTransactionStatus.RETURNED
          : PosTransactionStatus.PARTIALLY_RETURNED,
      },
    });

    await recordAudit(
      {
        companyId: params.companyId,
        branchId: transaction.branchId,
        actorId: params.actorId,
        action: "PROCESS_SALES_RETURN",
        entityType: "PosTransaction",
        entityId: transaction.id,
        reason: params.reason.trim(),
        newValue: { salesReturnId: salesReturn.id, documentNumber: transaction.documentNumber },
      },
      tx,
    );

    return tx.salesReturn.findUniqueOrThrow({
      where: { id: salesReturn.id },
      include: { items: true },
    });
  });
}
