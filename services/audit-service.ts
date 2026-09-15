import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type PrismaClientOrTx = Pick<Prisma.TransactionClient, "auditLog">;

/**
 * Pencatat AuditLog generik untuk mutasi data sensitif (Product, Supplier,
 * Branch, ProductBranchPrice, User, StockAdjustment, StockOpname — lihat
 * masing-masing service/actions terkait). oldValue/newValue disimpan
 * sebagai JSON snapshot ringkas (bukan seluruh row mentah) agar mudah
 * dibaca saat audit.
 *
 * Parameter `client` opsional (default: singleton `prisma`) — WAJIB diisi
 * dengan `tx` (client transaction) saat recordAudit dipanggil dari dalam
 * `prisma.$transaction(...)`, supaya penulisan audit log ikut rollback
 * bila ada langkah lain dalam transaction yang gagal. Melewatkan ini akan
 * membuat audit log "yatim" (tercatat padahal perubahan yang diaudit
 * sebenarnya batal).
 */
export async function recordAudit(
  params: {
    companyId: string;
    branchId?: string | null;
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    oldValue?: Record<string, unknown> | null;
    newValue?: Record<string, unknown> | null;
    reason?: string;
  },
  client: PrismaClientOrTx = prisma,
): Promise<void> {
  await client.auditLog.create({
    data: {
      companyId: params.companyId,
      branchId: params.branchId ?? null,
      actorId: params.actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      oldValue: (params.oldValue ?? undefined) as Prisma.InputJsonValue | undefined,
      newValue: (params.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: params.reason,
    },
  });
}
