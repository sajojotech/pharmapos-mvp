import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findBranchByCode } from "@/services/branch-service";
import { closeShift, getOpenShiftForUser, openShift } from "@/services/cashier-shift-service";
import { createPaidTransaction } from "@/services/pos-transaction-service";
import { getBranchDashboardSnapshot, getGlobalDashboardSnapshot } from "@/services/reports/dashboard-service";
import { getConsolidatedReport } from "@/services/reports/consolidated-report";
import { jakartaDayEnd, jakartaDayStart } from "@/lib/timezone";

let companyId: string;
let pusatBranchId: string;
let timurBranchId: string;
let pusatWarehouseId: string;
let timurWarehouseId: string;
let cashierId: string;
let productId: string;

const createdUserIds: string[] = [];
const createdShiftIds: string[] = [];
const createdTransactionIds: string[] = [];

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

  pusatWarehouseId = (
    await prisma.warehouse.findFirstOrThrow({ where: { branchId: pusatBranchId, isDefault: true } })
  ).id;
  timurWarehouseId = (
    await prisma.warehouse.findFirstOrThrow({ where: { branchId: timurBranchId, isDefault: true } })
  ).id;

  const cashier = await prisma.user.create({
    data: {
      companyId,
      email: `test-cashier-dashboard-${Date.now()}@test.local`,
      name: "Test Cashier (Dashboard)",
      role: Role.CASHIER,
      passwordHash: "unused-in-tests",
    },
  });
  cashierId = cashier.id;
  createdUserIds.push(cashier.id);
  await prisma.userBranchAssignment.create({ data: { userId: cashier.id, branchId: pusatBranchId } });

  const category = await prisma.category.findFirstOrThrow({ where: { companyId } });
  const baseUnit = await prisma.unit.findFirstOrThrow({ where: { companyId, name: "Tablet" } });
  const product = await prisma.product.create({
    data: {
      companyId,
      sku: `TEST-DASHBOARD-${Date.now()}`,
      name: "Produk Test Dashboard",
      categoryId: category.id,
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
        batchNumber: `TEST-DASHBOARD-${branchId}-${Date.now()}`,
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

describe("getBranchDashboardSnapshot", () => {
  it("hanya berisi data cabang aktif (tidak bocor ke cabang lain)", async () => {
    const shift = await openTestShift(cashierId, pusatBranchId);
    const transaction = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierId,
      items: [{ productId, qty: 4 }],
      payments: [{ method: "CASH", amount: 4000 }],
    });
    createdTransactionIds.push(transaction.id);

    const snapshot = await getBranchDashboardSnapshot({
      companyId,
      branchId: pusatBranchId,
      userId: cashierId,
    });

    expect(snapshot.todayRevenue.toNumber()).toBeGreaterThanOrEqual(4000);
    expect(snapshot.openShift?.branch.code).toBe("PUSAT");
    expect(snapshot.pendingTransfers.every((t) => t.sourceBranch.code === "PUSAT" || t.destinationBranch.code === "PUSAT")).toBe(true);
  });
});

describe("getGlobalDashboardSnapshot", () => {
  it("menjumlahkan omzet hari ini lintas cabang sesuai allowedBranchIds", async () => {
    const snapshot = await getGlobalDashboardSnapshot({
      companyId,
      allowedBranchIds: [pusatBranchId, timurBranchId],
    });

    expect(snapshot.todayRevenue.toNumber()).toBeGreaterThanOrEqual(4000);
    expect(snapshot.salesByBranchToday.some((r) => r.branchId === pusatBranchId)).toBe(true);
  });
});

describe("getConsolidatedReport", () => {
  it("menghormati rentang tanggal yang diberikan (bukan hanya hari ini)", async () => {
    const now = new Date();
    const dateFrom = jakartaDayStart(now.toISOString().slice(0, 10));
    const dateTo = jakartaDayEnd(now.toISOString().slice(0, 10));

    const report = await getConsolidatedReport({
      companyId,
      allowedBranchIds: [pusatBranchId, timurBranchId],
      dateFrom,
      dateTo,
    });
    expect(report.branchTotals.some((r) => r.branchId === pusatBranchId)).toBe(true);
    expect(report.totalRevenue.toNumber()).toBeGreaterThanOrEqual(4000);

    // Rentang jauh di masa lalu — tidak boleh menemukan transaksi test ini.
    const emptyReport = await getConsolidatedReport({
      companyId,
      allowedBranchIds: [pusatBranchId, timurBranchId],
      dateFrom: new Date("2000-01-01T00:00:00.000Z"),
      dateTo: new Date("2000-01-02T00:00:00.000Z"),
    });
    expect(emptyReport.totalTransactionCount).toBe(0);
  });
});
