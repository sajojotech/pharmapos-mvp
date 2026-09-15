import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { findBranchByCode } from "@/services/branch-service";
import {
  deductStockFromBatch,
  receiveStockToBatch,
} from "@/services/stock-ledger";

let companyId: string;
let branchId: string;
let warehouseId: string;
let productId: string;
let userId: string;

const FUTURE_DATE = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
const PAST_DATE = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);

/** Helper: buat batch test langsung (tanpa lewat receiveStockToBatch) agar
 * tiap test bisa mengatur status/ED/qty awal secara eksplisit. */
async function createTestBatch(overrides: {
  batchNumber: string;
  qtyOnHand: number;
  status?: "AVAILABLE" | "QUARANTINED" | "BLOCKED" | "EXPIRED" | "DAMAGED";
  expiryDate?: Date;
}) {
  return prisma.stockBatch.create({
    data: {
      companyId,
      branchId,
      warehouseId,
      productId,
      batchNumber: overrides.batchNumber,
      expiryDate: overrides.expiryDate ?? FUTURE_DATE,
      receivedDate: new Date(),
      qtyOnHand: overrides.qtyOnHand,
      unitCost: 1000,
      status: overrides.status ?? "AVAILABLE",
    },
  });
}

async function cleanupBatch(batchId: string) {
  await prisma.stockMovement.deleteMany({ where: { stockBatchId: batchId } });
  await prisma.stockBatch.delete({ where: { id: batchId } });
}

beforeAll(async () => {
  const company = await prisma.company.findFirstOrThrow();
  companyId = company.id;

  const branch = await findBranchByCode(companyId, "PUSAT");
  if (!branch) throw new Error("Seed cabang PUSAT tidak ditemukan");
  branchId = branch.id;

  const warehouse = await prisma.warehouse.findFirstOrThrow({
    where: { branchId, isDefault: true },
  });
  warehouseId = warehouse.id;

  const product = await prisma.product.findFirstOrThrow({ where: { companyId } });
  productId = product.id;

  const user = await prisma.user.findUniqueOrThrow({
    where: { email: "gudang.pusat@pharmapos.local" },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("receiveStockToBatch — penambahan stok", () => {
  it("menaikkan qtyOnHand dan membuat StockMovement dengan qtyIn benar", async () => {
    const result = await receiveStockToBatch(prisma, {
      companyId,
      branchId,
      warehouseId,
      productId,
      batchNumber: "TEST-RECEIVE-001",
      expiryDate: FUTURE_DATE,
      receivedDate: new Date(),
      unitCost: 1500,
      qty: 50,
      movementType: "OPENING_BALANCE",
      referenceType: "Test",
      referenceId: "test-receive-1",
      createdById: userId,
    });

    expect(result.balanceAfter.toString()).toBe("50");

    const batch = await prisma.stockBatch.findUniqueOrThrow({
      where: { id: result.batchId },
    });
    expect(batch.qtyOnHand.toString()).toBe("50");

    expect(result.movement.qtyIn.toString()).toBe("50");
    expect(result.movement.qtyOut.toString()).toBe("0");
    expect(result.movement.balanceAfter.toString()).toBe("50");
    expect(result.movement.movementType).toBe("OPENING_BALANCE");

    await cleanupBatch(result.batchId);
  });

  it("menambah ke batch yang sudah ada (batchNumber sama) alih-alih membuat duplikat", async () => {
    const first = await receiveStockToBatch(prisma, {
      companyId,
      branchId,
      warehouseId,
      productId,
      batchNumber: "TEST-RECEIVE-002",
      expiryDate: FUTURE_DATE,
      receivedDate: new Date(),
      unitCost: 1000,
      qty: 20,
      movementType: "OPENING_BALANCE",
      referenceType: "Test",
      referenceId: "test-receive-2a",
      createdById: userId,
    });

    const second = await receiveStockToBatch(prisma, {
      companyId,
      branchId,
      warehouseId,
      productId,
      batchNumber: "TEST-RECEIVE-002",
      expiryDate: FUTURE_DATE,
      receivedDate: new Date(),
      unitCost: 1000,
      qty: 30,
      movementType: "PURCHASE_RECEIPT",
      referenceType: "Test",
      referenceId: "test-receive-2b",
      createdById: userId,
    });

    expect(second.batchId).toBe(first.batchId);
    expect(second.balanceAfter.toString()).toBe("50");

    const batchCount = await prisma.stockBatch.count({
      where: { branchId, productId, batchNumber: "TEST-RECEIVE-002" },
    });
    expect(batchCount).toBe(1);

    await cleanupBatch(first.batchId);
  });

  it("menolak batchNumber yang sama dengan tanggal ED berbeda", async () => {
    const first = await receiveStockToBatch(prisma, {
      companyId,
      branchId,
      warehouseId,
      productId,
      batchNumber: "TEST-RECEIVE-003",
      expiryDate: FUTURE_DATE,
      receivedDate: new Date(),
      unitCost: 1000,
      qty: 10,
      movementType: "OPENING_BALANCE",
      referenceType: "Test",
      referenceId: "test-receive-3",
      createdById: userId,
    });

    const differentExpiry = new Date(FUTURE_DATE.getTime() + 1000 * 60 * 60 * 24 * 10);

    await expect(
      receiveStockToBatch(prisma, {
        companyId,
        branchId,
        warehouseId,
        productId,
        batchNumber: "TEST-RECEIVE-003",
        expiryDate: differentExpiry,
        receivedDate: new Date(),
        unitCost: 1000,
        qty: 5,
        movementType: "PURCHASE_RECEIPT",
        referenceType: "Test",
        referenceId: "test-receive-3b",
        createdById: userId,
      }),
    ).rejects.toThrow(/ED berbeda/);

    await cleanupBatch(first.batchId);
  });

  it("menolak qty nol atau negatif", async () => {
    await expect(
      receiveStockToBatch(prisma, {
        companyId,
        branchId,
        warehouseId,
        productId,
        batchNumber: "TEST-RECEIVE-004",
        expiryDate: FUTURE_DATE,
        receivedDate: new Date(),
        unitCost: 1000,
        qty: 0,
        movementType: "OPENING_BALANCE",
        referenceType: "Test",
        referenceId: "test-receive-4",
        createdById: userId,
      }),
    ).rejects.toThrow(/lebih dari 0/);
  });
});

describe("deductStockFromBatch — pengurangan stok", () => {
  it("menurunkan qtyOnHand dan membuat StockMovement dengan qtyOut benar", async () => {
    const batch = await createTestBatch({ batchNumber: "TEST-DEDUCT-001", qtyOnHand: 100 });

    const result = await deductStockFromBatch(prisma, {
      stockBatchId: batch.id,
      qty: 30,
      movementType: "POS_SALE",
      referenceType: "Test",
      referenceId: "test-deduct-1",
      createdById: userId,
    });

    expect(result.balanceAfter.toString()).toBe("70");
    expect(result.movement.qtyOut.toString()).toBe("30");
    expect(result.movement.qtyIn.toString()).toBe("0");
    expect(result.movement.balanceAfter.toString()).toBe("70");

    const updated = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(updated.qtyOnHand.toString()).toBe("70");

    await cleanupBatch(batch.id);
  });

  it("tidak dapat mengurangi stok melebihi saldo", async () => {
    const batch = await createTestBatch({ batchNumber: "TEST-DEDUCT-002", qtyOnHand: 10 });

    await expect(
      deductStockFromBatch(prisma, {
        stockBatchId: batch.id,
        qty: 11,
        movementType: "POS_SALE",
        referenceType: "Test",
        referenceId: "test-deduct-2",
        createdById: userId,
      }),
    ).rejects.toThrow(/tidak mencukupi/);

    const unchanged = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(unchanged.qtyOnHand.toString()).toBe("10");
    const movementCount = await prisma.stockMovement.count({ where: { stockBatchId: batch.id } });
    expect(movementCount).toBe(0);

    await cleanupBatch(batch.id);
  });

  it.each(["QUARANTINED", "BLOCKED", "DAMAGED"] as const)(
    "menolak pengeluaran normal (POS_SALE) dari batch berstatus %s",
    async (status) => {
      const batch = await createTestBatch({
        batchNumber: `TEST-DEDUCT-STATUS-${status}`,
        qtyOnHand: 50,
        status,
      });

      await expect(
        deductStockFromBatch(prisma, {
          stockBatchId: batch.id,
          qty: 5,
          movementType: "POS_SALE",
          referenceType: "Test",
          referenceId: `test-deduct-status-${status}`,
          createdById: userId,
        }),
      ).rejects.toThrow(/tidak dapat dikeluarkan/);

      await cleanupBatch(batch.id);
    },
  );

  it("menolak pengeluaran normal (POS_SALE) dari batch yang sudah lewat ED", async () => {
    const batch = await createTestBatch({
      batchNumber: "TEST-DEDUCT-EXPIRED",
      qtyOnHand: 50,
      status: "AVAILABLE",
      expiryDate: PAST_DATE,
    });

    await expect(
      deductStockFromBatch(prisma, {
        stockBatchId: batch.id,
        qty: 5,
        movementType: "POS_SALE",
        referenceType: "Test",
        referenceId: "test-deduct-expired",
        createdById: userId,
      }),
    ).rejects.toThrow(/kedaluwarsa/);

    await cleanupBatch(batch.id);
  });

  it("menolak qty nol atau negatif", async () => {
    const batch = await createTestBatch({ batchNumber: "TEST-DEDUCT-ZERO", qtyOnHand: 10 });

    await expect(
      deductStockFromBatch(prisma, {
        stockBatchId: batch.id,
        qty: 0,
        movementType: "POS_SALE",
        referenceType: "Test",
        referenceId: "test-deduct-zero",
        createdById: userId,
      }),
    ).rejects.toThrow(/lebih dari 0/);

    await cleanupBatch(batch.id);
  });
});

describe("deductStockFromBatch — write-off (pengecualian batch bermasalah)", () => {
  it("EXPIRED_WRITE_OFF berhasil pada batch berstatus EXPIRED", async () => {
    const batch = await createTestBatch({
      batchNumber: "TEST-WRITEOFF-EXPIRED",
      qtyOnHand: 20,
      status: "EXPIRED",
    });

    const result = await deductStockFromBatch(prisma, {
      stockBatchId: batch.id,
      qty: 20,
      movementType: "EXPIRED_WRITE_OFF",
      referenceType: "Test",
      referenceId: "test-writeoff-expired",
      createdById: userId,
    });

    expect(result.balanceAfter.toString()).toBe("0");

    await cleanupBatch(batch.id);
  });

  it("EXPIRED_WRITE_OFF ditolak pada batch AVAILABLE yang belum lewat ED", async () => {
    const batch = await createTestBatch({
      batchNumber: "TEST-WRITEOFF-NOT-EXPIRED",
      qtyOnHand: 20,
      status: "AVAILABLE",
    });

    await expect(
      deductStockFromBatch(prisma, {
        stockBatchId: batch.id,
        qty: 5,
        movementType: "EXPIRED_WRITE_OFF",
        referenceType: "Test",
        referenceId: "test-writeoff-not-expired",
        createdById: userId,
      }),
    ).rejects.toThrow(/belum kedaluwarsa/);

    await cleanupBatch(batch.id);
  });

  it("DAMAGED_WRITE_OFF berhasil pada batch berstatus DAMAGED, ditolak pada AVAILABLE", async () => {
    const damagedBatch = await createTestBatch({
      batchNumber: "TEST-WRITEOFF-DAMAGED",
      qtyOnHand: 15,
      status: "DAMAGED",
    });

    const result = await deductStockFromBatch(prisma, {
      stockBatchId: damagedBatch.id,
      qty: 15,
      movementType: "DAMAGED_WRITE_OFF",
      referenceType: "Test",
      referenceId: "test-writeoff-damaged",
      createdById: userId,
    });
    expect(result.balanceAfter.toString()).toBe("0");
    await cleanupBatch(damagedBatch.id);

    const availableBatch = await createTestBatch({
      batchNumber: "TEST-WRITEOFF-DAMAGED-2",
      qtyOnHand: 15,
      status: "AVAILABLE",
    });
    await expect(
      deductStockFromBatch(prisma, {
        stockBatchId: availableBatch.id,
        qty: 5,
        movementType: "DAMAGED_WRITE_OFF",
        referenceType: "Test",
        referenceId: "test-writeoff-damaged-2",
        createdById: userId,
      }),
    ).rejects.toThrow(/tidak berstatus DAMAGED/);
    await cleanupBatch(availableBatch.id);
  });
});
