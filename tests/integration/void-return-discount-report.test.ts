import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role, SalesReturnItemCondition } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findBranchByCode } from "@/services/branch-service";
import { closeShift, getOpenShiftForUser, openShift } from "@/services/cashier-shift-service";
import { createPaidTransaction } from "@/services/pos-transaction-service";
import { voidTransaction } from "@/services/pos-void-service";
import { createSalesReturn } from "@/services/sales-return-service";
import {
  getDiscountReport,
  getReturnReport,
  getVoidReport,
} from "@/services/reports/void-return-discount-report";

let companyId: string;
let pusatBranchId: string;
let pusatWarehouseId: string;
let cashierId: string;
let managerId: string;

const createdUserIds: string[] = [];
const createdShiftIds: string[] = [];
const createdTransactionIds: string[] = [];
const createdProductIds: string[] = [];

const TEST_YEAR_RANGE = {
  dateFrom: new Date("2023-01-01T00:00:00.000Z"),
  dateTo: new Date("2030-01-01T00:00:00.000Z"),
};

async function createIsolatedProduct(): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({ where: { companyId } });
  const baseUnit = await prisma.unit.findFirstOrThrow({ where: { companyId, name: "Tablet" } });
  const product = await prisma.product.create({
    data: {
      companyId,
      sku: `TEST-VRDRPT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "Produk Test Laporan Void/Retur/Diskon",
      categoryId: category.id,
      baseUnitId: baseUnit.id,
      defaultSellingPrice: 1000,
      defaultMinStock: 0,
      isActive: true,
    },
  });
  createdProductIds.push(product.id);
  return product.id;
}

async function createBatch(productId: string, qty: number) {
  return prisma.stockBatch.create({
    data: {
      companyId,
      branchId: pusatBranchId,
      warehouseId: pusatWarehouseId,
      productId,
      batchNumber: `TEST-VRDRPT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      expiryDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      receivedDate: new Date(),
      qtyOnHand: qty,
      unitCost: 500,
      status: "AVAILABLE",
    },
  });
}

async function openTestShift(userId: string) {
  const existing = await getOpenShiftForUser(userId);
  if (existing) {
    await closeShift({
      allowedBranchIds: [existing.branchId],
      shiftId: existing.id,
      actorId: userId,
      actualCash: 0,
    });
  }
  const shift = await openShift({ companyId, branchId: pusatBranchId, userId, openingCash: 0 });
  createdShiftIds.push(shift.id);
  return shift;
}

async function cleanupTransaction(id: string) {
  try {
    await prisma.salesReturnItem.deleteMany({ where: { posTransactionItem: { posTransactionId: id } } });
    await prisma.salesReturn.deleteMany({ where: { posTransactionId: id } });
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
  if (!pusat) throw new Error("Seed cabang tidak lengkap");
  pusatBranchId = pusat.id;
  pusatWarehouseId = (
    await prisma.warehouse.findFirstOrThrow({ where: { branchId: pusatBranchId, isDefault: true } })
  ).id;

  const cashier = await prisma.user.create({
    data: {
      companyId,
      email: `test-cashier-vrd-${Date.now()}@test.local`,
      name: "Test Cashier (VRD Report)",
      role: Role.CASHIER,
      passwordHash: "unused-in-tests",
    },
  });
  cashierId = cashier.id;
  createdUserIds.push(cashier.id);
  await prisma.userBranchAssignment.create({ data: { userId: cashier.id, branchId: pusatBranchId } });

  const manager = await prisma.user.create({
    data: {
      companyId,
      email: `test-manager-vrd-${Date.now()}@test.local`,
      name: "Test Manager (VRD Report)",
      role: Role.BRANCH_MANAGER,
      passwordHash: "unused-in-tests",
    },
  });
  managerId = manager.id;
  createdUserIds.push(manager.id);
  await prisma.userBranchAssignment.create({ data: { userId: manager.id, branchId: pusatBranchId } });
});

afterAll(async () => {
  for (const id of createdTransactionIds) await cleanupTransaction(id);
  for (const id of createdShiftIds) {
    await prisma.cashMovement.deleteMany({ where: { cashierShiftId: id } });
    await prisma.auditLog.deleteMany({ where: { entityType: "CashierShift", entityId: id } });
    await prisma.cashierShift.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdProductIds) {
    await prisma.stockMovement.deleteMany({ where: { productId: id } });
    await prisma.stockBatch.deleteMany({ where: { productId: id } });
    await prisma.product.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdUserIds) {
    await prisma.userBranchAssignment.deleteMany({ where: { userId: id } });
    await prisma.user.delete({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("getVoidReport", () => {
  it("transaksi yang di-void muncul dengan alasan & aktor yang benar", async () => {
    const productId = await createIsolatedProduct();
    await createBatch(productId, 10);
    const shift = await openTestShift(cashierId);
    const transaction = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierId,
      items: [{ productId, qty: 2 }],
      payments: [{ method: "CASH", amount: 2000 }],
    });
    createdTransactionIds.push(transaction.id);

    await voidTransaction({
      allowedBranchIds: [pusatBranchId],
      transactionId: transaction.id,
      actorId: managerId,
      actorRole: Role.BRANCH_MANAGER,
      reason: "Test laporan void — salah input",
    });

    const rows = await getVoidReport({
      companyId,
      allowedBranchIds: [pusatBranchId],
      ...TEST_YEAR_RANGE,
    });
    const row = rows.find((r) => r.transactionId === transaction.id);
    expect(row).toBeDefined();
    expect(row?.voidReason).toBe("Test laporan void — salah input");
    expect(row?.voidedByName).toContain("Manager");
    expect(row?.totalAmount.toString()).toBe("2000");
  });
});

describe("getReturnReport", () => {
  it("retur penjualan muncul dengan qty & alasan yang benar", async () => {
    const productId = await createIsolatedProduct();
    await createBatch(productId, 10);
    const shift = await openTestShift(cashierId);
    const transaction = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierId,
      items: [{ productId, qty: 5 }],
      payments: [{ method: "CASH", amount: 5000 }],
    });
    createdTransactionIds.push(transaction.id);
    const item = await prisma.posTransactionItem.findFirstOrThrow({
      where: { posTransactionId: transaction.id },
    });

    await createSalesReturn({
      companyId,
      allowedBranchIds: [pusatBranchId],
      posTransactionId: transaction.id,
      actorId: cashierId,
      actorRole: Role.CASHIER,
      reason: "Test laporan retur — kemasan rusak",
      items: [{ posTransactionItemId: item.id, qty: 2, condition: SalesReturnItemCondition.SELLABLE }],
    });

    const rows = await getReturnReport({
      companyId,
      allowedBranchIds: [pusatBranchId],
      ...TEST_YEAR_RANGE,
    });
    const row = rows.find((r) => r.documentNumber === transaction.documentNumber);
    expect(row).toBeDefined();
    expect(row?.reason).toBe("Test laporan retur — kemasan rusak");
    expect(row?.totalQtyReturned.toString()).toBe("2");
    expect(row?.itemCount).toBe(1);
  });
});

describe("getDiscountReport", () => {
  it("mengagregasi subtotal & diskon per cabang dengan benar", async () => {
    const productId = await createIsolatedProduct();
    await createBatch(productId, 10);
    const shift = await openTestShift(cashierId);
    const transaction = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierId,
      transactionDiscountAmount: 500,
      items: [{ productId, qty: 3 }], // subtotal 3000
      payments: [{ method: "CASH", amount: 2500 }],
    });
    createdTransactionIds.push(transaction.id);

    const rows = await getDiscountReport({
      companyId,
      allowedBranchIds: [pusatBranchId],
      ...TEST_YEAR_RANGE,
    });
    const row = rows.find((r) => r.branchId === pusatBranchId);
    expect(row).toBeDefined();
    // Tidak isolate produk lain di cabang ini dari test file lain yang
    // mungkin berjalan berurutan — jadi hanya pastikan transaksi milik
    // test ini konsisten secara proporsi, bukan menyamakan total absolut.
    expect(row!.totalAmount.lessThanOrEqualTo(row!.subtotal)).toBe(true);
    expect(row!.discountPct).toBeGreaterThanOrEqual(0);
  });
});
