import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { findBranchByCode } from "@/services/branch-service";
import {
  createDraftAdjustment,
  postAdjustment,
} from "@/services/stock-adjustment-service";
import { createDraftOpname, postOpname } from "@/services/stock-opname-service";

let companyId: string;
let branchId: string;
let warehouseId: string;
let timurBranchId: string;
let timurWarehouseId: string;
let productId: string;
let userId: string;

const FUTURE_DATE = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);

async function createTestBatch(batchNumber: string, qtyOnHand: number) {
  return prisma.stockBatch.create({
    data: {
      companyId,
      branchId,
      warehouseId,
      productId,
      batchNumber,
      expiryDate: FUTURE_DATE,
      receivedDate: new Date(),
      qtyOnHand,
      unitCost: 1000,
      status: "AVAILABLE",
    },
  });
}

async function cleanupBatch(batchId: string) {
  await prisma.stockMovement.deleteMany({ where: { stockBatchId: batchId } });
  await prisma.stockAdjustmentItem.deleteMany({ where: { stockBatchId: batchId } });
  await prisma.stockOpnameItem.deleteMany({ where: { stockBatchId: batchId } });
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

  const timur = await findBranchByCode(companyId, "TIMUR");
  if (!timur) throw new Error("Seed cabang TIMUR tidak ditemukan");
  timurBranchId = timur.id;
  const timurWarehouse = await prisma.warehouse.findFirstOrThrow({
    where: { branchId: timurBranchId, isDefault: true },
  });
  timurWarehouseId = timurWarehouse.id;

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

describe("Stock Adjustment", () => {
  it("posting adjustment OUT menghasilkan StockMovement STOCK_ADJUSTMENT_OUT dan mengurangi saldo", async () => {
    const batch = await createTestBatch("TEST-ADJ-OUT-001", 100);

    const draft = await createDraftAdjustment({
      companyId,
      branchId,
      reason: "Stok rusak ditemukan saat pengecekan",
      createdById: userId,
      items: [{ stockBatchId: batch.id, direction: "OUT", qty: 10 }],
    });

    expect(draft.status).toBe("DRAFT");

    const posted = await postAdjustment({
      companyId,
      allowedBranchIds: [branchId],
      id: draft.id,
      postedById: userId,
    });

    expect(posted.status).toBe("POSTED");
    expect(posted.postedAt).not.toBeNull();

    const updatedBatch = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(updatedBatch.qtyOnHand.toString()).toBe("90");

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { stockBatchId: batch.id, referenceType: "StockAdjustment", referenceId: draft.id },
    });
    expect(movement.movementType).toBe("STOCK_ADJUSTMENT_OUT");
    expect(movement.qtyOut.toString()).toBe("10");
    expect(movement.balanceAfter.toString()).toBe("90");

    const auditLog = await prisma.auditLog.findFirst({
      where: { entityType: "StockAdjustment", entityId: draft.id, action: "POST" },
    });
    expect(auditLog).not.toBeNull();

    await prisma.auditLog.deleteMany({ where: { entityType: "StockAdjustment", entityId: draft.id } });
    await prisma.stockAdjustmentItem.deleteMany({ where: { stockAdjustmentId: draft.id } });
    await prisma.stockAdjustment.delete({ where: { id: draft.id } });
    await cleanupBatch(batch.id);
  });

  it("posting adjustment OUT yang melebihi saldo batch gagal dan tidak mengubah apa pun", async () => {
    const batch = await createTestBatch("TEST-ADJ-OUT-002", 5);

    const draft = await createDraftAdjustment({
      companyId,
      branchId,
      reason: "Uji melebihi saldo",
      createdById: userId,
      items: [{ stockBatchId: batch.id, direction: "OUT", qty: 999 }],
    });

    await expect(
      postAdjustment({ companyId, allowedBranchIds: [branchId], id: draft.id, postedById: userId }),
    ).rejects.toThrow(/tidak mencukupi/);

    const stillDraft = await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: draft.id } });
    expect(stillDraft.status).toBe("DRAFT");

    const unchangedBatch = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(unchangedBatch.qtyOnHand.toString()).toBe("5");

    const movementCount = await prisma.stockMovement.count({ where: { stockBatchId: batch.id } });
    expect(movementCount).toBe(0);

    await prisma.stockAdjustmentItem.deleteMany({ where: { stockAdjustmentId: draft.id } });
    await prisma.stockAdjustment.delete({ where: { id: draft.id } });
    await cleanupBatch(batch.id);
  });

  it("tidak dapat memposting ulang dokumen yang sudah POSTED (immutable)", async () => {
    const batch = await createTestBatch("TEST-ADJ-REPOST", 50);
    const draft = await createDraftAdjustment({
      companyId,
      branchId,
      reason: "Uji re-post",
      createdById: userId,
      items: [{ stockBatchId: batch.id, direction: "OUT", qty: 5 }],
    });

    await postAdjustment({ companyId, allowedBranchIds: [branchId], id: draft.id, postedById: userId });

    await expect(
      postAdjustment({ companyId, allowedBranchIds: [branchId], id: draft.id, postedById: userId }),
    ).rejects.toThrow(/DRAFT/);

    await prisma.auditLog.deleteMany({ where: { entityType: "StockAdjustment", entityId: draft.id } });
    await prisma.stockAdjustmentItem.deleteMany({ where: { stockAdjustmentId: draft.id } });
    await prisma.stockAdjustment.delete({ where: { id: draft.id } });
    await cleanupBatch(batch.id);
  });
});

describe("Stock Opname", () => {
  it("posting opname dengan selisih kurang menghasilkan STOCK_OPNAME qtyOut", async () => {
    const batch = await createTestBatch("TEST-OPN-SHORT-001", 100);

    const draft = await createDraftOpname({
      companyId,
      branchId,
      notes: "Opname rutin bulanan",
      createdById: userId,
      items: [{ stockBatchId: batch.id, countedQty: 92 }],
    });

    const posted = await postOpname({
      companyId,
      allowedBranchIds: [branchId],
      id: draft.id,
      postedById: userId,
    });

    expect(posted.status).toBe("POSTED");

    const updatedBatch = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(updatedBatch.qtyOnHand.toString()).toBe("92");

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { stockBatchId: batch.id, referenceType: "StockOpname", referenceId: draft.id },
    });
    expect(movement.movementType).toBe("STOCK_OPNAME");
    expect(movement.qtyOut.toString()).toBe("8");
    expect(movement.balanceAfter.toString()).toBe("92");

    await prisma.auditLog.deleteMany({ where: { entityType: "StockOpname", entityId: draft.id } });
    await prisma.stockOpnameItem.deleteMany({ where: { stockOpnameId: draft.id } });
    await prisma.stockOpname.delete({ where: { id: draft.id } });
    await cleanupBatch(batch.id);
  });

  it("posting opname dengan selisih lebih menghasilkan STOCK_OPNAME qtyIn", async () => {
    const batch = await createTestBatch("TEST-OPN-OVER-001", 50);

    const draft = await createDraftOpname({
      companyId,
      branchId,
      createdById: userId,
      items: [{ stockBatchId: batch.id, countedQty: 55 }],
    });

    await postOpname({ companyId, allowedBranchIds: [branchId], id: draft.id, postedById: userId });

    const updatedBatch = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(updatedBatch.qtyOnHand.toString()).toBe("55");

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { stockBatchId: batch.id, referenceType: "StockOpname", referenceId: draft.id },
    });
    expect(movement.qtyIn.toString()).toBe("5");
    expect(movement.qtyOut.toString()).toBe("0");

    await prisma.auditLog.deleteMany({ where: { entityType: "StockOpname", entityId: draft.id } });
    await prisma.stockOpnameItem.deleteMany({ where: { stockOpnameId: draft.id } });
    await prisma.stockOpname.delete({ where: { id: draft.id } });
    await cleanupBatch(batch.id);
  });

  it("item tanpa selisih tidak menghasilkan StockMovement", async () => {
    const batch = await createTestBatch("TEST-OPN-SAME-001", 30);

    const draft = await createDraftOpname({
      companyId,
      branchId,
      createdById: userId,
      items: [{ stockBatchId: batch.id, countedQty: 30 }],
    });

    await postOpname({ companyId, allowedBranchIds: [branchId], id: draft.id, postedById: userId });

    const movementCount = await prisma.stockMovement.count({
      where: { stockBatchId: batch.id, referenceType: "StockOpname" },
    });
    expect(movementCount).toBe(0);

    await prisma.auditLog.deleteMany({ where: { entityType: "StockOpname", entityId: draft.id } });
    await prisma.stockOpnameItem.deleteMany({ where: { stockOpnameId: draft.id } });
    await prisma.stockOpname.delete({ where: { id: draft.id } });
    await cleanupBatch(batch.id);
  });
});

describe("Isolasi cabang pada item (Fase 11 hardening)", () => {
  it("createDraftAdjustment menolak stockBatchId yang bukan milik branchId dokumen", async () => {
    const foreignBatch = await createTestBatch(`TEST-ADJ-FOREIGN-${Date.now()}`, 50);
    // Batch di atas dibuat dengan `branchId` (PUSAT) oleh createTestBatch —
    // paksa pindahkan ke TIMUR supaya benar-benar "milik cabang lain" dari
    // sudut pandang dokumen yang akan dibuat untuk PUSAT.
    await prisma.stockBatch.update({
      where: { id: foreignBatch.id },
      data: { branchId: timurBranchId, warehouseId: timurWarehouseId },
    });

    await expect(
      createDraftAdjustment({
        companyId,
        branchId, // PUSAT
        reason: "Percobaan lintas cabang — harus ditolak",
        createdById: userId,
        items: [{ stockBatchId: foreignBatch.id, direction: "OUT", qty: 5 }],
      }),
    ).rejects.toThrow("tidak ditemukan pada cabang ini");

    await cleanupBatch(foreignBatch.id);
  });

  it("createDraftOpname menolak stockBatchId yang bukan milik branchId dokumen", async () => {
    const foreignBatch = await createTestBatch(`TEST-OPN-FOREIGN-${Date.now()}`, 50);
    await prisma.stockBatch.update({
      where: { id: foreignBatch.id },
      data: { branchId: timurBranchId, warehouseId: timurWarehouseId },
    });

    await expect(
      createDraftOpname({
        companyId,
        branchId, // PUSAT
        createdById: userId,
        items: [{ stockBatchId: foreignBatch.id, countedQty: 55 }],
      }),
    ).rejects.toThrow("tidak ditemukan pada cabang ini");

    await cleanupBatch(foreignBatch.id);
  });
});
