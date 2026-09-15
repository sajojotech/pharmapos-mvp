import { CashierShiftStatus, CashMovementDirection, Prisma, PosTransactionStatus, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { recordAudit } from "@/services/audit-service";
import { computeExpectedCash, computeVariance, decideShiftStatus } from "@/services/cashier-shift-calc";

function resolveEffectiveBranchIds(
  allowedBranchIds: string[],
  requestedBranchId?: string,
): string[] {
  if (!requestedBranchId) return allowedBranchIds;
  return allowedBranchIds.includes(requestedBranchId) ? [requestedBranchId] : [];
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Shift OPEN milik seorang user (bila ada) — satu user hanya boleh punya
 * SATU shift OPEN lintas cabang mana pun (lihat partial unique index di
 * migration & docs/POS.md).
 */
export async function getOpenShiftForUser(userId: string) {
  return prisma.cashierShift.findFirst({
    where: { userId, status: CashierShiftStatus.OPEN },
    include: { branch: { select: { id: true, code: true, name: true } } },
  });
}

export type ShiftListQuery = {
  companyId: string;
  allowedBranchIds: string[];
  branchId?: string;
  status?: CashierShiftStatus;
  /** Fase 10: filter `openedAt` opsional, dipakai laporan
   * `/reports/shift-recap` — tidak memengaruhi pemanggil lama (mis.
   * halaman `/cashier/shifts`) yang tidak mengirim field ini. */
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize?: number;
};

export async function listShiftsPaginated(query: ShiftListQuery) {
  const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;
  const branchIds = resolveEffectiveBranchIds(query.allowedBranchIds, query.branchId);

  const where: Prisma.CashierShiftWhereInput = {
    companyId: query.companyId,
    branchId: { in: branchIds },
    status: query.status,
    openedAt:
      query.dateFrom || query.dateTo
        ? { gte: query.dateFrom, lte: query.dateTo }
        : undefined,
  };

  const [data, totalCount] = await Promise.all([
    prisma.cashierShift.findMany({
      where,
      include: {
        branch: { select: { code: true, name: true } },
        user: { select: { name: true } },
      },
      orderBy: { openedAt: "desc" },
      skip: (query.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.cashierShift.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getShiftById(allowedBranchIds: string[], id: string) {
  return prisma.cashierShift.findFirst({
    where: { id, branchId: { in: allowedBranchIds } },
    include: {
      branch: { select: { code: true, name: true } },
      user: { select: { name: true } },
      closedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      cashMovements: {
        include: { createdBy: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      },
      _count: { select: { posTransactions: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// Buka shift
// ---------------------------------------------------------------------------

export async function openShift(params: {
  companyId: string;
  branchId: string;
  userId: string;
  openingCash: number;
}) {
  if (params.openingCash < 0) {
    throw new Error("Modal kas awal tidak boleh negatif.");
  }

  const existing = await getOpenShiftForUser(params.userId);
  if (existing) {
    throw new Error(
      "Anda masih memiliki shift yang belum ditutup. Tutup shift tersebut terlebih dahulu.",
    );
  }

  try {
    const shift = await prisma.cashierShift.create({
      data: {
        companyId: params.companyId,
        branchId: params.branchId,
        userId: params.userId,
        openingCash: params.openingCash.toString(),
      },
    });

    await recordAudit({
      companyId: params.companyId,
      branchId: params.branchId,
      actorId: params.userId,
      action: "OPEN_SHIFT",
      entityType: "CashierShift",
      entityId: shift.id,
      newValue: { openingCash: params.openingCash },
    });

    return shift;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error(
        "Anda masih memiliki shift yang belum ditutup. Tutup shift tersebut terlebih dahulu.",
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Cash in / cash out
// ---------------------------------------------------------------------------

export async function addCashMovement(params: {
  allowedBranchIds: string[];
  shiftId: string;
  direction: CashMovementDirection;
  amount: number;
  reason: string;
  actorId: string;
}) {
  if (params.amount <= 0) {
    throw new Error("Jumlah kas harus lebih dari 0.");
  }
  if (!params.reason.trim()) {
    throw new Error("Alasan wajib diisi.");
  }

  return prisma.$transaction(async (tx) => {
    const shift = await tx.cashierShift.findFirst({
      where: { id: params.shiftId, branchId: { in: params.allowedBranchIds } },
    });
    if (!shift) {
      throw new Error("Shift tidak ditemukan atau di luar akses cabang Anda.");
    }
    if (shift.status !== CashierShiftStatus.OPEN) {
      throw new Error("Hanya shift berstatus OPEN yang dapat menerima mutasi kas.");
    }

    const movement = await tx.cashMovement.create({
      data: {
        cashierShiftId: shift.id,
        direction: params.direction,
        amount: params.amount.toString(),
        reason: params.reason.trim(),
        createdById: params.actorId,
      },
    });

    await recordAudit(
      {
        companyId: shift.companyId,
        branchId: shift.branchId,
        actorId: params.actorId,
        action: params.direction === CashMovementDirection.IN ? "CASH_IN" : "CASH_OUT",
        entityType: "CashierShift",
        entityId: shift.id,
        newValue: { amount: params.amount, reason: params.reason.trim() },
      },
      tx,
    );

    return movement;
  });
}

// ---------------------------------------------------------------------------
// Tutup shift
// ---------------------------------------------------------------------------

async function readVarianceThreshold(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<Prisma.Decimal | null> {
  const setting = await tx.appSetting.findUnique({
    where: { companyId_key: { companyId, key: "CASH_VARIANCE_THRESHOLD" } },
  });
  if (!setting) return null;
  const value = setting.value;
  if (typeof value !== "number" && typeof value !== "string") return null;
  return new Prisma.Decimal(value.toString());
}

/**
 * Fase 11 hardening: sebelumnya fungsi ini memfilter `status: PAID` PERSIS
 * pada kedua query — begitu SATU transaksi mendapat retur sebagian
 * (status berubah ke PARTIALLY_RETURNED/RETURNED, lihat
 * services/sales-return-service.ts), transaksi itu hilang TOTAL dari
 * perhitungan kas, bukan hanya bagian yang diretur — seluruh uang tunai
 * yang benar-benar masuk laci saat penjualan asli ikut lenyap dari
 * `netCashSales`, membuat `expectedCash`/variance salah secara diam-diam.
 *
 * Perbaikan: filter berbasis FAKTA yang benar-benar relevan untuk kas —
 * `Payment.isReversed=false` (satu-satunya penanda otoritatif "uang ini
 * sudah dibalik", diset oleh services/pos-void-service.ts saat void) untuk
 * sisi pembayaran, dan `status != VOIDED` + `paidAt` terisi untuk sisi
 * changeAmount (kembalian adalah properti transaksi, bukan per-payment).
 * PARTIALLY_RETURNED/RETURNED SENGAJA tetap ikut terhitung — uang tunai
 * penjualan aslinya memang benar-benar masuk laci saat itu, retur barang
 * tidak mengubah fakta itu.
 *
 * Keterbatasan MVP yang belum diselesaikan di sini (lihat docs/REPORTS.md
 * atau README bagian keterbatasan): bila retur menyertakan pengembalian
 * UANG TUNAI ke pelanggan, itu belum tercatat sebagai pengurang kas
 * (parameter `cashRefunds` di computeExpectedCash masih placeholder,
 * lihat services/cashier-shift-calc.ts) — di luar cakupan perbaikan
 * "transaksi hilang total" yang menjadi fokus hardening fase ini.
 */
async function computeNetCashSales(
  tx: Prisma.TransactionClient,
  shiftId: string,
): Promise<Prisma.Decimal> {
  const [cashPayments, transactions] = await Promise.all([
    tx.payment.aggregate({
      where: {
        method: "CASH",
        isReversed: false,
        transaction: { cashierShiftId: shiftId, paidAt: { not: null } },
      },
      _sum: { amount: true },
    }),
    tx.posTransaction.aggregate({
      where: {
        cashierShiftId: shiftId,
        paidAt: { not: null },
        status: { not: PosTransactionStatus.VOIDED },
      },
      _sum: { changeAmount: true },
    }),
  ]);

  const cashTendered = cashPayments._sum.amount ?? new Prisma.Decimal(0);
  const totalChange = transactions._sum.changeAmount ?? new Prisma.Decimal(0);

  return cashTendered.minus(totalChange);
}

async function computeCashMovementTotals(
  tx: Prisma.TransactionClient,
  shiftId: string,
): Promise<{ cashIn: Prisma.Decimal; cashOut: Prisma.Decimal }> {
  const grouped = await tx.cashMovement.groupBy({
    by: ["direction"],
    where: { cashierShiftId: shiftId },
    _sum: { amount: true },
  });

  const cashIn =
    grouped.find((g) => g.direction === CashMovementDirection.IN)?._sum.amount ??
    new Prisma.Decimal(0);
  const cashOut =
    grouped.find((g) => g.direction === CashMovementDirection.OUT)?._sum.amount ??
    new Prisma.Decimal(0);

  return { cashIn, cashOut };
}

export async function closeShift(params: {
  allowedBranchIds: string[];
  shiftId: string;
  actorId: string;
  actualCash: number;
  closingNotes?: string;
}) {
  if (params.actualCash < 0) {
    throw new Error("Kas aktual tidak boleh negatif.");
  }

  return prisma.$transaction(async (tx) => {
    const shift = await tx.cashierShift.findFirst({
      where: { id: params.shiftId, branchId: { in: params.allowedBranchIds } },
    });
    if (!shift) {
      throw new Error("Shift tidak ditemukan atau di luar akses cabang Anda.");
    }
    if (shift.status !== CashierShiftStatus.OPEN) {
      throw new Error("Hanya shift berstatus OPEN yang dapat ditutup.");
    }

    const netCashSales = await computeNetCashSales(tx, shift.id);
    const { cashIn, cashOut } = await computeCashMovementTotals(tx, shift.id);

    const expectedCash = computeExpectedCash({
      openingCash: shift.openingCash,
      netCashSales,
      cashIn,
      cashOut,
    });
    const variance = computeVariance(params.actualCash, expectedCash);
    const threshold = await readVarianceThreshold(tx, shift.companyId);
    const nextStatus = decideShiftStatus(variance, threshold);

    const updated = await tx.cashierShift.update({
      where: { id: shift.id },
      data: {
        status: nextStatus,
        actualCash: params.actualCash.toString(),
        expectedCash: expectedCash.toString(),
        variance: variance.toString(),
        varianceThreshold: threshold?.toString() ?? null,
        closingNotes: params.closingNotes?.trim() || null,
        closedAt: new Date(),
        closedById: params.actorId,
      },
    });

    await recordAudit(
      {
        companyId: shift.companyId,
        branchId: shift.branchId,
        actorId: params.actorId,
        action: nextStatus === "CLOSED" ? "CLOSE_SHIFT" : "CLOSE_SHIFT_PENDING_APPROVAL",
        entityType: "CashierShift",
        entityId: shift.id,
        newValue: {
          expectedCash: expectedCash.toString(),
          actualCash: params.actualCash,
          variance: variance.toString(),
        },
      },
      tx,
    );

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Approve shift (variance melebihi threshold)
// ---------------------------------------------------------------------------

const APPROVER_ROLES: Role[] = [Role.OWNER, Role.BRANCH_MANAGER];

/**
 * `actorRole` divalidasi ULANG di sini (bukan hanya di actions.ts) —
 * kasir pemilik shift tidak boleh menyetujui selisih kasnya sendiri. Ini
 * pengecekan role langsung (bukan permission matrix baru), konsisten
 * dengan keputusan pada docs/POS.md.
 */
export async function approveShift(params: {
  allowedBranchIds: string[];
  shiftId: string;
  actorId: string;
  actorRole: Role;
}) {
  if (!APPROVER_ROLES.includes(params.actorRole)) {
    throw new Error("Hanya Owner/Manager Cabang yang dapat menyetujui penutupan shift ini.");
  }

  return prisma.$transaction(async (tx) => {
    const shift = await tx.cashierShift.findFirst({
      where: { id: params.shiftId, branchId: { in: params.allowedBranchIds } },
    });
    if (!shift) {
      throw new Error("Shift tidak ditemukan atau di luar akses cabang Anda.");
    }
    if (shift.status !== CashierShiftStatus.PENDING_APPROVAL) {
      throw new Error("Hanya shift berstatus PENDING_APPROVAL yang dapat disetujui.");
    }

    const updated = await tx.cashierShift.update({
      where: { id: shift.id },
      data: {
        status: CashierShiftStatus.CLOSED,
        approvedAt: new Date(),
        approvedById: params.actorId,
      },
    });

    await recordAudit(
      {
        companyId: shift.companyId,
        branchId: shift.branchId,
        actorId: params.actorId,
        action: "APPROVE_SHIFT",
        entityType: "CashierShift",
        entityId: shift.id,
        newValue: { variance: shift.variance?.toString() },
      },
      tx,
    );

    return updated;
  });
}
