import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role, SalesReturnItemCondition } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findBranchByCode } from "@/services/branch-service";
import { closeShift, getOpenShiftForUser, openShift } from "@/services/cashier-shift-service";
import { createPaidTransaction } from "@/services/pos-transaction-service";
import { createSalesReturn, getReturnableSummary } from "@/services/sales-return-service";

let companyId: string;
let pusatBranchId: string;
let timurBranchId: string;
let warehouseId: string;
let cashierUserId: string;

const createdUserIds: string[] = [];
const createdShiftIds: string[] = [];
const createdTransactionIds: string[] = [];
/** Satu produk BARU per test (bukan dibagi lintas test) — mirror pola
 * `createFefoTestProduct` di pos-transaction-service.test.ts: retur
 * memakai alokasi FEFO nyata (via createPaidTransaction), jadi batch sisa
 * dari test lain akan ikut terlihat FEFO test berikutnya dan merusak
 * asersi qty persis bila productId dibagi. */
const createdProductIds: string[] = [];

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function createIsolatedProduct(): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({ where: { companyId } });
  const baseUnit = await prisma.unit.findFirstOrThrow({ where: { companyId, name: "Tablet" } });
  const product = await prisma.product.create({
    data: {
      companyId,
      sku: `TEST-RETURN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "Produk Test Retur",
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

async function createTestBatch(testProductId: string, qty: number, expiryOffsetDays = 30) {
  return prisma.stockBatch.create({
    data: {
      companyId,
      branchId: pusatBranchId,
      warehouseId,
      productId: testProductId,
      batchNumber: `TEST-RETURN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      email: `test-cashier-return-${Date.now()}@test.local`,
      name: "Test Cashier (Return test)",
      role: Role.CASHIER,
      passwordHash: "unused-in-tests",
    },
  });
  cashierUserId = cashier.id;
  createdUserIds.push(cashier.id);
  await prisma.userBranchAssignment.create({ data: { userId: cashier.id, branchId: pusatBranchId } });
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
    await prisma.product.delete({ where: { id } });
  }
  for (const id of createdUserIds) {
    await prisma.userBranchAssignment.deleteMany({ where: { userId: id } });
    await prisma.user.delete({ where: { id } });
  }
  await prisma.$disconnect();
});

async function sellQty(testProductId: string, qty: number) {
  const shift = await openTestShift(cashierUserId, pusatBranchId);
  const transaction = await createPaidTransaction({
    companyId,
    allowedBranchIds: [pusatBranchId],
    shiftId: shift.id,
    createdById: cashierUserId,
    items: [{ productId: testProductId, qty }],
    payments: [{ method: "CASH", amount: qty * 1000 }],
  });
  createdTransactionIds.push(transaction.id);
  const item = await prisma.posTransactionItem.findFirstOrThrow({
    where: { posTransactionId: transaction.id },
  });
  return { transaction, item };
}

describe("createSalesReturn — RBAC & guard dasar", () => {
  it("menolak bila role tidak punya permission pos.sell", async () => {
    const testProductId = await createIsolatedProduct();
    await createTestBatch(testProductId, 10);
    const { transaction, item } = await sellQty(testProductId, 2);

    await expect(
      createSalesReturn({
        companyId,
        allowedBranchIds: [pusatBranchId],
        posTransactionId: transaction.id,
        actorId: cashierUserId,
        actorRole: Role.WAREHOUSE_STAFF,
        reason: "test",
        items: [{ posTransactionItemId: item.id, qty: 1, condition: SalesReturnItemCondition.SELLABLE }],
      }),
    ).rejects.toThrow("izin");
  });

  it("menolak bila alasan kosong", async () => {
    const testProductId = await createIsolatedProduct();
    await createTestBatch(testProductId, 10);
    const { transaction, item } = await sellQty(testProductId, 2);

    await expect(
      createSalesReturn({
        companyId,
        allowedBranchIds: [pusatBranchId],
        posTransactionId: transaction.id,
        actorId: cashierUserId,
        actorRole: Role.CASHIER,
        reason: "   ",
        items: [{ posTransactionItemId: item.id, qty: 1, condition: SalesReturnItemCondition.SELLABLE }],
      }),
    ).rejects.toThrow("Alasan retur wajib diisi");
  });

  it("menolak akses transaksi di luar cabang yang diizinkan", async () => {
    const testProductId = await createIsolatedProduct();
    await createTestBatch(testProductId, 10);
    const { transaction, item } = await sellQty(testProductId, 2);

    await expect(
      createSalesReturn({
        companyId,
        allowedBranchIds: [timurBranchId],
        posTransactionId: transaction.id,
        actorId: cashierUserId,
        actorRole: Role.CASHIER,
        reason: "test",
        items: [{ posTransactionItemId: item.id, qty: 1, condition: SalesReturnItemCondition.SELLABLE }],
      }),
    ).rejects.toThrow("tidak ditemukan atau di luar akses cabang");
  });
});

describe("createSalesReturn — SELLABLE", () => {
  it("mengembalikan stok ke batch ASAL dan menandai transaksi PARTIALLY_RETURNED", async () => {
    const testProductId = await createIsolatedProduct();
    const batch = await createTestBatch(testProductId, 10);
    const { transaction, item } = await sellQty(testProductId, 5);

    const afterSale = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(afterSale.qtyOnHand.toString()).toBe("5");

    const salesReturn = await createSalesReturn({
      companyId,
      allowedBranchIds: [pusatBranchId],
      posTransactionId: transaction.id,
      actorId: cashierUserId,
      actorRole: Role.CASHIER,
      reason: "Barang tidak jadi dibeli",
      items: [{ posTransactionItemId: item.id, qty: 2, condition: SalesReturnItemCondition.SELLABLE }],
    });
    expect(salesReturn.items).toHaveLength(1);
    expect(salesReturn.items[0]?.destinationStockBatchId).toBe(batch.id);

    const afterReturn = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(afterReturn.qtyOnHand.toString()).toBe("7"); // 5 + 2 kembali ke batch ASAL

    const posTransaction = await prisma.posTransaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(posTransaction.status).toBe("PARTIALLY_RETURNED");

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { stockBatchId: batch.id, referenceType: "SalesReturn", referenceId: salesReturn.id },
    });
    expect(movement.movementType).toBe("SALES_RETURN");
    expect(movement.qtyIn.toString()).toBe("2");
  });

  it("retur penuh menandai transaksi RETURNED", async () => {
    const testProductId = await createIsolatedProduct();
    await createTestBatch(testProductId, 10);
    const { transaction, item } = await sellQty(testProductId, 3);

    await createSalesReturn({
      companyId,
      allowedBranchIds: [pusatBranchId],
      posTransactionId: transaction.id,
      actorId: cashierUserId,
      actorRole: Role.CASHIER,
      reason: "Retur penuh",
      items: [{ posTransactionItemId: item.id, qty: 3, condition: SalesReturnItemCondition.SELLABLE }],
    });

    const posTransaction = await prisma.posTransaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(posTransaction.status).toBe("RETURNED");
  });

  it("menolak retur melebihi sisa returnable, termasuk lintas beberapa retur berturut-turut", async () => {
    const testProductId = await createIsolatedProduct();
    await createTestBatch(testProductId, 10);
    const { transaction, item } = await sellQty(testProductId, 5);

    await createSalesReturn({
      companyId,
      allowedBranchIds: [pusatBranchId],
      posTransactionId: transaction.id,
      actorId: cashierUserId,
      actorRole: Role.CASHIER,
      reason: "Retur pertama",
      items: [{ posTransactionItemId: item.id, qty: 3, condition: SalesReturnItemCondition.SELLABLE }],
    });

    // sisa returnable tinggal 2 (5 - 3) — minta 3 lagi harus ditolak
    await expect(
      createSalesReturn({
        companyId,
        allowedBranchIds: [pusatBranchId],
        posTransactionId: transaction.id,
        actorId: cashierUserId,
        actorRole: Role.CASHIER,
        reason: "Retur kedua — melebihi sisa",
        items: [{ posTransactionItemId: item.id, qty: 3, condition: SalesReturnItemCondition.SELLABLE }],
      }),
    ).rejects.toThrow("melebihi sisa yang dapat diretur");

    // retur kedua gagal total (atomic) — status tetap dari retur pertama, bukan berubah lagi
    const posTransaction = await prisma.posTransaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(posTransaction.status).toBe("PARTIALLY_RETURNED");

    // retur tepat sisa (2) berhasil
    await createSalesReturn({
      companyId,
      allowedBranchIds: [pusatBranchId],
      posTransactionId: transaction.id,
      actorId: cashierUserId,
      actorRole: Role.CASHIER,
      reason: "Retur ketiga — pas sisa",
      items: [{ posTransactionItemId: item.id, qty: 2, condition: SalesReturnItemCondition.SELLABLE }],
    });
    const finalTransaction = await prisma.posTransaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(finalTransaction.status).toBe("RETURNED");
  });
});

describe("createSalesReturn — DAMAGED/QUARANTINE", () => {
  it("retur DAMAGED membuat batch SEGREGASI terpisah, TIDAK menambah saldo batch AVAILABLE asal", async () => {
    const testProductId = await createIsolatedProduct();
    const batch = await createTestBatch(testProductId, 10);
    const { transaction, item } = await sellQty(testProductId, 4);

    const salesReturn = await createSalesReturn({
      companyId,
      allowedBranchIds: [pusatBranchId],
      posTransactionId: transaction.id,
      actorId: cashierUserId,
      actorRole: Role.CASHIER,
      reason: "Barang rusak saat pemakaian",
      items: [{ posTransactionItemId: item.id, qty: 2, condition: SalesReturnItemCondition.DAMAGED }],
    });

    const sourceBatchAfter = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(sourceBatchAfter.qtyOnHand.toString()).toBe("6"); // 10 - 4 terjual, TIDAK bertambah dari retur

    const destinationId = salesReturn.items[0]?.destinationStockBatchId;
    expect(destinationId).toBeDefined();
    expect(destinationId).not.toBe(batch.id);

    const segregatedBatch = await prisma.stockBatch.findUniqueOrThrow({ where: { id: destinationId! } });
    expect(segregatedBatch.status).toBe("DAMAGED");
    expect(segregatedBatch.qtyOnHand.toString()).toBe("2");
    expect(segregatedBatch.batchNumber).toContain("RETURN-DAMAGED");
  });

  it("retur QUARANTINE membuat batch berstatus QUARANTINED, TIDAK menambah saldo batch AVAILABLE asal", async () => {
    const testProductId = await createIsolatedProduct();
    const batch = await createTestBatch(testProductId, 10);
    const { transaction, item } = await sellQty(testProductId, 4);

    const salesReturn = await createSalesReturn({
      companyId,
      allowedBranchIds: [pusatBranchId],
      posTransactionId: transaction.id,
      actorId: cashierUserId,
      actorRole: Role.CASHIER,
      reason: "Diragukan keasliannya, perlu verifikasi",
      items: [{ posTransactionItemId: item.id, qty: 1, condition: SalesReturnItemCondition.QUARANTINE }],
    });

    const sourceBatchAfter = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(sourceBatchAfter.qtyOnHand.toString()).toBe("6"); // tidak bertambah

    const destinationId = salesReturn.items[0]?.destinationStockBatchId;
    const segregatedBatch = await prisma.stockBatch.findUniqueOrThrow({ where: { id: destinationId! } });
    expect(segregatedBatch.status).toBe("QUARANTINED");
    expect(segregatedBatch.qtyOnHand.toString()).toBe("1");
  });
});

describe("getReturnableSummary", () => {
  it("menghitung sisa returnable per alokasi dengan benar setelah sebagian diretur", async () => {
    const testProductId = await createIsolatedProduct();
    await createTestBatch(testProductId, 10);
    const { transaction, item } = await sellQty(testProductId, 6);

    await createSalesReturn({
      companyId,
      allowedBranchIds: [pusatBranchId],
      posTransactionId: transaction.id,
      actorId: cashierUserId,
      actorRole: Role.CASHIER,
      reason: "Sebagian diretur",
      items: [{ posTransactionItemId: item.id, qty: 2, condition: SalesReturnItemCondition.SELLABLE }],
    });

    const summary = await getReturnableSummary([pusatBranchId], transaction.id);
    expect(summary).not.toBeNull();
    const itemSummary = summary!.items.find((i) => i.itemId === item.id);
    expect(itemSummary?.totalReturnable.toString()).toBe("4"); // 6 - 2
  });
});
