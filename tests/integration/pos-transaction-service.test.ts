import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findBranchByCode } from "@/services/branch-service";
import { closeShift, getOpenShiftForUser, openShift } from "@/services/cashier-shift-service";
import {
  createPaidTransaction,
  createPaidTransactionWithBatchOverride,
  searchSellableProducts,
} from "@/services/pos-transaction-service";

let companyId: string;
let pusatBranchId: string;
let timurBranchId: string;
let cashierUserId: string;
let otherCashierUserId: string;
let productId: string;
let inactiveProductId: string;
let warehouseId: string;

const FUTURE_EFFECTIVE_DATE = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);

const createdShiftIds: string[] = [];
const createdTransactionIds: string[] = [];
const createdUserIds: string[] = [];
const createdBranchPriceIds: string[] = [];
/** Produk khusus per test FEFO/override/concurrency (lihat createFefoTestProduct) —
 * dibersihkan di afterAll bersama batch/movement miliknya. */
const createdFefoProductIds: string[] = [];

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** Batch dibuat langsung (bukan lewat receiveStockToBatch) supaya test bisa
 * mengontrol persis status/qty/ED-nya (termasuk kondisi yang seharusnya
 * DITOLAK oleh FEFO: expired/blocked/quarantined/damaged/qty nol). */
async function createTestBatch(
  testProductId: string,
  overrides: {
    qty: number;
    expiryOffsetDays: number;
    unitCost?: number;
    status?: "AVAILABLE" | "BLOCKED" | "QUARANTINED" | "DAMAGED" | "EXPIRED";
  },
) {
  return prisma.stockBatch.create({
    data: {
      companyId,
      branchId: pusatBranchId,
      warehouseId,
      productId: testProductId,
      batchNumber: `TEST-POS-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      expiryDate: daysFromNow(overrides.expiryOffsetDays),
      receivedDate: new Date(),
      qtyOnHand: overrides.qty,
      unitCost: overrides.unitCost ?? 500,
      status: overrides.status ?? "AVAILABLE",
    },
  });
}

/**
 * Produk BARU khusus untuk SATU test (bukan produk `productId` yang dipakai
 * bersama semua test lain di file ini) — setiap test alokasi FEFO butuh
 * pool batch yang benar-benar kosong/terkontrol; berbagi satu produk lintas
 * banyak test akan membuat batch dari test SEBELUMNYA (yang sengaja
 * disisakan tidak habis, mis. batch ED jauh) ikut terlihat oleh
 * planFefoAllocation test BERIKUTNYA dan merusak asersi presisi FEFO.
 */
async function createFefoTestProduct(): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({ where: { companyId } });
  const baseUnit = await prisma.unit.findFirstOrThrow({ where: { companyId, name: "Tablet" } });
  const product = await prisma.product.create({
    data: {
      companyId,
      sku: `TEST-FEFO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "Produk Test FEFO",
      categoryId: category.id,
      baseUnitId: baseUnit.id,
      defaultSellingPrice: 1000,
      defaultMinStock: 0,
      isActive: true,
    },
  });
  createdFefoProductIds.push(product.id);
  return product.id;
}

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
    await prisma.payment.deleteMany({ where: { posTransactionId: id } });
    // PosTransactionItemBatchAllocation ikut terhapus otomatis lewat
    // onDelete: Cascade dari PosTransactionItem.
    await prisma.posTransactionItem.deleteMany({ where: { posTransactionId: id } });
    await prisma.auditLog.deleteMany({ where: { entityType: "PosTransaction", entityId: id } });
    await prisma.posTransaction.delete({ where: { id } });
  } catch {
    // sudah terhapus — abaikan
  }
}

/**
 * Setiap test butuh shift OPEN sendiri, tapi satu user hanya boleh punya
 * SATU shift OPEN lintas cabang mana pun — tutup dulu shift lama milik user
 * tsb (bila masih ada dari test sebelumnya) supaya openShift tidak ditolak.
 */
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
      email: `test-cashier-pos-${Date.now()}@test.local`,
      name: "Test Cashier (POS test)",
      role: Role.CASHIER,
      passwordHash: "unused-in-tests",
    },
  });
  cashierUserId = cashier.id;
  createdUserIds.push(cashier.id);
  await prisma.userBranchAssignment.create({ data: { userId: cashier.id, branchId: pusatBranchId } });

  const otherCashier = await prisma.user.create({
    data: {
      companyId,
      email: `test-cashier-pos-other-${Date.now()}@test.local`,
      name: "Test Cashier Lain (POS test)",
      role: Role.CASHIER,
      passwordHash: "unused-in-tests",
    },
  });
  otherCashierUserId = otherCashier.id;
  createdUserIds.push(otherCashier.id);
  await prisma.userBranchAssignment.create({
    data: { userId: otherCashier.id, branchId: pusatBranchId },
  });

  const category = await prisma.category.findFirstOrThrow({ where: { companyId } });
  const baseUnit = await prisma.unit.findFirstOrThrow({ where: { companyId, name: "Tablet" } });

  const product = await prisma.product.create({
    data: {
      companyId,
      sku: `TEST-POS-${Date.now()}`,
      name: "Produk Test POS Sejahtera",
      genericName: "Test Generic Sejahtera",
      categoryId: category.id,
      baseUnitId: baseUnit.id,
      defaultSellingPrice: 1000,
      defaultMinStock: 0,
      isActive: true,
    },
  });
  productId = product.id;
  await prisma.productBarcode.create({
    data: { productId: product.id, barcode: `TESTBARCODE${Date.now()}` },
  });

  const inactiveProduct = await prisma.product.create({
    data: {
      companyId,
      sku: `TEST-POS-INACTIVE-${Date.now()}`,
      name: "Produk Test POS Nonaktif",
      categoryId: category.id,
      baseUnitId: baseUnit.id,
      defaultSellingPrice: 1000,
      defaultMinStock: 0,
      isActive: false,
    },
  });
  inactiveProductId = inactiveProduct.id;
});

afterAll(async () => {
  for (const id of createdTransactionIds) await cleanupTransaction(id);
  for (const id of createdShiftIds) await cleanupShift(id);
  for (const id of createdBranchPriceIds) {
    await prisma.productBranchPrice.delete({ where: { id } }).catch(() => {});
  }
  await prisma.stockMovement.deleteMany({ where: { productId } });
  await prisma.stockBatch.deleteMany({ where: { productId } });
  await prisma.productBarcode.deleteMany({ where: { productId } });
  await prisma.product.delete({ where: { id: productId } });
  await prisma.product.delete({ where: { id: inactiveProductId } });
  for (const id of createdFefoProductIds) {
    await prisma.stockMovement.deleteMany({ where: { productId: id } });
    await prisma.stockBatch.deleteMany({ where: { productId: id } });
    await prisma.product.delete({ where: { id } });
  }
  for (const id of createdUserIds) {
    await prisma.userBranchAssignment.deleteMany({ where: { userId: id } });
    await prisma.user.delete({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("searchSellableProducts", () => {
  it("menemukan produk lewat barcode persis", async () => {
    const barcode = (await prisma.productBarcode.findFirstOrThrow({ where: { productId } }))
      .barcode;
    const results = await searchSellableProducts({
      companyId,
      branchId: pusatBranchId,
      query: barcode,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(productId);
  });

  it("menemukan produk lewat SKU, nama, dan nama generik (parsial)", async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });

    const bySku = await searchSellableProducts({ companyId, branchId: pusatBranchId, query: product.sku });
    expect(bySku.some((p) => p.id === productId)).toBe(true);

    const byName = await searchSellableProducts({
      companyId,
      branchId: pusatBranchId,
      query: "Test POS Sejahtera",
    });
    expect(byName.some((p) => p.id === productId)).toBe(true);

    const byGeneric = await searchSellableProducts({
      companyId,
      branchId: pusatBranchId,
      query: "Test Generic Sejahtera",
    });
    expect(byGeneric.some((p) => p.id === productId)).toBe(true);
  });

  it("tidak mengembalikan produk nonaktif", async () => {
    const inactive = await prisma.product.findUniqueOrThrow({ where: { id: inactiveProductId } });
    const results = await searchSellableProducts({
      companyId,
      branchId: pusatBranchId,
      query: inactive.sku,
    });
    expect(results).toHaveLength(0);
  });

  it("menerapkan harga override cabang bila aktif, dan default bila tidak", async () => {
    const override = await prisma.productBranchPrice.create({
      data: { branchId: pusatBranchId, productId, price: 1500, isActive: true },
    });

    try {
      const atPusat = await searchSellableProducts({
        companyId,
        branchId: pusatBranchId,
        query: "Test POS Sejahtera",
      });
      expect(atPusat.find((p) => p.id === productId)?.sellingPrice).toBe("1500");

      const atTimur = await searchSellableProducts({
        companyId,
        branchId: timurBranchId,
        query: "Test POS Sejahtera",
      });
      expect(atTimur.find((p) => p.id === productId)?.sellingPrice).toBe("1000");
    } finally {
      await prisma.productBranchPrice.delete({ where: { id: override.id } });
    }
  });

  it("mengabaikan harga override yang belum efektif (effectiveDate di masa depan)", async () => {
    const future = await prisma.productBranchPrice.create({
      data: {
        branchId: timurBranchId,
        productId,
        price: 9999,
        isActive: true,
        effectiveDate: FUTURE_EFFECTIVE_DATE,
      },
    });

    try {
      const results = await searchSellableProducts({
        companyId,
        branchId: timurBranchId,
        query: "Test POS Sejahtera",
      });
      expect(results.find((p) => p.id === productId)?.sellingPrice).toBe("1000");
    } finally {
      await prisma.productBranchPrice.delete({ where: { id: future.id } });
    }
  });
});

describe("createPaidTransaction — guard/RBAC (Fase 06, masih berlaku)", () => {
  it("menolak pembayaran bila shift tidak OPEN", async () => {
    const batch = await createTestBatch(productId, { qty: 5, expiryOffsetDays: 30 });
    const shift = await openTestShift(cashierUserId, pusatBranchId);
    await closeShift({
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      actorId: cashierUserId,
      actualCash: 0,
    });

    await expect(
      createPaidTransaction({
        companyId,
        allowedBranchIds: [pusatBranchId],
        shiftId: shift.id,
        createdById: cashierUserId,
        items: [{ productId, qty: 1 }],
        payments: [{ method: "CASH", amount: 1000 }],
      }),
    ).rejects.toThrow("Shift tidak berstatus OPEN");

    const after = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(after.qtyOnHand.toString()).toBe("5");
  });

  it("menolak pembayaran bila shift bukan milik user yang melakukan transaksi", async () => {
    await createTestBatch(productId, { qty: 5, expiryOffsetDays: 30 });
    const shift = await openTestShift(cashierUserId, pusatBranchId);

    await expect(
      createPaidTransaction({
        companyId,
        allowedBranchIds: [pusatBranchId],
        shiftId: shift.id,
        createdById: otherCashierUserId,
        items: [{ productId, qty: 1 }],
        payments: [{ method: "CASH", amount: 1000 }],
      }),
    ).rejects.toThrow("Shift ini bukan milik Anda");
  });

  it("menolak akses shift di luar cabang yang diizinkan pemanggil", async () => {
    await createTestBatch(productId, { qty: 5, expiryOffsetDays: 30 });
    const shift = await openTestShift(cashierUserId, pusatBranchId);

    await expect(
      createPaidTransaction({
        companyId,
        allowedBranchIds: [timurBranchId],
        shiftId: shift.id,
        createdById: cashierUserId,
        items: [{ productId, qty: 1 }],
        payments: [{ method: "CASH", amount: 1000 }],
      }),
    ).rejects.toThrow("tidak ditemukan atau di luar akses cabang");
  });

  it("split payment: total pembayaran non-tunai+tunai harus sama dengan grand total, dan menghitung kembalian tunai", async () => {
    await createTestBatch(productId, { qty: 10, expiryOffsetDays: 30 });
    const shift = await openTestShift(cashierUserId, pusatBranchId);

    const transaction = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId, qty: 3 }], // 3 x 1000 = 3000
      payments: [
        { method: "QRIS", amount: 2000 },
        { method: "CASH", amount: 1500 }, // total tender 3500 vs total 3000 -> kembalian 500
      ],
    });
    createdTransactionIds.push(transaction.id);

    expect(transaction.totalAmount.toString()).toBe("3000");
    expect(transaction.changeAmount.toString()).toBe("500");
  });

  it("menolak split payment yang kurang dari grand total (stok tidak berkurang)", async () => {
    const batch = await createTestBatch(productId, { qty: 10, expiryOffsetDays: 30 });
    const shift = await openTestShift(cashierUserId, pusatBranchId);

    await expect(
      createPaidTransaction({
        companyId,
        allowedBranchIds: [pusatBranchId],
        shiftId: shift.id,
        createdById: cashierUserId,
        items: [{ productId, qty: 2 }], // 2000
        payments: [{ method: "QRIS", amount: 1000 }],
      }),
    ).rejects.toThrow("Total pembayaran kurang dari total transaksi");

    const after = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(after.qtyOnHand.toString()).toBe("10");
  });

  it("menghasilkan nomor invoice yang unik antar transaksi", async () => {
    await createTestBatch(productId, { qty: 10, expiryOffsetDays: 30 });

    const shiftA = await openTestShift(cashierUserId, pusatBranchId);
    const trxA = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shiftA.id,
      createdById: cashierUserId,
      items: [{ productId, qty: 1 }],
      payments: [{ method: "CASH", amount: 1000 }],
    });
    createdTransactionIds.push(trxA.id);
    await closeShift({
      allowedBranchIds: [pusatBranchId],
      shiftId: shiftA.id,
      actorId: cashierUserId,
      actualCash: 1000,
    });

    const shiftB = await openTestShift(cashierUserId, pusatBranchId);
    const trxB = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shiftB.id,
      createdById: cashierUserId,
      items: [{ productId, qty: 1 }],
      payments: [{ method: "CASH", amount: 1000 }],
    });
    createdTransactionIds.push(trxB.id);

    expect(trxA.documentNumber).not.toBe(trxB.documentNumber);
  });
});

describe("createPaidTransaction — alokasi FEFO & pengurangan stok (Fase 07)", () => {
  it("memilih batch dengan ED paling dekat (FEFO) saat satu batch sudah cukup", async () => {
    const testProductId = await createFefoTestProduct();
    const nearBatch = await createTestBatch(testProductId, { qty: 5, expiryOffsetDays: 10 });
    const farBatch = await createTestBatch(testProductId, { qty: 5, expiryOffsetDays: 100 });

    const shift = await openTestShift(cashierUserId, pusatBranchId);
    const transaction = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId: testProductId, qty: 3 }],
      payments: [{ method: "CASH", amount: 3000 }],
    });
    createdTransactionIds.push(transaction.id);

    const near = await prisma.stockBatch.findUniqueOrThrow({ where: { id: nearBatch.id } });
    const far = await prisma.stockBatch.findUniqueOrThrow({ where: { id: farBatch.id } });
    expect(near.qtyOnHand.toString()).toBe("2"); // 5 - 3
    expect(far.qtyOnHand.toString()).toBe("5"); // tidak tersentuh

    const items = await prisma.posTransactionItem.findMany({
      where: { posTransactionId: transaction.id },
      include: { allocations: true },
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.allocations).toHaveLength(1);
    expect(items[0]?.allocations[0]?.stockBatchId).toBe(nearBatch.id);
    expect(items[0]?.allocations[0]?.qtyOut.toString()).toBe("3");

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { stockBatchId: nearBatch.id, referenceType: "PosTransaction", referenceId: transaction.id },
    });
    expect(movement.movementType).toBe("POS_SALE");
    expect(movement.qtyOut.toString()).toBe("3");
    expect(movement.balanceAfter.toString()).toBe("2");
  });

  it("tidak mengalokasikan batch yang sudah lewat ED walau statusnya masih AVAILABLE", async () => {
    const testProductId = await createFefoTestProduct();
    const expiredBatch = await createTestBatch(testProductId, { qty: 100, expiryOffsetDays: -10 });
    const validBatch = await createTestBatch(testProductId, { qty: 4, expiryOffsetDays: 30 });

    const shift = await openTestShift(cashierUserId, pusatBranchId);
    const transaction = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId: testProductId, qty: 4 }],
      payments: [{ method: "CASH", amount: 4000 }],
    });
    createdTransactionIds.push(transaction.id);

    const expired = await prisma.stockBatch.findUniqueOrThrow({ where: { id: expiredBatch.id } });
    const valid = await prisma.stockBatch.findUniqueOrThrow({ where: { id: validBatch.id } });
    expect(expired.qtyOnHand.toString()).toBe("100"); // tidak tersentuh
    expect(valid.qtyOnHand.toString()).toBe("0"); // habis dialokasikan
  });

  it("tidak mengalokasikan batch BLOCKED/QUARANTINED/DAMAGED/qty nol", async () => {
    const testProductId = await createFefoTestProduct();
    const blocked = await createTestBatch(testProductId, { qty: 50, expiryOffsetDays: 5, status: "BLOCKED" });
    const quarantined = await createTestBatch(testProductId, {
      qty: 50,
      expiryOffsetDays: 6,
      status: "QUARANTINED",
    });
    const damaged = await createTestBatch(testProductId, { qty: 50, expiryOffsetDays: 7, status: "DAMAGED" });
    const empty = await createTestBatch(testProductId, { qty: 0, expiryOffsetDays: 8 });
    const valid = await createTestBatch(testProductId, { qty: 2, expiryOffsetDays: 9 });

    const shift = await openTestShift(cashierUserId, pusatBranchId);
    const transaction = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId: testProductId, qty: 2 }],
      payments: [{ method: "CASH", amount: 2000 }],
    });
    createdTransactionIds.push(transaction.id);

    for (const untouched of [blocked, quarantined, damaged, empty]) {
      const after = await prisma.stockBatch.findUniqueOrThrow({ where: { id: untouched.id } });
      expect(after.qtyOnHand.toString()).toBe(untouched.qtyOnHand.toString());
    }
    const validAfter = await prisma.stockBatch.findUniqueOrThrow({ where: { id: valid.id } });
    expect(validAfter.qtyOnHand.toString()).toBe("0");
  });

  it("membagi alokasi ke batch berikutnya bila qty melebihi batch pertama (FEFO order)", async () => {
    const testProductId = await createFefoTestProduct();
    const batchA = await createTestBatch(testProductId, { qty: 4, expiryOffsetDays: 10 });
    const batchB = await createTestBatch(testProductId, { qty: 10, expiryOffsetDays: 20 });

    const shift = await openTestShift(cashierUserId, pusatBranchId);
    const transaction = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId: testProductId, qty: 7 }],
      payments: [{ method: "CASH", amount: 7000 }],
    });
    createdTransactionIds.push(transaction.id);

    const a = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batchA.id } });
    const b = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batchB.id } });
    expect(a.qtyOnHand.toString()).toBe("0");
    expect(b.qtyOnHand.toString()).toBe("7"); // 10 - 3

    const items = await prisma.posTransactionItem.findMany({
      where: { posTransactionId: transaction.id },
      include: { allocations: { orderBy: { createdAt: "asc" } } },
    });
    const allocations = items[0]?.allocations ?? [];
    expect(allocations).toHaveLength(2);
    expect(allocations[0]?.stockBatchId).toBe(batchA.id);
    expect(allocations[0]?.qtyOut.toString()).toBe("4");
    expect(allocations[1]?.stockBatchId).toBe(batchB.id);
    expect(allocations[1]?.qtyOut.toString()).toBe("3");

    const movements = await prisma.stockMovement.findMany({
      where: { referenceType: "PosTransaction", referenceId: transaction.id },
    });
    expect(movements).toHaveLength(2);
  });

  it("menyimpan snapshot batchNumber, ED, qty, dan unitCost pada allocation", async () => {
    const testProductId = await createFefoTestProduct();
    const batch = await createTestBatch(testProductId, { qty: 5, expiryOffsetDays: 45, unitCost: 725 });

    const shift = await openTestShift(cashierUserId, pusatBranchId);
    const transaction = await createPaidTransaction({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId: testProductId, qty: 2 }],
      payments: [{ method: "CASH", amount: 2000 }],
    });
    createdTransactionIds.push(transaction.id);

    const item = await prisma.posTransactionItem.findFirstOrThrow({
      where: { posTransactionId: transaction.id },
      include: { allocations: true },
    });
    const allocation = item.allocations[0];
    expect(allocation).toBeDefined();
    expect(allocation?.batchNumberSnapshot).toBe(batch.batchNumber);
    expect(allocation?.expiryDateSnapshot.toISOString()).toBe(batch.expiryDate.toISOString());
    expect(allocation?.qtyOut.toString()).toBe("2");
    expect(allocation?.unitCostSnapshot.toString()).toBe("725");
  });

  it("menolak seluruh transaksi bila stok eligible tidak mencukupi — tanpa perubahan parsial apa pun", async () => {
    const testProductId = await createFefoTestProduct();
    const batch = await createTestBatch(testProductId, { qty: 3, expiryOffsetDays: 30 });
    const shift = await openTestShift(cashierUserId, pusatBranchId);

    const trxCountBefore = await prisma.posTransaction.count({ where: { companyId } });
    const movementCountBefore = await prisma.stockMovement.count({ where: { productId: testProductId } });

    await expect(
      createPaidTransaction({
        companyId,
        allowedBranchIds: [pusatBranchId],
        shiftId: shift.id,
        createdById: cashierUserId,
        items: [{ productId: testProductId, qty: 999 }],
        payments: [{ method: "CASH", amount: 999000 }],
      }),
    ).rejects.toThrow("tidak mencukupi");

    const after = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(after.qtyOnHand.toString()).toBe("3");

    const trxCountAfter = await prisma.posTransaction.count({ where: { companyId } });
    const movementCountAfter = await prisma.stockMovement.count({ where: { productId: testProductId } });
    expect(trxCountAfter).toBe(trxCountBefore);
    expect(movementCountAfter).toBe(movementCountBefore);
  });

  it("dua pembayaran konkuren pada batch yang sama tidak menghasilkan qty minus — tepat satu berhasil", async () => {
    const testProductId = await createFefoTestProduct();
    const batch = await createTestBatch(testProductId, { qty: 10, expiryOffsetDays: 30 });

    const cashierShift = await openTestShift(cashierUserId, pusatBranchId);
    const otherShift = await openShift({
      companyId,
      branchId: pusatBranchId,
      userId: otherCashierUserId,
      openingCash: 0,
    });
    createdShiftIds.push(otherShift.id);

    const attempt = (shiftId: string, userId: string) =>
      createPaidTransaction({
        companyId,
        allowedBranchIds: [pusatBranchId],
        shiftId,
        createdById: userId,
        items: [{ productId: testProductId, qty: 6 }],
        payments: [{ method: "CASH", amount: 6000 }],
      });

    const results = await Promise.allSettled([
      attempt(cashierShift.id, cashierUserId),
      attempt(otherShift.id, otherCashierUserId),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    // Kedua percobaan yang FULFILLED tetap dilacak untuk cleanup, apa pun
    // hasilnya — jangan sampai transaksi bocor tanpa dibersihkan hanya
    // karena jumlahnya tidak sesuai ekspektasi.
    for (const result of fulfilled) {
      if (result.status === "fulfilled") createdTransactionIds.push(result.value.id);
    }

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status === "rejected") {
      expect(String(rejected[0].reason)).toMatch(/tidak mencukupi/);
    }

    const after = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(after.qtyOnHand.toString()).toBe("4"); // 10 - 6, tidak pernah negatif/double-cut
  });
});

describe("createPaidTransactionWithBatchOverride — internal, tidak dipakai kasir normal", () => {
  it("menolak bila role tidak memiliki permission inventory.adjust", async () => {
    const batch = await createTestBatch(productId, { qty: 5, expiryOffsetDays: 30 });
    const shift = await openTestShift(cashierUserId, pusatBranchId);

    await expect(
      createPaidTransactionWithBatchOverride({
        companyId,
        allowedBranchIds: [pusatBranchId],
        shiftId: shift.id,
        createdById: cashierUserId,
        items: [{ productId, qty: 2 }],
        payments: [{ method: "CASH", amount: 2000 }],
        overrideActorId: cashierUserId,
        overrideActorRole: Role.CASHIER, // CASHIER tidak punya inventory.adjust
        overrideReason: "test",
        manualAllocations: { 0: [{ stockBatchId: batch.id, qty: 2 }] },
      }),
    ).rejects.toThrow("izin");
  });

  it("menolak bila alasan override kosong", async () => {
    const batch = await createTestBatch(productId, { qty: 5, expiryOffsetDays: 30 });
    const shift = await openTestShift(cashierUserId, pusatBranchId);

    await expect(
      createPaidTransactionWithBatchOverride({
        companyId,
        allowedBranchIds: [pusatBranchId],
        shiftId: shift.id,
        createdById: cashierUserId,
        items: [{ productId, qty: 2 }],
        payments: [{ method: "CASH", amount: 2000 }],
        overrideActorId: cashierUserId,
        overrideActorRole: Role.OWNER,
        overrideReason: "   ",
        manualAllocations: { 0: [{ stockBatchId: batch.id, qty: 2 }] },
      }),
    ).rejects.toThrow("Alasan");
  });

  it("mengalokasikan ke batch yang dipilih manual (bukan batch FEFO-terdekat), mencatat audit log dengan alasan", async () => {
    const testProductId = await createFefoTestProduct();
    const nearBatch = await createTestBatch(testProductId, { qty: 5, expiryOffsetDays: 10 });
    const farBatch = await createTestBatch(testProductId, { qty: 5, expiryOffsetDays: 100 });

    const shift = await openTestShift(cashierUserId, pusatBranchId);
    const transaction = await createPaidTransactionWithBatchOverride({
      companyId,
      allowedBranchIds: [pusatBranchId],
      shiftId: shift.id,
      createdById: cashierUserId,
      items: [{ productId: testProductId, qty: 2 }],
      payments: [{ method: "CASH", amount: 2000 }],
      overrideActorId: cashierUserId,
      overrideActorRole: Role.OWNER,
      overrideReason: "Koreksi manual — kasus uji",
      manualAllocations: { 0: [{ stockBatchId: farBatch.id, qty: 2 }] },
    });
    createdTransactionIds.push(transaction.id);

    const near = await prisma.stockBatch.findUniqueOrThrow({ where: { id: nearBatch.id } });
    const far = await prisma.stockBatch.findUniqueOrThrow({ where: { id: farBatch.id } });
    expect(near.qtyOnHand.toString()).toBe("5"); // tidak tersentuh — override memilih farBatch
    expect(far.qtyOnHand.toString()).toBe("3");

    const auditLog = await prisma.auditLog.findFirst({
      where: { entityType: "PosTransaction", entityId: transaction.id, action: "PAY_WITH_BATCH_OVERRIDE" },
    });
    expect(auditLog).not.toBeNull();
    expect(auditLog?.reason).toBe("Koreksi manual — kasus uji");
  });
});
