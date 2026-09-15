import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findBranchByCode } from "@/services/branch-service";
import { closeShift, getOpenShiftForUser, openShift } from "@/services/cashier-shift-service";
import {
  createPaidTransaction,
  createPendingPrescriptionTransaction,
  finalizePrescriptionPayment,
} from "@/services/pos-transaction-service";
import { reviewPrescription } from "@/services/prescription-service";

let companyId: string;
let pusatBranchId: string;
let warehouseId: string;
let cashierUserId: string;
let pharmacistUserId: string;
let rxProductId: string;
let regularProductId: string;

const createdUserIds: string[] = [];
const createdShiftIds: string[] = [];
const createdTransactionIds: string[] = [];

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function createTestBatch(testProductId: string, qty: number, expiryOffsetDays = 30) {
  return prisma.stockBatch.create({
    data: {
      companyId,
      branchId: pusatBranchId,
      warehouseId,
      productId: testProductId,
      batchNumber: `TEST-RX-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
    await prisma.salesReturnItem.deleteMany({ where: { posTransactionItem: { posTransactionId: id } } });
    await prisma.payment.deleteMany({ where: { posTransactionId: id } });
    await prisma.prescription.deleteMany({ where: { posTransactionId: id } });
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
  if (!pusat) throw new Error("Seed cabang tidak lengkap");
  pusatBranchId = pusat.id;

  const warehouse = await prisma.warehouse.findFirstOrThrow({
    where: { branchId: pusatBranchId, isDefault: true },
  });
  warehouseId = warehouse.id;

  const cashier = await prisma.user.create({
    data: {
      companyId,
      email: `test-cashier-rx-${Date.now()}@test.local`,
      name: "Test Cashier (Rx test)",
      role: Role.CASHIER,
      passwordHash: "unused-in-tests",
    },
  });
  cashierUserId = cashier.id;
  createdUserIds.push(cashier.id);
  await prisma.userBranchAssignment.create({ data: { userId: cashier.id, branchId: pusatBranchId } });

  const pharmacist = await prisma.user.create({
    data: {
      companyId,
      email: `test-pharmacist-rx-${Date.now()}@test.local`,
      name: "Test Pharmacist (Rx test)",
      role: Role.PHARMACIST,
      passwordHash: "unused-in-tests",
    },
  });
  pharmacistUserId = pharmacist.id;
  createdUserIds.push(pharmacist.id);
  await prisma.userBranchAssignment.create({ data: { userId: pharmacist.id, branchId: pusatBranchId } });

  const category = await prisma.category.findFirstOrThrow({ where: { companyId } });
  const baseUnit = await prisma.unit.findFirstOrThrow({ where: { companyId, name: "Tablet" } });

  const rxProduct = await prisma.product.create({
    data: {
      companyId,
      sku: `TEST-RX-${Date.now()}`,
      name: "Produk Test Resep",
      categoryId: category.id,
      baseUnitId: baseUnit.id,
      defaultSellingPrice: 1000,
      defaultMinStock: 0,
      isActive: true,
      requiresPrescription: true,
    },
  });
  rxProductId = rxProduct.id;

  const regularProduct = await prisma.product.create({
    data: {
      companyId,
      sku: `TEST-NONRX-${Date.now()}`,
      name: "Produk Test Non-Resep",
      categoryId: category.id,
      baseUnitId: baseUnit.id,
      defaultSellingPrice: 1000,
      defaultMinStock: 0,
      isActive: true,
      requiresPrescription: false,
    },
  });
  regularProductId = regularProduct.id;
});

afterAll(async () => {
  for (const id of createdTransactionIds) await cleanupTransaction(id);
  for (const id of createdShiftIds) {
    await prisma.cashMovement.deleteMany({ where: { cashierShiftId: id } });
    await prisma.auditLog.deleteMany({ where: { entityType: "CashierShift", entityId: id } });
    await prisma.cashierShift.delete({ where: { id } }).catch(() => {});
  }
  await prisma.stockMovement.deleteMany({ where: { productId: rxProductId } });
  await prisma.stockBatch.deleteMany({ where: { productId: rxProductId } });
  await prisma.stockMovement.deleteMany({ where: { productId: regularProductId } });
  await prisma.stockBatch.deleteMany({ where: { productId: regularProductId } });
  await prisma.product.delete({ where: { id: rxProductId } });
  await prisma.product.delete({ where: { id: regularProductId } });
  for (const id of createdUserIds) {
    await prisma.userBranchAssignment.deleteMany({ where: { userId: id } });
    await prisma.user.delete({ where: { id } });
  }
  await prisma.$disconnect();
});

function samplePrescriptionInput() {
  return {
    patientName: "Budi Santoso",
    doctorName: "dr. Siti",
    prescriptionNumber: `RX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    prescriptionDate: new Date(),
  };
}

describe("createPaidTransaction — pre-check produk resep", () => {
  it("menolak pembayaran langsung bila keranjang mengandung produk requiresPrescription", async () => {
    await createTestBatch(rxProductId, 10);
    const shift = await openTestShift(cashierUserId, pusatBranchId);

    await expect(
      createPaidTransaction({
        companyId,
        allowedBranchIds: [pusatBranchId],
        shiftId: shift.id,
        createdById: cashierUserId,
        items: [{ productId: rxProductId, qty: 1 }],
        payments: [{ method: "CASH", amount: 1000 }],
      }),
    ).rejects.toThrow("memerlukan resep");
  });

  it("tetap mengizinkan pembayaran langsung untuk produk non-resep", async () => {
    await createTestBatch(regularProductId, 10);
    const shift = await openTestShift(cashierUserId, pusatBranchId);

    const transaction = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId: regularProductId, qty: 1 }],
      payments: [{ method: "CASH", amount: 1000 }],
    });
    createdTransactionIds.push(transaction.id);
    expect(transaction.status).toBe("PAID");
  });
});

describe("createPendingPrescriptionTransaction", () => {
  it("membuat transaksi PENDING_PRESCRIPTION_REVIEW tanpa memotong stok", async () => {
    const batch = await createTestBatch(rxProductId, 10);
    const shift = await openTestShift(cashierUserId, pusatBranchId);

    const transaction = await createPendingPrescriptionTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId: rxProductId, qty: 2 }],
      prescription: samplePrescriptionInput(),
    });
    createdTransactionIds.push(transaction.id);

    expect(transaction.status).toBe("PENDING_PRESCRIPTION_REVIEW");
    expect(transaction.prescription?.status).toBe("PENDING_REVIEW");
    const payments = await prisma.payment.findMany({ where: { posTransactionId: transaction.id } });
    expect(payments).toHaveLength(0);

    const after = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(after.qtyOnHand.toString()).toBe("10"); // belum tersentuh

    const allocations = await prisma.posTransactionItemBatchAllocation.count({
      where: { item: { posTransactionId: transaction.id } },
    });
    expect(allocations).toBe(0);
  });

  it("menolak bila keranjang tidak mengandung produk resep", async () => {
    await createTestBatch(regularProductId, 10);
    const shift = await openTestShift(cashierUserId, pusatBranchId);

    await expect(
      createPendingPrescriptionTransaction({
        companyId,
        allowedBranchIds: [pusatBranchId],
        shiftId: shift.id,
        createdById: cashierUserId,
        items: [{ productId: regularProductId, qty: 1 }],
        prescription: samplePrescriptionInput(),
      }),
    ).rejects.toThrow("tidak mengandung produk yang memerlukan resep");
  });
});

describe("reviewPrescription — RBAC & alur approve/reject", () => {
  it("Cashier tidak berwenang meninjau resep", async () => {
    await createTestBatch(rxProductId, 10);
    const shift = await openTestShift(cashierUserId, pusatBranchId);
    const transaction = await createPendingPrescriptionTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId: rxProductId, qty: 1 }],
      prescription: samplePrescriptionInput(),
    });
    createdTransactionIds.push(transaction.id);

    await expect(
      reviewPrescription({
        allowedBranchIds: [pusatBranchId],
        prescriptionId: transaction.prescription!.id,
        actorId: cashierUserId,
        actorRole: Role.CASHIER,
        decision: "APPROVE",
      }),
    ).rejects.toThrow("izin");
  });

  it("Pharmacist dapat approve resep", async () => {
    await createTestBatch(rxProductId, 10);
    const shift = await openTestShift(cashierUserId, pusatBranchId);
    const transaction = await createPendingPrescriptionTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId: rxProductId, qty: 1 }],
      prescription: samplePrescriptionInput(),
    });
    createdTransactionIds.push(transaction.id);

    const reviewed = await reviewPrescription({
      allowedBranchIds: [pusatBranchId],
      prescriptionId: transaction.prescription!.id,
      actorId: pharmacistUserId,
      actorRole: Role.PHARMACIST,
      decision: "APPROVE",
    });
    expect(reviewed.status).toBe("APPROVED");
    expect(reviewed.reviewedById).toBe(pharmacistUserId);
  });

  it("reject wajib catatan alasan dan meng-cascade transaksi ke CANCELLED", async () => {
    await createTestBatch(rxProductId, 10);
    const shift = await openTestShift(cashierUserId, pusatBranchId);
    const transaction = await createPendingPrescriptionTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId: rxProductId, qty: 1 }],
      prescription: samplePrescriptionInput(),
    });
    createdTransactionIds.push(transaction.id);

    await expect(
      reviewPrescription({
        allowedBranchIds: [pusatBranchId],
        prescriptionId: transaction.prescription!.id,
        actorId: pharmacistUserId,
        actorRole: Role.PHARMACIST,
        decision: "REJECT",
      }),
    ).rejects.toThrow("Catatan alasan penolakan wajib diisi");

    const reviewed = await reviewPrescription({
      allowedBranchIds: [pusatBranchId],
      prescriptionId: transaction.prescription!.id,
      actorId: pharmacistUserId,
      actorRole: Role.PHARMACIST,
      decision: "REJECT",
      notes: "Resep tidak terbaca / diragukan keasliannya",
    });
    expect(reviewed.status).toBe("REJECTED");

    const posTransaction = await prisma.posTransaction.findUniqueOrThrow({
      where: { id: transaction.id },
    });
    expect(posTransaction.status).toBe("CANCELLED");
    expect(posTransaction.cancelledById).toBe(pharmacistUserId);
  });
});

describe("finalizePrescriptionPayment", () => {
  it("ditolak bila resep belum APPROVED", async () => {
    await createTestBatch(rxProductId, 10);
    const shift = await openTestShift(cashierUserId, pusatBranchId);
    const transaction = await createPendingPrescriptionTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId: rxProductId, qty: 1 }],
      prescription: samplePrescriptionInput(),
    });
    createdTransactionIds.push(transaction.id);

    await expect(
      finalizePrescriptionPayment({
        allowedBranchIds: [pusatBranchId],
        transactionId: transaction.id,
        actorId: cashierUserId,
        payments: [{ method: "CASH", amount: 1000 }],
      }),
    ).rejects.toThrow("Resep belum disetujui");
  });

  it("setelah APPROVED: memotong stok FEFO, status PAID, Prescription COMPLETED", async () => {
    const batch = await createTestBatch(rxProductId, 10, 15);
    const shift = await openTestShift(cashierUserId, pusatBranchId);
    const transaction = await createPendingPrescriptionTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId: rxProductId, qty: 3 }],
      prescription: samplePrescriptionInput(),
    });
    createdTransactionIds.push(transaction.id);

    await reviewPrescription({
      allowedBranchIds: [pusatBranchId],
      prescriptionId: transaction.prescription!.id,
      actorId: pharmacistUserId,
      actorRole: Role.PHARMACIST,
      decision: "APPROVE",
    });

    const finalized = await finalizePrescriptionPayment({
      allowedBranchIds: [pusatBranchId],
      transactionId: transaction.id,
      actorId: cashierUserId,
      payments: [{ method: "CASH", amount: 3000 }],
    });

    expect(finalized.status).toBe("PAID");
    expect(finalized.prescription?.status).toBe("COMPLETED");
    expect(finalized.payments).toHaveLength(1);

    const after = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(after.qtyOnHand.toString()).toBe("7"); // 10 - 3

    const allocations = await prisma.posTransactionItemBatchAllocation.findMany({
      where: { item: { posTransactionId: transaction.id } },
    });
    expect(allocations).toHaveLength(1);
    expect(allocations[0]?.qtyOut.toString()).toBe("3");

    const auditLog = await prisma.auditLog.findFirst({
      where: { entityType: "PosTransaction", entityId: transaction.id, action: "PAY_AFTER_PRESCRIPTION" },
    });
    expect(auditLog).not.toBeNull();
  });
});
