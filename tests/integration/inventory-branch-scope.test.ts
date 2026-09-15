import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findBranchByCode, getAllowedBranchIds } from "@/services/branch-service";
import {
  listAvailableBatchesForBranch,
  listBatchesPaginated,
  listStockBalance,
} from "@/services/stock-batch-service";
import { listMovementsPaginated } from "@/services/stock-movement-service";
import { createDraftAdjustment, postAdjustment } from "@/services/stock-adjustment-service";
import { receiveStockToBatch } from "@/services/stock-ledger";

let companyId: string;
let pusatBranchId: string;
let timurBranchId: string;
let timurWarehouseId: string;
let productId: string;
let userId: string;
let timurBatchId: string;

const FUTURE_DATE = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);

beforeAll(async () => {
  const company = await prisma.company.findFirstOrThrow();
  companyId = company.id;

  const pusat = await findBranchByCode(companyId, "PUSAT");
  const timur = await findBranchByCode(companyId, "TIMUR");
  if (!pusat || !timur) throw new Error("Seed cabang tidak lengkap");
  pusatBranchId = pusat.id;
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

  // Data stok khusus test HANYA di cabang TIMUR, untuk dipastikan tidak
  // terlihat oleh user yang hanya ditugaskan ke PUSAT.
  const result = await receiveStockToBatch(prisma, {
    companyId,
    branchId: timurBranchId,
    warehouseId: timurWarehouseId,
    productId,
    batchNumber: "TEST-SCOPE-TIMUR-001",
    expiryDate: FUTURE_DATE,
    receivedDate: new Date(),
    unitCost: 1000,
    qty: 40,
    movementType: "OPENING_BALANCE",
    referenceType: "Test",
    referenceId: "test-scope-timur",
    createdById: userId,
  });
  timurBatchId = result.batchId;
});

afterAll(async () => {
  await prisma.stockMovement.deleteMany({ where: { stockBatchId: timurBatchId } });
  await prisma.stockBatch.delete({ where: { id: timurBatchId } });
  await prisma.$disconnect();
});

describe("getAllowedBranchIds", () => {
  it("role per-cabang (Cashier) hanya mendapat cabang yang ditugaskan", async () => {
    const ids = await getAllowedBranchIds({
      companyId,
      role: Role.CASHIER,
      assignedBranchIds: [pusatBranchId],
    });
    expect(ids).toEqual([pusatBranchId]);
    expect(ids).not.toContain(timurBranchId);
  });

  it("role global (Owner) mendapat seluruh cabang aktif", async () => {
    const ids = await getAllowedBranchIds({
      companyId,
      role: Role.OWNER,
      assignedBranchIds: [],
    });
    expect(ids).toContain(pusatBranchId);
    expect(ids).toContain(timurBranchId);
  });
});

describe("Isolasi data stok lintas cabang", () => {
  it("listBatchesPaginated dengan allowedBranchIds=[PUSAT] tidak menampilkan batch TIMUR", async () => {
    const { data } = await listBatchesPaginated({
      companyId,
      allowedBranchIds: [pusatBranchId],
      page: 1,
      pageSize: 100,
    });
    expect(data.some((b) => b.id === timurBatchId)).toBe(false);
  });

  it("listBatchesPaginated mengabaikan branchId filter di luar allowedBranchIds (bukan menampilkan semua)", async () => {
    const { data, totalCount } = await listBatchesPaginated({
      companyId,
      allowedBranchIds: [pusatBranchId], // user hanya boleh PUSAT
      branchId: timurBranchId, // tapi mencoba minta data TIMUR
      page: 1,
      pageSize: 100,
    });
    expect(totalCount).toBe(0);
    expect(data).toHaveLength(0);
  });

  it("listStockBalance dengan allowedBranchIds=[PUSAT] tidak menyertakan saldo cabang TIMUR", async () => {
    const rows = await listStockBalance({
      companyId,
      allowedBranchIds: [pusatBranchId],
    });
    expect(rows.some((r) => r.branchId === timurBranchId)).toBe(false);
  });

  it("listMovementsPaginated dengan allowedBranchIds=[PUSAT] tidak menyertakan movement cabang TIMUR", async () => {
    const { data } = await listMovementsPaginated({
      companyId,
      allowedBranchIds: [pusatBranchId],
      page: 1,
      pageSize: 200,
    });
    expect(data.some((m) => m.stockBatchId === timurBatchId)).toBe(false);
  });

  it("postAdjustment menolak dokumen di cabang di luar allowedBranchIds milik pemanggil", async () => {
    const draft = await createDraftAdjustment({
      companyId,
      branchId: timurBranchId,
      reason: "Adjustment cabang TIMUR",
      createdById: userId,
      items: [{ stockBatchId: timurBatchId, direction: "OUT", qty: 1 }],
    });

    await expect(
      postAdjustment({
        companyId,
        allowedBranchIds: [pusatBranchId], // user hanya berwenang di PUSAT
        id: draft.id,
        postedById: userId,
      }),
    ).rejects.toThrow(/di luar akses cabang/);

    // Dokumen tetap DRAFT & stok tidak berubah karena ditolak sebelum posting
    const stillDraft = await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: draft.id } });
    expect(stillDraft.status).toBe("DRAFT");

    await prisma.stockAdjustmentItem.deleteMany({ where: { stockAdjustmentId: draft.id } });
    await prisma.stockAdjustment.delete({ where: { id: draft.id } });
  });

  it("listAvailableBatchesForBranch (Fase 11 hardening) menegakkan companyId, bukan cuma branchId", async () => {
    const withCorrectCompany = await listAvailableBatchesForBranch(companyId, timurBranchId);
    expect(withCorrectCompany.some((b) => b.id === timurBatchId)).toBe(true);

    const otherCompany = await prisma.company.create({ data: { name: `TEST-SCOPE-OTHER-CO-${Date.now()}` } });
    try {
      const withWrongCompany = await listAvailableBatchesForBranch(otherCompany.id, timurBranchId);
      expect(withWrongCompany.some((b) => b.id === timurBatchId)).toBe(false);
      expect(withWrongCompany).toHaveLength(0);
    } finally {
      await prisma.company.delete({ where: { id: otherCompany.id } });
    }
  });
});
