import { PosTransactionStatus, PrescriptionStatus, Prisma, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { hasPermission } from "@/lib/permissions";
import { recordAudit } from "@/services/audit-service";

export type PrescriptionListQuery = {
  companyId: string;
  allowedBranchIds: string[];
  branchId?: string;
  status?: PrescriptionStatus;
  page: number;
  pageSize?: number;
};

export async function listPrescriptionsPaginated(query: PrescriptionListQuery) {
  const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;
  const branchIds = query.branchId ? [query.branchId] : query.allowedBranchIds;

  const where: Prisma.PrescriptionWhereInput = {
    companyId: query.companyId,
    branchId: { in: branchIds },
    status: query.status,
  };

  const [data, totalCount] = await Promise.all([
    prisma.prescription.findMany({
      where,
      include: {
        branch: { select: { code: true, name: true } },
        createdBy: { select: { name: true } },
        posTransaction: { select: { documentNumber: true, totalAmount: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.prescription.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getPrescriptionById(allowedBranchIds: string[], id: string) {
  return prisma.prescription.findFirst({
    where: { id, branchId: { in: allowedBranchIds } },
    include: {
      branch: { select: { code: true, name: true } },
      createdBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      posTransaction: {
        include: {
          items: { include: { product: { select: { sku: true, name: true } } } },
        },
      },
    },
  });
}

/**
 * Approve/reject resep (Fase 09). Permission `prescription.review` DICEK
 * ULANG di sini (bukan hanya action layer) — pola sama
 * `pos-void-service.ts::voidTransaction`. Reject WAJIB catatan (dipakai
 * ganda sebagai alasan penolakan, disimpan di `pharmacistNotes`) dan
 * meng-cascade `PosTransaction` terkait ke `CANCELLED` (transaksi pending
 * yang resepnya ditolak tidak akan pernah bisa dibayar).
 */
export async function reviewPrescription(params: {
  allowedBranchIds: string[];
  prescriptionId: string;
  actorId: string;
  actorRole: Role;
  decision: "APPROVE" | "REJECT";
  notes?: string;
}) {
  if (!hasPermission(params.actorRole, "prescription.review")) {
    throw new Error("Anda tidak memiliki izin untuk meninjau resep.");
  }
  if (params.decision === "REJECT" && !params.notes?.trim()) {
    throw new Error("Catatan alasan penolakan wajib diisi.");
  }

  return prisma.$transaction(async (tx) => {
    const prescription = await tx.prescription.findFirst({
      where: { id: params.prescriptionId, branchId: { in: params.allowedBranchIds } },
    });
    if (!prescription) {
      throw new Error("Resep tidak ditemukan atau di luar akses cabang Anda.");
    }
    if (prescription.status !== PrescriptionStatus.PENDING_REVIEW) {
      throw new Error(`Resep berstatus ${prescription.status}, tidak dapat ditinjau ulang.`);
    }

    const newStatus =
      params.decision === "APPROVE" ? PrescriptionStatus.APPROVED : PrescriptionStatus.REJECTED;

    const updated = await tx.prescription.update({
      where: { id: prescription.id },
      data: {
        status: newStatus,
        reviewedById: params.actorId,
        reviewedAt: new Date(),
        pharmacistNotes: params.notes?.trim() || prescription.pharmacistNotes,
      },
    });

    if (params.decision === "REJECT") {
      await tx.posTransaction.update({
        where: { id: prescription.posTransactionId },
        data: {
          status: PosTransactionStatus.CANCELLED,
          cancelledById: params.actorId,
          cancelledAt: new Date(),
          cancelReason: `Resep ditolak: ${params.notes!.trim()}`,
        },
      });
    }

    await recordAudit(
      {
        companyId: prescription.companyId,
        branchId: prescription.branchId,
        actorId: params.actorId,
        action: params.decision === "APPROVE" ? "APPROVE_PRESCRIPTION" : "REJECT_PRESCRIPTION",
        entityType: "Prescription",
        entityId: prescription.id,
        reason: params.notes?.trim(),
        newValue: { prescriptionNumber: prescription.prescriptionNumber },
      },
      tx,
    );

    return updated;
  });
}
