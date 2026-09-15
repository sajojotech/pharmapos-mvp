import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findBranchByCode } from "@/services/branch-service";
import { closeShift, getOpenShiftForUser, openShift } from "@/services/cashier-shift-service";
import { createPaidTransaction } from "@/services/pos-transaction-service";
import { voidTransaction } from "@/services/pos-void-service";

let companyId: string;
let pusatBranchId: string;
let timurBranchId: string;
let warehouseId: string;
let cashierUserId: string;
let managerUserId: string;
let productId: string;

const createdUserIds: string[] = [];
const createdShiftIds: string[] = [];
const createdTransactionIds: string[] = [];

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function createTestBatch(qty: number, expiryOffsetDays = 30) {
  return prisma.stockBatch.create({
    data: {
      companyId,
      branchId: pusatBranchId,
      warehouseId,
      productId,
      batchNumber: `TEST-VOID-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      expiryDate: daysFromNow(expiryOffsetDays),
      receivedDate: new Date(),
      qtyOnHand: qty,
      unitCost: 500,
      status: "AVAILABLE",
    },
  });
}

async function openTestShift(userId: string, branchId: string) {
  const existing = await getOpenShiftForUser(userId);
  if (existing) {
    await closeShift({
      allowedBranchIds: [existing.branchId],
      shiftId: existing.id,
      actorId: userId,
      actualCash: 0,
    });
  }
  const shift = await openShift({ companyId, branchId, userId, openingCash: 0 });
  createdShiftIds.push(shift.id);
  return shift;
}

async function cleanupTransaction(id: string) {
  try {
    await prisma.payment.deleteMany({ where: { posTransactionId: id } });
    await prisma.posTransactionItem.deleteMany({ where: { posTransactionId: id } });
    await prisma.auditLog.deleteMany({ where: { entityType: "PosTransaction", entityId: id } });
    await prisma.posTransaction.delete({ where: { id } });
  } catch {
    // sudah terhapus — abaikan
  }
}

beforeAll(async () => {
  const company = await prisma.company.findFirstOrThrow();
  companyId = company.id;

  const pusat = await findBranchByCode(companyId, "PUSAT");
  const timur = await findBranchByCode(companyId, "TIMUR");
  if (!pusat || !timur) throw new Error("Seed cabang tidak lengkap");
  pusatBranchId = pusat.id;
  timurBranchId = timur.id;

  const warehouse = await prisma.warehouse.findFirstOrThrow({
    where: { branchId: pusatBranchId, isDefault: true },
  });
  warehouseId = warehouse.id;

  const cashier = await prisma.user.create({
    data: {
      companyId,
      email: `test-cashier-void-${Date.now()}@test.local`,
      name: "Test Cashier (Void test)",
      role: Role.CASHIER,
      passwordHash: "unused-in-tests",
    },
  });
  cashierUserId = cashier.id;
  createdUserIds.push(cashier.id);
  await prisma.userBranchAssignment.create({ data: { userId: cashier.id, branchId: pusatBranchId } });

  const manager = await prisma.user.create({
    data: {
      companyId,
      email: `test-manager-void-${Date.now()}@test.local`,
      name: "Test Branch Manager (Void test)",
      role: Role.BRANCH_MANAGER,
      passwordHash: "unused-in-tests",
    },
  });
  managerUserId = manager.id;
  createdUserIds.push(manager.id);
  await prisma.userBranchAssignment.create({ data: { userId: manager.id, branchId: pusatBranchId } });

  const category = await prisma.category.findFirstOrThrow({ where: { companyId } });
  const baseUnit = await prisma.unit.findFirstOrThrow({ where: { companyId, name: "Tablet" } });

  const product = await prisma.product.create({
    data: {
      companyId,
      sku: `TEST-VOID-${Date.now()}`,
      name: "Produk Test Void",
      categoryId: category.id,
      baseUnitId: baseUnit.id,
      defaultSellingPrice: 1000,
      defaultMinStock: 0,
      isActive: true,
    },
  });
  productId = product.id;
});

afterAll(async () => {
  for (const id of createdTransactionIds) await cleanupTransaction(id);
  for (const id of createdShiftIds) {
    await prisma.cashMovement.deleteMany({ where: { cashierShiftId: id } });
    await prisma.auditLog.deleteMany({ where: { entityType: "CashierShift", entityId: id } });
    await prisma.cashierShift.delete({ where: { id } }).catch(() => {});
  }
  await prisma.stockMovement.deleteMany({ where: { productId } });
  await prisma.stockBatch.deleteMany({ where: { productId } });
  await prisma.product.delete({ where: { id: productId } });
  for (const id of createdUserIds) {
    await prisma.userBranchAssignment.deleteMany({ where: { userId: id } });
    await prisma.user.delete({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("voidTransaction", () => {
  it("menolak bila actor tidak punya permission pos.void (Cashier)", async () => {
    await createTestBatch(10);
    const shift = await openTestShift(cashierUserId, pusatBranchId);
    const transaction = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId, qty: 2 }],
      payments: [{ method: "CASH", amount: 2000 }],
    });
    createdTransactionIds.push(transaction.id);

    await expect(
      voidTransaction({
        allowedBranchIds: [pusatBranchId],
        transactionId: transaction.id,
        actorId: cashierUserId,
        actorRole: Role.CASHIER,
        reason: "Kasir salah input",
      }),
    ).rejects.toThrow("izin");
  });

  it("menolak bila alasan kosong", async () => {
    await createTestBatch(10);
    const shift = await openTestShift(cashierUserId, pusatBranchId);
    const transaction = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId, qty: 2 }],
      payments: [{ method: "CASH", amount: 2000 }],
    });
    createdTransactionIds.push(transaction.id);

    await expect(
      voidTransaction({
        allowedBranchIds: [pusatBranchId],
        transactionId: transaction.id,
        actorId: managerUserId,
        actorRole: Role.BRANCH_MANAGER,
        reason: "   ",
      }),
    ).rejects.toThrow("Alasan void wajib diisi");
  });

  it("menolak akses transaksi di luar cabang yang diizinkan", async () => {
    await createTestBatch(10);
    const shift = await openTestShift(cashierUserId, pusatBranchId);
    const transaction = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId, qty: 2 }],
      payments: [{ method: "CASH", amount: 2000 }],
    });
    createdTransactionIds.push(transaction.id);

    await expect(
      voidTransaction({
        allowedBranchIds: [timurBranchId],
        transactionId: transaction.id,
        actorId: managerUserId,
        actorRole: Role.BRANCH_MANAGER,
        reason: "test",
      }),
    ).rejects.toThrow("tidak ditemukan atau di luar akses cabang");
  });

  it("menolak void transaksi yang bukan PAID", async () => {
    await createTestBatch(10);
    const shift = await openTestShift(cashierUserId, pusatBranchId);
    const transaction = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId, qty: 2 }],
      payments: [{ method: "CASH", amount: 2000 }],
    });
    createdTransactionIds.push(transaction.id);

    await voidTransaction({
      allowedBranchIds: [pusatBranchId],
      transactionId: transaction.id,
      actorId: managerUserId,
      actorRole: Role.BRANCH_MANAGER,
      reason: "Void pertama",
    });

    await expect(
      voidTransaction({
        allowedBranchIds: [pusatBranchId],
        transactionId: transaction.id,
        actorId: managerUserId,
        actorRole: Role.BRANCH_MANAGER,
        reason: "Void kedua — seharusnya ditolak",
      }),
    ).rejects.toThrow("Hanya transaksi berstatus PAID");
  });

  it("mengembalikan qty TEPAT ke batch alokasi asal (termasuk item yang di-split FEFO ke >1 batch), mencatat VOID_REVERSAL + audit log + isReversed", async () => {
    const batchA = await createTestBatch(4, 10);
    const batchB = await createTestBatch(10, 20);

    const shift = await openTestShift(cashierUserId, pusatBranchId);
    const transaction = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId, qty: 7 }], // 4 dari batchA + 3 dari batchB
      payments: [{ method: "CASH", amount: 7000 }],
    });
    createdTransactionIds.push(transaction.id);

    const aAfterSale = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batchA.id } });
    const bAfterSale = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batchB.id } });
    expect(aAfterSale.qtyOnHand.toString()).toBe("0");
    expect(bAfterSale.qtyOnHand.toString()).toBe("7");

    const voided = await voidTransaction({
      allowedBranchIds: [pusatBranchId],
      transactionId: transaction.id,
      actorId: managerUserId,
      actorRole: Role.BRANCH_MANAGER,
      reason: "Pembeli batal, sudah dibayar",
    });

    expect(voided.status).toBe("VOIDED");
    expect(voided.voidedById).toBe(managerUserId);
    expect(voided.voidReason).toBe("Pembeli batal, sudah dibayar");

    const aAfterVoid = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batchA.id } });
    const bAfterVoid = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batchB.id } });
    expect(aAfterVoid.qtyOnHand.toString()).toBe("4"); // kembali persis
    expect(bAfterVoid.qtyOnHand.toString()).toBe("10"); // kembali persis

    const reversalMovements = await prisma.stockMovement.findMany({
      where: { referenceType: "PosTransaction", referenceId: transaction.id, movementType: "VOID_REVERSAL" },
    });
    expect(reversalMovements).toHaveLength(2);

    const payments = await prisma.payment.findMany({ where: { posTransactionId: transaction.id } });
    expect(payments.every((p) => p.isReversed)).toBe(true);

    const auditLog = await prisma.auditLog.findFirst({
      where: { entityType: "PosTransaction", entityId: transaction.id, action: "VOID_TRANSACTION" },
    });
    expect(auditLog).not.toBeNull();
    expect(auditLog?.reason).toBe("Pembeli batal, sudah dibayar");
  });
});
