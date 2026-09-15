import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { findBranchByCode } from "@/services/branch-service";
import {
  cancelDraftReceipt,
  createDraftReceipt,
  getReceiptById,
  postReceipt,
  updateDraftReceipt,
  type ReceiptItemInput,
} from "@/services/purchase-receipt-service";

let companyId: string;
let pusatBranchId: string;
let timurBranchId: string;
let supplierId: string;
let productId: string; // OBT-0001, base unit Tablet, punya konversi Strip(10)/Box(100)
let baseUnitId: string;
let stripUnitId: string;
let inactiveProductId: string;
let userId: string;

const FUTURE_DATE = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
const PAST_DATE = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);

/**
 * Dikumpulkan di setiap test (bukan dibersihkan inline di akhir tiap test)
 * lalu dibersihkan sekaligus di afterAll — supaya cleanup tetap berjalan
 * walau sebuah test gagal di tengah jalan (assertion yang throw akan
 * melompati baris cleanup inline bila diletakkan di akhir body test).
 */
const createdReceiptIds: string[] = [];

async function cleanupReceipt(id: string) {
  try {
    const receipt = await prisma.purchaseReceipt.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!receipt) return;

    for (const item of receipt.items) {
      if (item.batchNumber) {
        const batch = await prisma.stockBatch.findFirst({
          where: { branchId: receipt.branchId, productId: item.productId, batchNumber: item.batchNumber },
        });
        if (batch) {
          await prisma.stockMovement.deleteMany({ where: { stockBatchId: batch.id } });
          await prisma.stockBatch.delete({ where: { id: batch.id } });
        }
      }
    }
    await prisma.auditLog.deleteMany({ where: { entityType: "PurchaseReceipt", entityId: id } });
    await prisma.purchaseReceiptItem.deleteMany({ where: { purchaseReceiptId: id } });
    await prisma.purchaseReceipt.delete({ where: { id } });
  } catch {
    // Sudah terhapus / tidak lengkap — abaikan supaya afterAll tetap
    // membersihkan sisa dokumen lain.
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

  const supplier = await prisma.supplier.findFirstOrThrow({ where: { companyId } });
  supplierId = supplier.id;

  const product = await prisma.product.findUniqueOrThrow({
    where: { companyId_sku: { companyId, sku: "OBT-0001" } },
    include: { unitConversions: { include: { unit: true } } },
  });
  productId = product.id;
  baseUnitId = product.baseUnitId;
  const stripConversion = product.unitConversions.find((uc) => uc.unit.name === "Strip");
  if (!stripConversion) throw new Error("Seed konversi Strip untuk OBT-0001 tidak ditemukan");
  stripUnitId = stripConversion.unitId;

  const user = await prisma.user.findUniqueOrThrow({
    where: { email: "gudang.pusat@pharmapos.local" },
  });
  userId = user.id;

  const inactiveProduct = await prisma.product.create({
    data: {
      companyId,
      sku: "TEST-PR-INACTIVE",
      name: "Produk Nonaktif (test PR)",
      categoryId: product.categoryId,
      baseUnitId: product.baseUnitId,
      defaultSellingPrice: 1000,
      defaultMinStock: 0,
      isActive: false,
    },
  });
  inactiveProductId = inactiveProduct.id;
});

afterAll(async () => {
  for (const id of createdReceiptIds) {
    await cleanupReceipt(id);
  }
  await prisma.product.delete({ where: { id: inactiveProductId } });
  await prisma.$disconnect();
});

function baseItem(overrides: Partial<ReceiptItemInput> = {}): ReceiptItemInput {
  return {
    productId,
    unitId: baseUnitId,
    qty: 100,
    unitCost: 300,
    discountAmount: 0,
    batchNumber: `TEST-PR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    expiryDate: FUTURE_DATE,
    ...overrides,
  };
}

describe("createDraftReceipt", () => {
  it("draft dapat dibuat tanpa mengubah stok", async () => {
    const before = await prisma.stockBatch.count({ where: { productId, branchId: pusatBranchId } });

    const draft = await createDraftReceipt({
      companyId,
      branchId: pusatBranchId,
      supplierId,
      supplierInvoiceNumber: "INV-TEST-001",
      supplierInvoiceDate: new Date(),
      receivedDate: new Date(),
      createdById: userId,
      items: [baseItem()],
    });
    createdReceiptIds.push(draft.id);

    expect(draft.status).toBe("DRAFT");
    expect(draft.documentNumber).toMatch(/^PR-\d{6}$/);

    const after = await prisma.stockBatch.count({ where: { productId, branchId: pusatBranchId } });
    expect(after).toBe(before);

    await cleanupReceipt(draft.id);
  });
});

describe("postReceipt", () => {
  it("menambah stok batch dengan benar dan membuat StockMovement PURCHASE_RECEIPT", async () => {
    const draft = await createDraftReceipt({
      companyId,
      branchId: pusatBranchId,
      supplierId,
      supplierInvoiceNumber: "INV-TEST-002",
      supplierInvoiceDate: new Date(),
      receivedDate: new Date(),
      createdById: userId,
      items: [baseItem({ batchNumber: "TEST-PR-POST-001", qty: 100, unitCost: 300 })],
    });
    createdReceiptIds.push(draft.id);

    const posted = await postReceipt({
      companyId,
      allowedBranchIds: [pusatBranchId],
      id: draft.id,
      postedById: userId,
    });
    expect(posted.status).toBe("POSTED");
    expect(posted.postedAt).not.toBeNull();

    const batch = await prisma.stockBatch.findFirstOrThrow({
      where: { branchId: pusatBranchId, productId, batchNumber: "TEST-PR-POST-001" },
    });
    expect(batch.qtyOnHand.toString()).toBe("100");
    expect(batch.unitCost.toString()).toBe("300");

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { stockBatchId: batch.id, referenceType: "PurchaseReceipt", referenceId: draft.id },
    });
    expect(movement.movementType).toBe("PURCHASE_RECEIPT");
    expect(movement.qtyIn.toString()).toBe("100");
    expect(movement.balanceAfter.toString()).toBe("100");

    const auditLog = await prisma.auditLog.findFirst({
      where: { entityType: "PurchaseReceipt", entityId: draft.id, action: "POST" },
    });
    expect(auditLog).not.toBeNull();

    await cleanupReceipt(draft.id);
  });

  it("mengonversi qty & harga ke base unit saat membeli dalam satuan Strip (bukan base unit)", async () => {
    // 1 Strip = 10 Tablet (seed). Beli 5 Strip @ Rp5.000/strip -> 50 Tablet,
    // harga per Tablet = 5000/10 = 500.
    const draft = await createDraftReceipt({
      companyId,
      branchId: pusatBranchId,
      supplierId,
      supplierInvoiceNumber: "INV-TEST-003",
      supplierInvoiceDate: new Date(),
      receivedDate: new Date(),
      createdById: userId,
      items: [
        baseItem({
          unitId: stripUnitId,
          batchNumber: "TEST-PR-STRIP-001",
          qty: 5,
          unitCost: 5000,
          discountAmount: 0,
        }),
      ],
    });
    createdReceiptIds.push(draft.id);

    await postReceipt({ companyId, allowedBranchIds: [pusatBranchId], id: draft.id, postedById: userId });

    const batch = await prisma.stockBatch.findFirstOrThrow({
      where: { branchId: pusatBranchId, productId, batchNumber: "TEST-PR-STRIP-001" },
    });
    expect(batch.qtyOnHand.toString()).toBe("50");
    expect(batch.unitCost.toString()).toBe("500");

    await cleanupReceipt(draft.id);
  });

  it("menerapkan discountAmount sebelum konversi ke base unit", async () => {
    // 10 Tablet @ Rp300, diskon Rp500 total -> subtotal 3000-500=2500 -> per tablet 250.
    const draft = await createDraftReceipt({
      companyId,
      branchId: pusatBranchId,
      supplierId,
      supplierInvoiceNumber: "INV-TEST-004",
      supplierInvoiceDate: new Date(),
      receivedDate: new Date(),
      createdById: userId,
      items: [
        baseItem({
          batchNumber: "TEST-PR-DISCOUNT-001",
          qty: 10,
          unitCost: 300,
          discountAmount: 500,
        }),
      ],
    });
    createdReceiptIds.push(draft.id);

    await postReceipt({ companyId, allowedBranchIds: [pusatBranchId], id: draft.id, postedById: userId });

    const batch = await prisma.stockBatch.findFirstOrThrow({
      where: { branchId: pusatBranchId, productId, batchNumber: "TEST-PR-DISCOUNT-001" },
    });
    expect(batch.unitCost.toString()).toBe("250");

    await cleanupReceipt(draft.id);
  });

  it("tidak dapat post dua kali", async () => {
    const draft = await createDraftReceipt({
      companyId,
      branchId: pusatBranchId,
      supplierId,
      supplierInvoiceNumber: "INV-TEST-005",
      supplierInvoiceDate: new Date(),
      receivedDate: new Date(),
      createdById: userId,
      items: [baseItem({ batchNumber: "TEST-PR-REPOST-001" })],
    });
    createdReceiptIds.push(draft.id);

    await postReceipt({ companyId, allowedBranchIds: [pusatBranchId], id: draft.id, postedById: userId });

    await expect(
      postReceipt({ companyId, allowedBranchIds: [pusatBranchId], id: draft.id, postedById: userId }),
    ).rejects.toThrow(/DRAFT/);

    await cleanupReceipt(draft.id);
  });

  it("menolak ED lampau (<= tanggal penerimaan)", async () => {
    const receivedDate = new Date();
    const draft = await createDraftReceipt({
      companyId,
      branchId: pusatBranchId,
      supplierId,
      supplierInvoiceNumber: "INV-TEST-006",
      supplierInvoiceDate: receivedDate,
      receivedDate,
      createdById: userId,
      items: [baseItem({ batchNumber: "TEST-PR-EXPIRED-001", expiryDate: PAST_DATE })],
    });
    createdReceiptIds.push(draft.id);

    await expect(
      postReceipt({ companyId, allowedBranchIds: [pusatBranchId], id: draft.id, postedById: userId }),
    ).rejects.toThrow(/ED/);

    const stillDraft = await prisma.purchaseReceipt.findUniqueOrThrow({ where: { id: draft.id } });
    expect(stillDraft.status).toBe("DRAFT");

    await cleanupReceipt(draft.id);
  });

  it("menolak qty nol", async () => {
    const draft = await createDraftReceipt({
      companyId,
      branchId: pusatBranchId,
      supplierId,
      supplierInvoiceNumber: "INV-TEST-007",
      supplierInvoiceDate: new Date(),
      receivedDate: new Date(),
      createdById: userId,
      items: [baseItem({ batchNumber: "TEST-PR-ZEROQTY-001", qty: 0 })],
    });
    createdReceiptIds.push(draft.id);

    await expect(
      postReceipt({ companyId, allowedBranchIds: [pusatBranchId], id: draft.id, postedById: userId }),
    ).rejects.toThrow(/lebih dari 0/);

    await cleanupReceipt(draft.id);
  });

  it("menolak posting bila produk salah satu item sudah nonaktif, dan tidak membuat batch/movement sama sekali (rollback penuh)", async () => {
    const draft = await createDraftReceipt({
      companyId,
      branchId: pusatBranchId,
      supplierId,
      supplierInvoiceNumber: "INV-TEST-008",
      supplierInvoiceDate: new Date(),
      receivedDate: new Date(),
      createdById: userId,
      items: [
        baseItem({ batchNumber: "TEST-PR-ROLLBACK-VALID" }), // item valid
        baseItem({
          productId: inactiveProductId,
          batchNumber: "TEST-PR-ROLLBACK-INVALID",
        }), // item dengan produk nonaktif -> gagal
      ],
    });
    createdReceiptIds.push(draft.id);

    await expect(
      postReceipt({ companyId, allowedBranchIds: [pusatBranchId], id: draft.id, postedById: userId }),
    ).rejects.toThrow(/nonaktif/);

    // Item pertama yang VALID seharusnya TIDAK membuat batch sama sekali,
    // karena seluruh posting harus rollback (all-or-nothing).
    const partialBatch = await prisma.stockBatch.findFirst({
      where: { branchId: pusatBranchId, productId, batchNumber: "TEST-PR-ROLLBACK-VALID" },
    });
    expect(partialBatch).toBeNull();

    const stillDraft = await prisma.purchaseReceipt.findUniqueOrThrow({ where: { id: draft.id } });
    expect(stillDraft.status).toBe("DRAFT");

    await cleanupReceipt(draft.id);
  });
});

describe("Dokumen POSTED bersifat immutable", () => {
  it("menolak update pada dokumen yang sudah POSTED", async () => {
    const draft = await createDraftReceipt({
      companyId,
      branchId: pusatBranchId,
      supplierId,
      supplierInvoiceNumber: "INV-TEST-009",
      supplierInvoiceDate: new Date(),
      receivedDate: new Date(),
      createdById: userId,
      items: [baseItem({ batchNumber: "TEST-PR-IMMUTABLE-001" })],
    });
    createdReceiptIds.push(draft.id);
    await postReceipt({ companyId, allowedBranchIds: [pusatBranchId], id: draft.id, postedById: userId });

    await expect(
      updateDraftReceipt({
        id: draft.id,
        companyId,
        allowedBranchIds: [pusatBranchId],
        branchId: pusatBranchId,
        supplierId,
        supplierInvoiceNumber: "INV-CHANGED",
        supplierInvoiceDate: new Date(),
        receivedDate: new Date(),
        items: [baseItem({ batchNumber: "TEST-PR-IMMUTABLE-002" })],
      }),
    ).rejects.toThrow(/DRAFT/);

    await expect(
      cancelDraftReceipt({
        companyId,
        allowedBranchIds: [pusatBranchId],
        id: draft.id,
        actorId: userId,
      }),
    ).rejects.toThrow(/DRAFT/);

    await cleanupReceipt(draft.id);
  });
});

describe("Isolasi cabang", () => {
  it("tidak dapat membuat/menampilkan/memposting purchase receipt di cabang tanpa akses", async () => {
    const draft = await createDraftReceipt({
      companyId,
      branchId: timurBranchId,
      supplierId,
      supplierInvoiceNumber: "INV-TEST-010",
      supplierInvoiceDate: new Date(),
      receivedDate: new Date(),
      createdById: userId,
      items: [baseItem({ batchNumber: "TEST-PR-SCOPE-001" })],
    });
    createdReceiptIds.push(draft.id);

    // User yang hanya berwenang di PUSAT tidak boleh melihat dokumen TIMUR ini
    const found = await getReceiptById([pusatBranchId], draft.id);
    expect(found).toBeNull();

    await expect(
      postReceipt({ companyId, allowedBranchIds: [pusatBranchId], id: draft.id, postedById: userId }),
    ).rejects.toThrow(/di luar akses cabang/);

    await cleanupReceipt(draft.id);
  });
});

describe("Isolasi company (Fase 11 hardening)", () => {
  it("menolak createDraftReceipt dengan productId/supplierId milik company lain", async () => {
    const otherCompany = await prisma.company.create({ data: { name: `TEST-PR-OTHER-CO-${Date.now()}` } });
    const otherCategory = await prisma.category.create({
      data: { companyId: otherCompany.id, name: `TEST-CAT-${Date.now()}` },
    });
    const otherUnit = await prisma.unit.create({
      data: { companyId: otherCompany.id, name: `TEST-UNIT-${Date.now()}` },
    });
    const otherProduct = await prisma.product.create({
      data: {
        companyId: otherCompany.id,
        sku: `TEST-OTHER-SKU-${Date.now()}`,
        name: "Produk Company Lain",
        categoryId: otherCategory.id,
        baseUnitId: otherUnit.id,
        defaultSellingPrice: 1000,
        defaultMinStock: 0,
        isActive: true,
      },
    });
    const otherSupplier = await prisma.supplier.create({
      data: { companyId: otherCompany.id, name: "Supplier Company Lain" },
    });

    try {
      await expect(
        createDraftReceipt({
          companyId, // company SAYA
          branchId: pusatBranchId,
          supplierId,
          supplierInvoiceNumber: "INV-TEST-CROSS-CO-1",
          supplierInvoiceDate: new Date(),
          receivedDate: new Date(),
          createdById: userId,
          items: [baseItem({ productId: otherProduct.id, unitId: otherUnit.id })],
        }),
      ).rejects.toThrow("Salah satu produk pada item tidak ditemukan");

      await expect(
        createDraftReceipt({
          companyId,
          branchId: pusatBranchId,
          supplierId: otherSupplier.id,
          supplierInvoiceNumber: "INV-TEST-CROSS-CO-2",
          supplierInvoiceDate: new Date(),
          receivedDate: new Date(),
          createdById: userId,
          items: [baseItem()],
        }),
      ).rejects.toThrow("Supplier tidak ditemukan");
    } finally {
      await prisma.product.delete({ where: { id: otherProduct.id } });
      await prisma.supplier.delete({ where: { id: otherSupplier.id } });
      await prisma.unit.delete({ where: { id: otherUnit.id } });
      await prisma.category.delete({ where: { id: otherCategory.id } });
      await prisma.company.delete({ where: { id: otherCompany.id } });
    }
  });
});
