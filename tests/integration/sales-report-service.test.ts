import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findBranchByCode } from "@/services/branch-service";
import { closeShift, getOpenShiftForUser, openShift } from "@/services/cashier-shift-service";
import { createPaidTransaction } from "@/services/pos-transaction-service";
import { voidTransaction } from "@/services/pos-void-service";
import {
  getDailySalesByBranch,
  getSalesByCashier,
  getSalesByPaymentMethod,
  getSalesByProductCategory,
  getTopProducts,
} from "@/services/reports/sales-report";

let companyId: string;
let pusatBranchId: string;
let timurBranchId: string;
let pusatWarehouseId: string;
let timurWarehouseId: string;
let cashierPusatId: string;
let cashierTimurId: string;
let managerPusatId: string;
let productId: string;
let categoryId: string;

const createdUserIds: string[] = [];
const createdShiftIds: string[] = [];
const createdTransactionIds: string[] = [];

// Rentang hari khusus test ini — jauh dari "hari ini" supaya tidak
// bertabrakan dengan test lain yang membuat transaksi dengan paidAt=now().
const TEST_DAY_A = "2024-03-10";
const TEST_DAY_B = "2024-03-11";

function dayRange(dateStr: string) {
  return {
    dateFrom: new Date(`${dateStr}T00:00:00.000+07:00`),
    dateTo: new Date(`${dateStr}T23:59:59.999+07:00`),
  };
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

async function sellAndDate(params: {
  branchId: string;
  cashierId: string;
  qty: number;
  paidAtDate: string;
  method?: "CASH" | "QRIS";
}) {
  const shift = await openTestShift(params.cashierId, params.branchId);
  const transaction = await createPaidTransaction({
    companyId,
    allowedBranchIds: [params.branchId],
    shiftId: shift.id,
    createdById: params.cashierId,
    items: [{ productId, qty: params.qty }],
    payments: [{ method: params.method ?? "CASH", amount: params.qty * 1000 }],
  });
  createdTransactionIds.push(transaction.id);

  const paidAt = new Date(`${params.paidAtDate}T10:00:00.000+07:00`);
  await prisma.posTransaction.update({ where: { id: transaction.id }, data: { paidAt } });

  return transaction;
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

  pusatWarehouseId = (
    await prisma.warehouse.findFirstOrThrow({ where: { branchId: pusatBranchId, isDefault: true } })
  ).id;
  timurWarehouseId = (
    await prisma.warehouse.findFirstOrThrow({ where: { branchId: timurBranchId, isDefault: true } })
  ).id;

  const cashierPusat = await prisma.user.create({
    data: {
      companyId,
      email: `test-cashier-pusat-sales-${Date.now()}@test.local`,
      name: "Test Cashier Pusat (Sales Report)",
      role: Role.CASHIER,
      passwordHash: "unused-in-tests",
    },
  });
  cashierPusatId = cashierPusat.id;
  createdUserIds.push(cashierPusat.id);
  await prisma.userBranchAssignment.create({ data: { userId: cashierPusat.id, branchId: pusatBranchId } });

  const cashierTimur = await prisma.user.create({
    data: {
      companyId,
      email: `test-cashier-timur-sales-${Date.now()}@test.local`,
      name: "Test Cashier Timur (Sales Report)",
      role: Role.CASHIER,
      passwordHash: "unused-in-tests",
    },
  });
  cashierTimurId = cashierTimur.id;
  createdUserIds.push(cashierTimur.id);
  await prisma.userBranchAssignment.create({ data: { userId: cashierTimur.id, branchId: timurBranchId } });

  const managerPusat = await prisma.user.create({
    data: {
      companyId,
      email: `test-manager-pusat-sales-${Date.now()}@test.local`,
      name: "Test Manager Pusat (Sales Report)",
      role: Role.BRANCH_MANAGER,
      passwordHash: "unused-in-tests",
    },
  });
  managerPusatId = managerPusat.id;
  createdUserIds.push(managerPusat.id);
  await prisma.userBranchAssignment.create({ data: { userId: managerPusat.id, branchId: pusatBranchId } });

  const category = await prisma.category.findFirstOrThrow({ where: { companyId } });
  categoryId = category.id;
  const baseUnit = await prisma.unit.findFirstOrThrow({ where: { companyId, name: "Tablet" } });

  const product = await prisma.product.create({
    data: {
      companyId,
      sku: `TEST-SALESRPT-${Date.now()}`,
      name: "Produk Test Laporan Penjualan",
      categoryId,
      baseUnitId: baseUnit.id,
      defaultSellingPrice: 1000,
      defaultMinStock: 0,
      isActive: true,
    },
  });
  productId = product.id;

  const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
  for (const [branchId, warehouseId] of [
    [pusatBranchId, pusatWarehouseId],
    [timurBranchId, timurWarehouseId],
  ] as const) {
    await prisma.stockBatch.create({
      data: {
        companyId,
        branchId,
        warehouseId,
        productId,
        batchNumber: `TEST-SALESRPT-${branchId}-${Date.now()}`,
        expiryDate: future,
        receivedDate: new Date(),
        qtyOnHand: 1000,
        unitCost: 500,
        status: "AVAILABLE",
      },
    });
  }
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

describe("getDailySalesByBranch", () => {
  it("mengelompokkan omzet per hari & per cabang, dan menghormati allowedBranchIds", async () => {
    await sellAndDate({ branchId: pusatBranchId, cashierId: cashierPusatId, qty: 3, paidAtDate: TEST_DAY_A });
    await sellAndDate({ branchId: timurBranchId, cashierId: cashierTimurId, qty: 5, paidAtDate: TEST_DAY_A });
    await sellAndDate({ branchId: pusatBranchId, cashierId: cashierPusatId, qty: 2, paidAtDate: TEST_DAY_B });

    const { dateFrom, dateTo } = dayRange(TEST_DAY_A);

    // Owner-like: allowedBranchIds mencakup keduanya
    const allBranches = await getDailySalesByBranch({
      companyId,
      allowedBranchIds: [pusatBranchId, timurBranchId],
      dateFrom,
      dateTo,
    });
    const pusatRow = allBranches.find((r) => r.branchId === pusatBranchId);
    const timurRow = allBranches.find((r) => r.branchId === timurBranchId);
    expect(pusatRow?.grossSales.toString()).toBe("3000");
    expect(timurRow?.grossSales.toString()).toBe("5000");
    expect(allBranches.every((r) => r.date === TEST_DAY_A)).toBe(true);

    // Role cabang: allowedBranchIds hanya PUSAT — TIMUR tidak boleh bocor
    const pusatOnly = await getDailySalesByBranch({
      companyId,
      allowedBranchIds: [pusatBranchId],
      dateFrom,
      dateTo,
    });
    expect(pusatOnly).toHaveLength(1);
    expect(pusatOnly[0]?.branchId).toBe(pusatBranchId);
  });

  it("VOIDED tidak ikut terhitung, PARTIALLY_RETURNED tetap ikut (gross)", async () => {
    const toVoid = await sellAndDate({
      branchId: pusatBranchId,
      cashierId: cashierPusatId,
      qty: 4,
      paidAtDate: TEST_DAY_B,
    });
    await voidTransaction({
      allowedBranchIds: [pusatBranchId],
      transactionId: toVoid.id,
      actorId: managerPusatId,
      actorRole: Role.BRANCH_MANAGER,
      reason: "Test void — tidak boleh terhitung di laporan penjualan",
    });

    const { dateFrom, dateTo } = dayRange(TEST_DAY_B);
    const rows = await getDailySalesByBranch({
      companyId,
      allowedBranchIds: [pusatBranchId],
      dateFrom,
      dateTo,
    });
    // Hanya transaksi qty=2 (dari test sebelumnya) yang boleh terhitung —
    // qty=4 yang di-void TIDAK ikut.
    const pusatRow = rows.find((r) => r.branchId === pusatBranchId);
    expect(pusatRow?.grossSales.toString()).toBe("2000");
  });
});

describe("getSalesByCashier", () => {
  it("mengelompokkan omzet per kasir", async () => {
    const { dateFrom, dateTo } = dayRange(TEST_DAY_A);
    const rows = await getSalesByCashier({
      companyId,
      allowedBranchIds: [pusatBranchId, timurBranchId],
      dateFrom,
      dateTo,
    });
    const pusatCashierRow = rows.find((r) => r.cashierId === cashierPusatId);
    const timurCashierRow = rows.find((r) => r.cashierId === cashierTimurId);
    expect(pusatCashierRow?.grossSales.toString()).toBe("3000");
    expect(timurCashierRow?.grossSales.toString()).toBe("5000");
  });
});

describe("getSalesByPaymentMethod", () => {
  it("mengelompokkan total per metode pembayaran", async () => {
    await sellAndDate({
      branchId: pusatBranchId,
      cashierId: cashierPusatId,
      qty: 1,
      paidAtDate: TEST_DAY_A,
      method: "QRIS",
    });

    const { dateFrom, dateTo } = dayRange(TEST_DAY_A);
    const rows = await getSalesByPaymentMethod({
      companyId,
      allowedBranchIds: [pusatBranchId, timurBranchId],
      dateFrom,
      dateTo,
    });
    const qris = rows.find((r) => r.method === "QRIS");
    expect(qris?.totalAmount.toString()).toBe("1000");
  });
});

describe("getSalesByProductCategory & getTopProducts", () => {
  it("menghitung qty & omzet per produk, dan top-products terurut qty desc", async () => {
    const { dateFrom, dateTo } = dayRange(TEST_DAY_A);
    const byProduct = await getSalesByProductCategory({
      companyId,
      allowedBranchIds: [pusatBranchId, timurBranchId],
      dateFrom,
      dateTo,
    });
    const row = byProduct.find((r) => r.productId === productId);
    expect(row).toBeDefined();
    expect(row?.categoryName).toBeTruthy();
    // 3 (pusat) + 5 (timur) + 1 (QRIS pusat) = 9
    expect(row?.qtySold.toString()).toBe("9");

    const filteredOutByCategory = await getSalesByProductCategory({
      companyId,
      allowedBranchIds: [pusatBranchId, timurBranchId],
      categoryId: "non-existent-category-id",
      dateFrom,
      dateTo,
    });
    expect(filteredOutByCategory.find((r) => r.productId === productId)).toBeUndefined();

    const top = await getTopProducts({
      companyId,
      allowedBranchIds: [pusatBranchId, timurBranchId],
      dateFrom,
      dateTo,
      limit: 5,
    });
    expect(top[0]?.productId).toBe(productId);
  });
});
