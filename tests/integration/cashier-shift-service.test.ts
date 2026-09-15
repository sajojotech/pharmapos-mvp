import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role, SalesReturnItemCondition } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findBranchByCode } from "@/services/branch-service";
import { getDefaultCustomer } from "@/services/customer-service";
import {
  addCashMovement,
  approveShift,
  closeShift,
  getOpenShiftForUser,
  listShiftsPaginated,
  openShift,
} from "@/services/cashier-shift-service";
import { createPaidTransaction } from "@/services/pos-transaction-service";
import { createSalesReturn } from "@/services/sales-return-service";

let companyId: string;
let pusatBranchId: string;
let timurBranchId: string;
let cashierUserId: string;
let managerUserId: string;
let customerId: string;

const createdShiftIds: string[] = [];
const createdTransactionIds: string[] = [];
const createdProductIds: string[] = [];
const createdUserIds: string[] = [];

async function cleanupShift(id: string) {
  try {
    await prisma.cashMovement.deleteMany({ where: { cashierShiftId: id } });
    await prisma.auditLog.deleteMany({ where: { entityType: "CashierShift", entityId: id } });
    await prisma.cashierShift.delete({ where: { id } });
  } catch {
    // sudah terhapus — abaikan
  }
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

/**
 * Buat PosTransaction PAID secara manual (tanpa lewat createPaidTransaction,
 * yang butuh produk & validasi stok penuh) — dipakai HANYA untuk menyuntik
 * angka cash sales yang terkontrol demi menguji perhitungan expectedCash di
 * closeShift, tanpa membebani test ini dengan setup produk/stok.
 */
async function createManualCashSale(params: {
  shiftId: string;
  branchId: string;
  cashTendered: number;
  changeAmount: number;
  totalAmount: number;
}) {
  const documentNumber = `TEST-INV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const trx = await prisma.posTransaction.create({
    data: {
      companyId,
      branchId: params.branchId,
      cashierShiftId: params.shiftId,
      customerId,
      documentNumber,
      subtotal: params.totalAmount.toString(),
      discountAmount: "0",
      totalAmount: params.totalAmount.toString(),
      changeAmount: params.changeAmount.toString(),
      createdById: cashierUserId,
      paidAt: new Date(),
      payments: { create: [{ method: "CASH", amount: params.cashTendered.toString() }] },
    },
  });
  createdTransactionIds.push(trx.id);
  return trx;
}

async function createManualNonCashSale(params: {
  shiftId: string;
  branchId: string;
  amount: number;
}) {
  const documentNumber = `TEST-INV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const trx = await prisma.posTransaction.create({
    data: {
      companyId,
      branchId: params.branchId,
      cashierShiftId: params.shiftId,
      customerId,
      documentNumber,
      subtotal: params.amount.toString(),
      discountAmount: "0",
      totalAmount: params.amount.toString(),
      changeAmount: "0",
      createdById: cashierUserId,
      paidAt: new Date(),
      payments: { create: [{ method: "QRIS", amount: params.amount.toString() }] },
    },
  });
  createdTransactionIds.push(trx.id);
  return trx;
}

beforeAll(async () => {
  const company = await prisma.company.findFirstOrThrow();
  companyId = company.id;

  const pusat = await findBranchByCode(companyId, "PUSAT");
  const timur = await findBranchByCode(companyId, "TIMUR");
  if (!pusat || !timur) throw new Error("Seed cabang tidak lengkap");
  pusatBranchId = pusat.id;
  timurBranchId = timur.id;

  const customer = await getDefaultCustomer(companyId);
  customerId = customer.id;

  const cashier = await prisma.user.create({
    data: {
      companyId,
      email: `test-cashier-shift-${Date.now()}@test.local`,
      name: "Test Cashier (shift test)",
      role: Role.CASHIER,
      passwordHash: "unused-in-tests",
    },
  });
  cashierUserId = cashier.id;
  createdUserIds.push(cashier.id);
  await prisma.userBranchAssignment.create({
    data: { userId: cashier.id, branchId: pusatBranchId },
  });

  const manager = await prisma.user.create({
    data: {
      companyId,
      email: `test-manager-shift-${Date.now()}@test.local`,
      name: "Test Manager (shift test)",
      role: Role.BRANCH_MANAGER,
      passwordHash: "unused-in-tests",
    },
  });
  managerUserId = manager.id;
  createdUserIds.push(manager.id);
  await prisma.userBranchAssignment.create({
    data: { userId: manager.id, branchId: pusatBranchId },
  });
});

afterAll(async () => {
  for (const id of createdTransactionIds) await cleanupTransaction(id);
  for (const id of createdShiftIds) await cleanupShift(id);
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

describe("openShift", () => {
  it("berhasil membuka shift dengan status OPEN", async () => {
    const shift = await openShift({
      companyId,
      branchId: pusatBranchId,
      userId: cashierUserId,
      openingCash: 100000,
    });
    createdShiftIds.push(shift.id);

    expect(shift.status).toBe("OPEN");
    expect(shift.openingCash.toString()).toBe("100000");

    await cleanupShift(shift.id);
    createdShiftIds.splice(createdShiftIds.indexOf(shift.id), 1);
  });

  it("menolak membuka shift kedua selagi user masih punya shift OPEN", async () => {
    const shift = await openShift({
      companyId,
      branchId: pusatBranchId,
      userId: cashierUserId,
      openingCash: 100000,
    });
    createdShiftIds.push(shift.id);

    await expect(
      openShift({ companyId, branchId: pusatBranchId, userId: cashierUserId, openingCash: 50000 }),
    ).rejects.toThrow("masih memiliki shift yang belum ditutup");

    // Juga menolak di cabang lain — satu user hanya boleh satu shift OPEN
    // LINTAS cabang mana pun (lihat docs/POS.md).
    await expect(
      openShift({ companyId, branchId: timurBranchId, userId: cashierUserId, openingCash: 50000 }),
    ).rejects.toThrow("masih memiliki shift yang belum ditutup");

    await cleanupShift(shift.id);
    createdShiftIds.splice(createdShiftIds.indexOf(shift.id), 1);
  });

  it("getOpenShiftForUser mengembalikan null bila tidak ada shift OPEN", async () => {
    const result = await getOpenShiftForUser(cashierUserId);
    expect(result).toBeNull();
  });
});

describe("addCashMovement & closeShift", () => {
  it("menghitung expectedCash dari opening + cash sales bersih + cash in - cash out", async () => {
    const shift = await openShift({
      companyId,
      branchId: pusatBranchId,
      userId: cashierUserId,
      openingCash: 100000,
    });
    createdShiftIds.push(shift.id);

    await addCashMovement({
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      direction: "IN",
      amount: 50000,
      reason: "Tambahan modal kembalian",
      actorId: cashierUserId,
    });
    await addCashMovement({
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      direction: "OUT",
      amount: 20000,
      reason: "Setor sebagian ke brankas",
      actorId: cashierUserId,
    });

    // Cash sale: tender 200.000 tunai, kembalian 30.000 -> bersih 170.000
    // masuk sebagai cash sales. Total transaksi 170.000 (konsisten, walau
    // closeShift tidak membaca totalAmount untuk perhitungan ini).
    await createManualCashSale({
      shiftId: shift.id,
      branchId: pusatBranchId,
      cashTendered: 200000,
      changeAmount: 30000,
      totalAmount: 170000,
    });
    // Pembayaran non-tunai TIDAK ikut dihitung sebagai cash sales.
    await createManualNonCashSale({ shiftId: shift.id, branchId: pusatBranchId, amount: 50000 });

    // expectedCash = 100000 + (200000-30000) + 50000 - 20000 = 300000
    const closed = await closeShift({
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      actorId: cashierUserId,
      actualCash: 300000,
    });

    expect(closed.expectedCash?.toString()).toBe("300000");
    expect(closed.variance?.toString()).toBe("0");
    expect(closed.status).toBe("CLOSED");
  });

  it("Fase 11 hardening: retur sebagian TIDAK menghilangkan penjualan tunai asli dari expectedCash", async () => {
    // Regresi untuk bug yang ditemukan audit: computeNetCashSales dulu
    // memfilter status PAID persis — begitu transaksi berubah jadi
    // PARTIALLY_RETURNED, SELURUH pembayaran tunainya (bukan cuma bagian
    // yang diretur) hilang dari perhitungan kas.
    const category = await prisma.category.findFirstOrThrow({ where: { companyId } });
    const baseUnit = await prisma.unit.findFirstOrThrow({ where: { companyId, name: "Tablet" } });
    const product = await prisma.product.create({
      data: {
        companyId,
        sku: `TEST-CASHRPT-${Date.now()}`,
        name: "Produk Test Cash Reconciliation",
        categoryId: category.id,
        baseUnitId: baseUnit.id,
        defaultSellingPrice: 1000,
        defaultMinStock: 0,
        isActive: true,
      },
    });
    createdProductIds.push(product.id);
    const warehouse = await prisma.warehouse.findFirstOrThrow({
      where: { branchId: pusatBranchId, isDefault: true },
    });
    await prisma.stockBatch.create({
      data: {
        companyId,
        branchId: pusatBranchId,
        warehouseId: warehouse.id,
        productId: product.id,
        batchNumber: `TEST-CASHRPT-${Date.now()}`,
        expiryDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
        receivedDate: new Date(),
        qtyOnHand: 10,
        unitCost: 500,
        status: "AVAILABLE",
      },
    });

    const shift = await openShift({
      companyId,
      branchId: pusatBranchId,
      userId: cashierUserId,
      openingCash: 0,
    });
    createdShiftIds.push(shift.id);

    const transaction = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId: product.id, qty: 5 }],
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
      actorId: cashierUserId,
      actorRole: Role.CASHIER,
      reason: "Test regresi cash reconciliation",
      items: [{ posTransactionItemId: item.id, qty: 2, condition: SalesReturnItemCondition.SELLABLE }],
    });

    const posTransaction = await prisma.posTransaction.findUniqueOrThrow({
      where: { id: transaction.id },
    });
    expect(posTransaction.status).toBe("PARTIALLY_RETURNED");

    // Uang tunai Rp 5.000 dari penjualan ASLI harus tetap terhitung penuh
    // di expectedCash, walau transaksinya sekarang PARTIALLY_RETURNED.
    const closed = await closeShift({
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      actorId: cashierUserId,
      actualCash: 5000,
    });
    expect(closed.expectedCash?.toString()).toBe("5000");
    expect(closed.variance?.toString()).toBe("0");
  });

  it("menjadi PENDING_APPROVAL bila selisih melebihi threshold, lalu bisa disetujui manager", async () => {
    const shift = await openShift({
      companyId,
      branchId: pusatBranchId,
      userId: cashierUserId,
      openingCash: 100000,
    });
    createdShiftIds.push(shift.id);

    // expectedCash = 100000 (tidak ada mutasi lain). Threshold seed = 10000.
    // actualCash dibuat selisih 50000 supaya jelas melebihi threshold.
    const closed = await closeShift({
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      actorId: cashierUserId,
      actualCash: 150000,
    });

    expect(closed.status).toBe("PENDING_APPROVAL");
    expect(closed.variance?.toString()).toBe("50000");

    await expect(
      approveShift({
        allowedBranchIds: [pusatBranchId],
        shiftId: shift.id,
        actorId: cashierUserId,
        actorRole: Role.CASHIER,
      }),
    ).rejects.toThrow("Owner/Manager Cabang");

    const approved = await approveShift({
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      actorId: managerUserId,
      actorRole: Role.BRANCH_MANAGER,
    });
    expect(approved.status).toBe("CLOSED");
    expect(approved.approvedById).toBe(managerUserId);
  });

  it("menolak akses shift di luar cabang yang diizinkan pemanggil", async () => {
    const shift = await openShift({
      companyId,
      branchId: pusatBranchId,
      userId: cashierUserId,
      openingCash: 100000,
    });
    createdShiftIds.push(shift.id);

    await expect(
      closeShift({
        allowedBranchIds: [timurBranchId],
        shiftId: shift.id,
        actorId: cashierUserId,
        actualCash: 100000,
      }),
    ).rejects.toThrow("tidak ditemukan atau di luar akses cabang");

    await expect(
      addCashMovement({
        allowedBranchIds: [timurBranchId],
        shiftId: shift.id,
        direction: "IN",
        amount: 10000,
        reason: "test",
        actorId: cashierUserId,
      }),
    ).rejects.toThrow("tidak ditemukan atau di luar akses cabang");
  });
});

describe("listShiftsPaginated — filter dateFrom/dateTo (Fase 10)", () => {
  it("hanya mengembalikan shift yang openedAt-nya berada dalam rentang", async () => {
    const existing = await getOpenShiftForUser(cashierUserId);
    if (existing) {
      await closeShift({
        allowedBranchIds: [existing.branchId],
        shiftId: existing.id,
        actorId: cashierUserId,
        actualCash: 0,
      });
    }

    const shift = await openShift({
      companyId,
      branchId: pusatBranchId,
      userId: cashierUserId,
      openingCash: 50000,
    });
    createdShiftIds.push(shift.id);

    const farPastDate = new Date("2020-06-15T03:00:00.000Z");
    await prisma.cashierShift.update({ where: { id: shift.id }, data: { openedAt: farPastDate } });

    const withinRange = await listShiftsPaginated({
      companyId,
      allowedBranchIds: [pusatBranchId],
      dateFrom: new Date("2020-06-15T00:00:00.000Z"),
      dateTo: new Date("2020-06-15T23:59:59.999Z"),
      page: 1,
    });
    expect(withinRange.data.some((s) => s.id === shift.id)).toBe(true);

    const outsideRange = await listShiftsPaginated({
      companyId,
      allowedBranchIds: [pusatBranchId],
      dateFrom: new Date("2021-01-01T00:00:00.000Z"),
      dateTo: new Date("2021-01-02T00:00:00.000Z"),
      page: 1,
    });
    expect(outsideRange.data.some((s) => s.id === shift.id)).toBe(false);

    // Tanpa dateFrom/dateTo (pola lama /cashier/shifts) — tidak terpengaruh.
    const noDateFilter = await listShiftsPaginated({
      companyId,
      allowedBranchIds: [pusatBranchId],
      page: 1,
      pageSize: 1000,
    });
    expect(noDateFilter.data.some((s) => s.id === shift.id)).toBe(true);
  });
});
