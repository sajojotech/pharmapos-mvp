import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { findBranchByCode } from "@/services/branch-service";
import {
  getExpiredReport,
  getNearExpiryReport,
  getStockMinimumReport,
  resolveNearExpiryWindowDays,
} from "@/services/reports/inventory-report";

let companyId: string;
let pusatBranchId: string;
let timurBranchId: string;
let pusatWarehouseId: string;

const createdProductIds: string[] = [];
const createdBatchIds: string[] = [];

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function createIsolatedProduct(defaultMinStock = 0): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({ where: { companyId } });
  const baseUnit = await prisma.unit.findFirstOrThrow({ where: { companyId, name: "Tablet" } });
  const product = await prisma.product.create({
    data: {
      companyId,
      sku: `TEST-INVRPT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "Produk Test Laporan Inventori",
      categoryId: category.id,
      baseUnitId: baseUnit.id,
      defaultSellingPrice: 1000,
      defaultMinStock,
      isActive: true,
    },
  });
  createdProductIds.push(product.id);
  return product.id;
}

async function createBatch(params: {
  productId: string;
  branchId: string;
  warehouseId: string;
  qty: number;
  expiryOffsetDays: number;
  status?: "AVAILABLE" | "EXPIRED";
}) {
  const batch = await prisma.stockBatch.create({
    data: {
      companyId,
      branchId: params.branchId,
      warehouseId: params.warehouseId,
      productId: params.productId,
      batchNumber: `TEST-INVRPT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      expiryDate: daysFromNow(params.expiryOffsetDays),
      receivedDate: new Date(),
      qtyOnHand: params.qty,
      unitCost: 500,
      status: params.status ?? "AVAILABLE",
    },
  });
  createdBatchIds.push(batch.id);
  return batch;
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
});

afterAll(async () => {
  await prisma.appSetting
    .delete({ where: { companyId_key: { companyId, key: "NEAR_EXPIRY_WINDOW_DAYS" } } })
    .catch(() => {});
  for (const id of createdBatchIds) {
    await prisma.stockMovement.deleteMany({ where: { stockBatchId: id } });
    await prisma.stockBatch.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdProductIds) {
    await prisma.product.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe("resolveNearExpiryWindowDays", () => {
  it("default 90 hari bila AppSetting tidak ada", async () => {
    const days = await resolveNearExpiryWindowDays(companyId);
    expect(days).toBe(90);
  });

  it("mengikuti AppSetting NEAR_EXPIRY_WINDOW_DAYS bila ada", async () => {
    await prisma.appSetting.create({
      data: { companyId, key: "NEAR_EXPIRY_WINDOW_DAYS", value: 30 },
    });
    const days = await resolveNearExpiryWindowDays(companyId);
    expect(days).toBe(30);
    await prisma.appSetting.delete({ where: { companyId_key: { companyId, key: "NEAR_EXPIRY_WINDOW_DAYS" } } });
  });
});

describe("getNearExpiryReport & getExpiredReport", () => {
  it("batch dalam window muncul di near-expiry, di luar window tidak, dan yang sudah lewat ED dipisah ke expired", async () => {
    const productId = await createIsolatedProduct();
    const withinWindow = await createBatch({
      productId,
      branchId: pusatBranchId,
      warehouseId: pusatWarehouseId,
      qty: 10,
      expiryOffsetDays: 30, // dalam window 90 hari default
    });
    const outsideWindow = await createBatch({
      productId,
      branchId: pusatBranchId,
      warehouseId: pusatWarehouseId,
      qty: 10,
      expiryOffsetDays: 200, // di luar window 90 hari
    });
    const alreadyExpired = await createBatch({
      productId,
      branchId: pusatBranchId,
      warehouseId: pusatWarehouseId,
      qty: 10,
      expiryOffsetDays: -5, // sudah lewat ED
    });

    const nearExpiry = await getNearExpiryReport({
      companyId,
      allowedBranchIds: [pusatBranchId],
      productId,
      page: 1,
      pageSize: 50,
    });
    const nearExpiryIds = nearExpiry.data.map((b) => b.id);
    expect(nearExpiryIds).toContain(withinWindow.id);
    expect(nearExpiryIds).not.toContain(outsideWindow.id);
    expect(nearExpiryIds).not.toContain(alreadyExpired.id);

    const expired = await getExpiredReport({
      companyId,
      allowedBranchIds: [pusatBranchId],
      productId,
      page: 1,
      pageSize: 50,
    });
    const expiredIds = expired.data.map((b) => b.id);
    expect(expiredIds).toContain(alreadyExpired.id);
    expect(expiredIds).not.toContain(withinWindow.id);
    expect(expiredIds).not.toContain(outsideWindow.id);
  });

  it("menghormati windowDays custom yang diberikan eksplisit", async () => {
    const productId = await createIsolatedProduct();
    const batch45 = await createBatch({
      productId,
      branchId: pusatBranchId,
      warehouseId: pusatWarehouseId,
      qty: 5,
      expiryOffsetDays: 45,
    });

    const withWindow30 = await getNearExpiryReport({
      companyId,
      allowedBranchIds: [pusatBranchId],
      productId,
      windowDays: 30,
      page: 1,
      pageSize: 50,
    });
    expect(withWindow30.data.map((b) => b.id)).not.toContain(batch45.id);

    const withWindow60 = await getNearExpiryReport({
      companyId,
      allowedBranchIds: [pusatBranchId],
      productId,
      windowDays: 60,
      page: 1,
      pageSize: 50,
    });
    expect(withWindow60.data.map((b) => b.id)).toContain(batch45.id);
  });

  it("branch scoping: cabang di luar allowedBranchIds tidak muncul", async () => {
    const productId = await createIsolatedProduct();
    const timurWarehouse = await prisma.warehouse.findFirstOrThrow({
      where: { branchId: timurBranchId, isDefault: true },
    });
    const timurBatch = await createBatch({
      productId,
      branchId: timurBranchId,
      warehouseId: timurWarehouse.id,
      qty: 5,
      expiryOffsetDays: 10,
    });

    const pusatOnly = await getNearExpiryReport({
      companyId,
      allowedBranchIds: [pusatBranchId],
      productId,
      page: 1,
      pageSize: 50,
    });
    expect(pusatOnly.data.map((b) => b.id)).not.toContain(timurBatch.id);
  });
});

describe("getStockMinimumReport", () => {
  it("produk di bawah/sama defaultMinStock muncul, yang cukup tidak", async () => {
    const belowMinProductId = await createIsolatedProduct(20);
    await createBatch({
      productId: belowMinProductId,
      branchId: pusatBranchId,
      warehouseId: pusatWarehouseId,
      qty: 5,
      expiryOffsetDays: 100,
    });

    const sufficientProductId = await createIsolatedProduct(5);
    await createBatch({
      productId: sufficientProductId,
      branchId: pusatBranchId,
      warehouseId: pusatWarehouseId,
      qty: 50,
      expiryOffsetDays: 100,
    });

    const rows = await getStockMinimumReport({
      companyId,
      allowedBranchIds: [pusatBranchId],
    });
    const productIds = rows.map((r) => r.productId);
    expect(productIds).toContain(belowMinProductId);
    expect(productIds).not.toContain(sufficientProductId);

    const belowMinRow = rows.find((r) => r.productId === belowMinProductId);
    expect(belowMinRow?.qtyOnHand.toString()).toBe("5");
    expect(belowMinRow?.minStock.toString()).toBe("20");
  });
});
