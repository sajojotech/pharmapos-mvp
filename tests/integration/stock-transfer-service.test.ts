import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findBranchByCode } from "@/services/branch-service";
import {
  approveTransferRequest,
  cancelTransfer,
  createDraftTransfer,
  getTransferById,
  listTransfersPaginated,
  receiveTransfer,
  rejectTransferRequest,
  shipTransfer,
  submitTransferRequest,
} from "@/services/stock-transfer-service";

let companyId: string;
let pusatBranchId: string;
let timurBranchId: string;
let baratBranchId: string;
let pusatWarehouseId: string;
let productId: string;

let sourceUserId: string; // assigned ke PUSAT (cabang asal)
let destinationUserId: string; // assigned ke TIMUR (cabang tujuan)
let outsiderUserId: string; // assigned ke BARAT saja (bukan asal/tujuan)

const FUTURE_DATE = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);

const createdUserIds: string[] = [];
const createdTransferIds: string[] = [];
const createdBatchNumbers: string[] = [];

function uniqueBatchNumber(prefix: string): string {
  const batchNumber = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  createdBatchNumbers.push(batchNumber);
  return batchNumber;
}

async function createSourceBatch(overrides: { qty: number; unitCost?: number }) {
  return prisma.stockBatch.create({
    data: {
      companyId,
      branchId: pusatBranchId,
      warehouseId: pusatWarehouseId,
      productId,
      batchNumber: uniqueBatchNumber("TEST-TRF-SRC"),
      expiryDate: FUTURE_DATE,
      receivedDate: new Date(),
      qtyOnHand: overrides.qty,
      unitCost: overrides.unitCost ?? 600,
      status: "AVAILABLE",
    },
  });
}

async function cleanupTransfer(id: string) {
  try {
    await prisma.auditLog.deleteMany({ where: { entityType: "StockTransfer", entityId: id } });
    await prisma.stockTransferItem.deleteMany({ where: { transferId: id } });
    await prisma.stockTransfer.delete({ where: { id } });
  } catch {
    // sudah terhapus — abaikan
  }
}

beforeAll(async () => {
  const company = await prisma.company.findFirstOrThrow();
  companyId = company.id;

  const pusat = await findBranchByCode(companyId, "PUSAT");
  const timur = await findBranchByCode(companyId, "TIMUR");
  const barat = await findBranchByCode(companyId, "BARAT");
  if (!pusat || !timur || !barat) throw new Error("Seed cabang tidak lengkap");
  pusatBranchId = pusat.id;
  timurBranchId = timur.id;
  baratBranchId = barat.id;

  const pusatWarehouse = await prisma.warehouse.findFirstOrThrow({
    where: { branchId: pusatBranchId, isDefault: true },
  });
  pusatWarehouseId = pusatWarehouse.id;
  // Cabang TIMUR wajib punya warehouse default aktif (dipakai receiveTransfer)
  // — dipastikan sudah ada dari seed, tidak perlu disimpan di sini.
  await prisma.warehouse.findFirstOrThrow({ where: { branchId: timurBranchId, isDefault: true } });

  const category = await prisma.category.findFirstOrThrow({ where: { companyId } });
  const baseUnit = await prisma.unit.findFirstOrThrow({ where: { companyId, name: "Tablet" } });
  const product = await prisma.product.create({
    data: {
      companyId,
      sku: `TEST-TRF-${Date.now()}`,
      name: "Produk Test Transfer",
      categoryId: category.id,
      baseUnitId: baseUnit.id,
      defaultSellingPrice: 1000,
      defaultMinStock: 0,
      isActive: true,
    },
  });
  productId = product.id;

  async function createBranchUser(email: string, branchId: string, role: Role) {
    const user = await prisma.user.create({
      data: { companyId, email, name: email, role, passwordHash: "unused-in-tests" },
    });
    createdUserIds.push(user.id);
    await prisma.userBranchAssignment.create({ data: { userId: user.id, branchId } });
    return user.id;
  }

  sourceUserId = await createBranchUser(
    `test-transfer-source-${Date.now()}@test.local`,
    pusatBranchId,
    Role.WAREHOUSE_STAFF,
  );
  destinationUserId = await createBranchUser(
    `test-transfer-dest-${Date.now()}@test.local`,
    timurBranchId,
    Role.BRANCH_MANAGER,
  );
  outsiderUserId = await createBranchUser(
    `test-transfer-outsider-${Date.now()}@test.local`,
    baratBranchId,
    Role.BRANCH_MANAGER,
  );
});

afterAll(async () => {
  for (const id of createdTransferIds) await cleanupTransfer(id);
  await prisma.stockMovement.deleteMany({ where: { productId } });
  await prisma.stockBatch.deleteMany({ where: { productId } });
  await prisma.product.delete({ where: { id: productId } });
  for (const id of createdUserIds) {
    await prisma.userBranchAssignment.deleteMany({ where: { userId: id } });
    await prisma.user.delete({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("createDraftTransfer", () => {
  it("menolak cabang asal sama dengan cabang tujuan", async () => {
    const batch = await createSourceBatch({ qty: 10 });

    await expect(
      createDraftTransfer({
        companyId,
        sourceBranchId: pusatBranchId,
        destinationBranchId: pusatBranchId,
        createdById: destinationUserId,
        items: [{ productId, sourceStockBatchId: batch.id, qtyRequested: 5 }],
      }),
    ).rejects.toThrow("tidak boleh sama");
  });
});

describe("Lifecycle transfer penuh: draft -> request -> approve -> ship -> receive", () => {
  it("ship mengurangi batch sumber & membuat TRANSFER_OUT; receive menambah batch tujuan & membuat TRANSFER_IN dengan batch/ED/cost konsisten", async () => {
    const batch = await createSourceBatch({ qty: 20, unitCost: 725 });

    const transfer = await createDraftTransfer({
      companyId,
      sourceBranchId: pusatBranchId,
      destinationBranchId: timurBranchId,
      createdById: destinationUserId,
      items: [{ productId, sourceStockBatchId: batch.id, qtyRequested: 12 }],
    });
    createdTransferIds.push(transfer.id);
    expect(transfer.documentNumber).toMatch(/^TRF-\d{6}$/);
    expect(transfer.status).toBe("DRAFT");

    await submitTransferRequest({
      allowedBranchIds: [timurBranchId],
      id: transfer.id,
      actorId: destinationUserId,
    });

    const approved = await approveTransferRequest({
      allowedBranchIds: [pusatBranchId],
      id: transfer.id,
      actorId: sourceUserId,
    });
    expect(approved.status).toBe("APPROVED");

    const shipped = await shipTransfer({
      allowedBranchIds: [pusatBranchId],
      id: transfer.id,
      actorId: sourceUserId,
    });
    expect(shipped.status).toBe("SHIPPED");

    const sourceBatchAfterShip = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(sourceBatchAfterShip.qtyOnHand.toString()).toBe("8"); // 20 - 12

    const outMovement = await prisma.stockMovement.findFirstOrThrow({
      where: { stockBatchId: batch.id, referenceType: "StockTransfer", referenceId: transfer.id },
    });
    expect(outMovement.movementType).toBe("TRANSFER_OUT");
    expect(outMovement.qtyOut.toString()).toBe("12");

    const received = await receiveTransfer({
      allowedBranchIds: [timurBranchId],
      id: transfer.id,
      actorId: destinationUserId,
      items: [{ itemId: (await getItemId(transfer.id)), qtyReceived: 12 }],
    });
    expect(received.status).toBe("RECEIVED");

    const item = await prisma.stockTransferItem.findFirstOrThrow({ where: { transferId: transfer.id } });
    expect(item.destinationStockBatchId).not.toBeNull();

    const destinationBatch = await prisma.stockBatch.findUniqueOrThrow({
      where: { id: item.destinationStockBatchId! },
    });
    expect(destinationBatch.branchId).toBe(timurBranchId);
    expect(destinationBatch.batchNumber).toBe(batch.batchNumber);
    expect(destinationBatch.expiryDate.toISOString()).toBe(batch.expiryDate.toISOString());
    expect(destinationBatch.unitCost.toString()).toBe("725");
    expect(destinationBatch.qtyOnHand.toString()).toBe("12");

    const inMovement = await prisma.stockMovement.findFirstOrThrow({
      where: {
        stockBatchId: destinationBatch.id,
        referenceType: "StockTransfer",
        referenceId: transfer.id,
      },
    });
    expect(inMovement.movementType).toBe("TRANSFER_IN");
    expect(inMovement.qtyIn.toString()).toBe("12");
  });
});

async function getItemId(transferId: string): Promise<string> {
  const item = await prisma.stockTransferItem.findFirstOrThrow({ where: { transferId } });
  return item.id;
}

describe("Validasi & rollback", () => {
  it("menolak ship yang melebihi saldo batch sumber saat ini (atomic, tanpa perubahan parsial)", async () => {
    const batch = await createSourceBatch({ qty: 5 });

    const transfer = await createDraftTransfer({
      companyId,
      sourceBranchId: pusatBranchId,
      destinationBranchId: timurBranchId,
      createdById: destinationUserId,
      items: [{ productId, sourceStockBatchId: batch.id, qtyRequested: 5 }],
    });
    createdTransferIds.push(transfer.id);

    await submitTransferRequest({ allowedBranchIds: [timurBranchId], id: transfer.id, actorId: destinationUserId });
    await approveTransferRequest({ allowedBranchIds: [pusatBranchId], id: transfer.id, actorId: sourceUserId });

    // Simulasikan stok batch berkurang di tempat lain SETELAH disetujui
    // (mis. terpakai penjualan) — saldo saat ini (2) tidak lagi cukup untuk
    // qtyRequested (5) yang mau dikirim.
    await prisma.stockBatch.update({ where: { id: batch.id }, data: { qtyOnHand: "2" } });

    const movementCountBefore = await prisma.stockMovement.count({ where: { productId } });

    await expect(
      shipTransfer({ allowedBranchIds: [pusatBranchId], id: transfer.id, actorId: sourceUserId }),
    ).rejects.toThrow(/tidak mencukupi/);

    const stillApproved = await prisma.stockTransfer.findUniqueOrThrow({ where: { id: transfer.id } });
    expect(stillApproved.status).toBe("APPROVED");

    const movementCountAfter = await prisma.stockMovement.count({ where: { productId } });
    expect(movementCountAfter).toBe(movementCountBefore);
  });

  it("penerimaan parsial: qty kurang tanpa alasan ditolak; dengan alasan tercatat sebagai PARTIALLY_RECEIVED", async () => {
    const batch = await createSourceBatch({ qty: 10 });

    const transfer = await createDraftTransfer({
      companyId,
      sourceBranchId: pusatBranchId,
      destinationBranchId: timurBranchId,
      createdById: destinationUserId,
      items: [{ productId, sourceStockBatchId: batch.id, qtyRequested: 10 }],
    });
    createdTransferIds.push(transfer.id);

    await submitTransferRequest({ allowedBranchIds: [timurBranchId], id: transfer.id, actorId: destinationUserId });
    await approveTransferRequest({ allowedBranchIds: [pusatBranchId], id: transfer.id, actorId: sourceUserId });
    await shipTransfer({ allowedBranchIds: [pusatBranchId], id: transfer.id, actorId: sourceUserId });

    const itemId = await getItemId(transfer.id);

    await expect(
      receiveTransfer({
        allowedBranchIds: [timurBranchId],
        id: transfer.id,
        actorId: destinationUserId,
        items: [{ itemId, qtyReceived: 8 }], // kurang dari 10, tanpa alasan
      }),
    ).rejects.toThrow("Alasan selisih wajib diisi");

    const partial = await receiveTransfer({
      allowedBranchIds: [timurBranchId],
      id: transfer.id,
      actorId: destinationUserId,
      items: [{ itemId, qtyReceived: 8, discrepancyReason: "2 rusak saat pengiriman" }],
    });
    expect(partial.status).toBe("PARTIALLY_RECEIVED");

    const item = await prisma.stockTransferItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.qtyReceived?.toString()).toBe("8");
    expect(item.discrepancyReason).toBe("2 rusak saat pengiriman");
  });

  it("menolak pembatalan setelah SHIPPED", async () => {
    const batch = await createSourceBatch({ qty: 10 });

    const transfer = await createDraftTransfer({
      companyId,
      sourceBranchId: pusatBranchId,
      destinationBranchId: timurBranchId,
      createdById: destinationUserId,
      items: [{ productId, sourceStockBatchId: batch.id, qtyRequested: 5 }],
    });
    createdTransferIds.push(transfer.id);

    await submitTransferRequest({ allowedBranchIds: [timurBranchId], id: transfer.id, actorId: destinationUserId });
    await approveTransferRequest({ allowedBranchIds: [pusatBranchId], id: transfer.id, actorId: sourceUserId });
    await shipTransfer({ allowedBranchIds: [pusatBranchId], id: transfer.id, actorId: sourceUserId });

    await expect(
      cancelTransfer({ allowedBranchIds: [pusatBranchId], id: transfer.id, actorId: sourceUserId }),
    ).rejects.toThrow("tidak dapat dibatalkan");
  });

  it("membatalkan transfer masih diizinkan sebelum SHIPPED (mis. saat APPROVED)", async () => {
    const batch = await createSourceBatch({ qty: 10 });

    const transfer = await createDraftTransfer({
      companyId,
      sourceBranchId: pusatBranchId,
      destinationBranchId: timurBranchId,
      createdById: destinationUserId,
      items: [{ productId, sourceStockBatchId: batch.id, qtyRequested: 5 }],
    });
    createdTransferIds.push(transfer.id);

    await submitTransferRequest({ allowedBranchIds: [timurBranchId], id: transfer.id, actorId: destinationUserId });
    await approveTransferRequest({ allowedBranchIds: [pusatBranchId], id: transfer.id, actorId: sourceUserId });

    const cancelled = await cancelTransfer({
      allowedBranchIds: [pusatBranchId],
      id: transfer.id,
      actorId: sourceUserId,
    });
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("menolak alasan penolakan kosong", async () => {
    const batch = await createSourceBatch({ qty: 10 });
    const transfer = await createDraftTransfer({
      companyId,
      sourceBranchId: pusatBranchId,
      destinationBranchId: timurBranchId,
      createdById: destinationUserId,
      items: [{ productId, sourceStockBatchId: batch.id, qtyRequested: 5 }],
    });
    createdTransferIds.push(transfer.id);
    await submitTransferRequest({ allowedBranchIds: [timurBranchId], id: transfer.id, actorId: destinationUserId });

    await expect(
      rejectTransferRequest({
        allowedBranchIds: [pusatBranchId],
        id: transfer.id,
        actorId: sourceUserId,
        reason: "   ",
      }),
    ).rejects.toThrow("Alasan penolakan wajib diisi");

    const rejected = await rejectTransferRequest({
      allowedBranchIds: [pusatBranchId],
      id: transfer.id,
      actorId: sourceUserId,
      reason: "Stok tidak mencukupi untuk cabang lain",
    });
    expect(rejected.status).toBe("REJECTED");
  });
});

describe("RBAC & isolasi cabang", () => {
  it("user di luar cabang asal maupun tujuan tidak bisa melihat ataupun memproses transfer", async () => {
    const batch = await createSourceBatch({ qty: 10 });
    const transfer = await createDraftTransfer({
      companyId,
      sourceBranchId: pusatBranchId,
      destinationBranchId: timurBranchId,
      createdById: destinationUserId,
      items: [{ productId, sourceStockBatchId: batch.id, qtyRequested: 5 }],
    });
    createdTransferIds.push(transfer.id);

    const outsiderAllowed = [baratBranchId];

    const seen = await getTransferById(outsiderAllowed, transfer.id);
    expect(seen).toBeNull();

    await expect(
      submitTransferRequest({ allowedBranchIds: outsiderAllowed, id: transfer.id, actorId: outsiderUserId }),
    ).rejects.toThrow("tidak ditemukan atau di luar akses cabang");
  });

  it("cabang tujuan tidak bisa approve/ship (harus cabang asal)", async () => {
    const batch = await createSourceBatch({ qty: 10 });
    const transfer = await createDraftTransfer({
      companyId,
      sourceBranchId: pusatBranchId,
      destinationBranchId: timurBranchId,
      createdById: destinationUserId,
      items: [{ productId, sourceStockBatchId: batch.id, qtyRequested: 5 }],
    });
    createdTransferIds.push(transfer.id);
    await submitTransferRequest({ allowedBranchIds: [timurBranchId], id: transfer.id, actorId: destinationUserId });

    await expect(
      approveTransferRequest({
        allowedBranchIds: [timurBranchId],
        id: transfer.id,
        actorId: destinationUserId,
      }),
    ).rejects.toThrow("Hanya cabang asal");
  });

  it("cabang asal tidak bisa receive (harus cabang tujuan)", async () => {
    const batch = await createSourceBatch({ qty: 10 });
    const transfer = await createDraftTransfer({
      companyId,
      sourceBranchId: pusatBranchId,
      destinationBranchId: timurBranchId,
      createdById: destinationUserId,
      items: [{ productId, sourceStockBatchId: batch.id, qtyRequested: 5 }],
    });
    createdTransferIds.push(transfer.id);
    await submitTransferRequest({ allowedBranchIds: [timurBranchId], id: transfer.id, actorId: destinationUserId });
    await approveTransferRequest({ allowedBranchIds: [pusatBranchId], id: transfer.id, actorId: sourceUserId });
    await shipTransfer({ allowedBranchIds: [pusatBranchId], id: transfer.id, actorId: sourceUserId });

    const itemId = await getItemId(transfer.id);

    await expect(
      receiveTransfer({
        allowedBranchIds: [pusatBranchId],
        id: transfer.id,
        actorId: sourceUserId,
        items: [{ itemId, qtyReceived: 5 }],
      }),
    ).rejects.toThrow("Hanya cabang tujuan");
  });
});

describe("listTransfersPaginated — filter dateFrom/dateTo (Fase 10)", () => {
  it("hanya mengembalikan transfer yang createdAt-nya berada dalam rentang", async () => {
    const batch = await createSourceBatch({ qty: 10 });
    const transfer = await createDraftTransfer({
      companyId,
      sourceBranchId: pusatBranchId,
      destinationBranchId: timurBranchId,
      createdById: destinationUserId,
      items: [{ productId, sourceStockBatchId: batch.id, qtyRequested: 5 }],
    });
    createdTransferIds.push(transfer.id);

    const farPastDate = new Date("2020-06-15T03:00:00.000Z");
    await prisma.stockTransfer.update({ where: { id: transfer.id }, data: { createdAt: farPastDate } });

    const withinRange = await listTransfersPaginated({
      companyId,
      allowedBranchIds: [pusatBranchId, timurBranchId],
      dateFrom: new Date("2020-06-15T00:00:00.000Z"),
      dateTo: new Date("2020-06-15T23:59:59.999Z"),
      page: 1,
    });
    expect(withinRange.data.some((t) => t.id === transfer.id)).toBe(true);

    const outsideRange = await listTransfersPaginated({
      companyId,
      allowedBranchIds: [pusatBranchId, timurBranchId],
      dateFrom: new Date("2021-01-01T00:00:00.000Z"),
      dateTo: new Date("2021-01-02T00:00:00.000Z"),
      page: 1,
    });
    expect(outsideRange.data.some((t) => t.id === transfer.id)).toBe(false);

    // Tanpa dateFrom/dateTo (pola lama /inventory/transfers) — tidak terpengaruh.
    const noDateFilter = await listTransfersPaginated({
      companyId,
      allowedBranchIds: [pusatBranchId, timurBranchId],
      page: 1,
      pageSize: 1000,
    });
    expect(noDateFilter.data.some((t) => t.id === transfer.id)).toBe(true);
  });
});
