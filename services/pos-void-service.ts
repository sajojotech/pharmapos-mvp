import { PosTransactionStatus, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { recordAudit } from "@/services/audit-service";
import { receiveStockToExistingBatch } from "@/services/stock-ledger";

/**
 * Void satu PosTransaction yang SUDAH PAID (Fase 09). Mengembalikan qty
 * TEPAT ke batch asal alokasi (bukan FEFO baru — alokasi asal itu sendiri
 * yang jadi acuan, lihat docs/PRESCRIPTION_VOID_RETURN.md), menandai semua
 * `Payment` transaksi sebagai `isReversed`, dan mencatat satu `StockMovement
 * VOID_REVERSAL` per baris alokasi (via `receiveStockToExistingBatch`,
 * primitif Fase 04). Permission `pos.void` DICEK ULANG di sini (bukan hanya
 * di action layer) — pola sama `createPaidTransactionWithBatchOverride`
 * Fase 07, karena ini operasi elevated-privilege (Owner/Branch Manager).
 */
export async function voidTransaction(params: {
  allowedBranchIds: string[];
  transactionId: string;
  actorId: string;
  actorRole: Role;
  reason: string;
}) {
  if (!hasPermission(params.actorRole, "pos.void")) {
    throw new Error("Anda tidak memiliki izin untuk void transaksi.");
  }
  if (!params.reason.trim()) {
    throw new Error("Alasan void wajib diisi.");
  }

  return prisma.$transaction(async (tx) => {
    const transaction = await tx.posTransaction.findFirst({
      where: { id: params.transactionId, branchId: { in: params.allowedBranchIds } },
      include: {
        items: { include: { allocations: true } },
      },
    });
    if (!transaction) {
      throw new Error("Transaksi tidak ditemukan atau di luar akses cabang Anda.");
    }
    if (transaction.status !== PosTransactionStatus.PAID) {
      throw new Error(
        `Hanya transaksi berstatus PAID yang dapat di-void (status saat ini: ${transaction.status}).`,
      );
    }

    for (const item of transaction.items) {
      for (const allocation of item.allocations) {
        await receiveStockToExistingBatch(tx, {
          stockBatchId: allocation.stockBatchId,
          qty: allocation.qtyOut,
          movementType: "VOID_REVERSAL",
          referenceType: "PosTransaction",
          referenceId: transaction.id,
          createdById: params.actorId,
          notes: `Void invoice ${transaction.documentNumber}`,
        });
      }
    }

    await tx.payment.updateMany({
      where: { posTransactionId: transaction.id },
      data: { isReversed: true },
    });

    const updated = await tx.posTransaction.update({
      where: { id: transaction.id },
      data: {
        status: PosTransactionStatus.VOIDED,
        voidedAt: new Date(),
        voidedById: params.actorId,
        voidReason: params.reason.trim(),
      },
    });

    await recordAudit(
      {
        companyId: transaction.companyId,
        branchId: transaction.branchId,
        actorId: params.actorId,
        action: "VOID_TRANSACTION",
        entityType: "PosTransaction",
        entityId: transaction.id,
        reason: params.reason.trim(),
        newValue: { documentNumber: transaction.documentNumber },
      },
      tx,
    );

    return updated;
  });
}
