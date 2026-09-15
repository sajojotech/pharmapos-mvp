import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createProduct,
  createProductBranchPrice,
  findProductBySku,
  getProductBranchPriceById,
  setProductBranchPriceActive,
  updateProductBranchPrice,
} from "@/services/product-service";
import { findBranchByCode } from "@/services/branch-service";

let companyId: string;
let categoryId: string;
let baseUnitId: string;
let pusatBranchId: string;
let baratBranchId: string;

beforeAll(async () => {
  const company = await prisma.company.findFirstOrThrow();
  companyId = company.id;

  const category = await prisma.category.findFirstOrThrow({ where: { companyId } });
  categoryId = category.id;

  const unit = await prisma.unit.findFirstOrThrow({ where: { companyId } });
  baseUnitId = unit.id;

  const pusat = await findBranchByCode(companyId, "PUSAT");
  const barat = await findBranchByCode(companyId, "BARAT");
  if (!pusat || !barat) throw new Error("Seed cabang tidak ditemukan");
  pusatBranchId = pusat.id;
  baratBranchId = barat.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createProduct — validasi SKU unik per company", () => {
  it("menolak SKU yang sudah dipakai produk lain di company yang sama", async () => {
    await expect(
      createProduct({
        companyId,
        sku: "OBT-0001", // sudah dipakai seed (Paracetamol)
        name: "Produk Duplikat SKU",
        categoryId,
        baseUnitId,
        defaultSellingPrice: 1000,
        defaultMinStock: 10,
        requiresPrescription: false,
        isControlled: false,
        isActive: true,
        unitConversions: [],
      }),
    ).rejects.toThrow(/SKU|barcode/i);
  });
});

describe("createProduct — validasi barcode unik (global)", () => {
  it("menolak barcode yang sudah dipakai produk lain", async () => {
    await expect(
      createProduct({
        companyId,
        sku: "TEST-BARCODE-DUP",
        name: "Produk Duplikat Barcode",
        categoryId,
        baseUnitId,
        defaultSellingPrice: 1000,
        defaultMinStock: 10,
        requiresPrescription: false,
        isControlled: false,
        isActive: true,
        barcode: "8991234500011", // sudah dipakai seed (Paracetamol)
        unitConversions: [],
      }),
    ).rejects.toThrow(/SKU|barcode/i);
  });
});

describe("createProduct — happy path (create lalu cleanup)", () => {
  it("berhasil membuat produk baru dengan SKU & barcode unik", async () => {
    const product = await createProduct({
      companyId,
      sku: "TEST-HAPPY-0001",
      name: "Produk Test Happy Path",
      categoryId,
      baseUnitId,
      defaultSellingPrice: 2500,
      defaultMinStock: 5,
      requiresPrescription: false,
      isControlled: false,
      isActive: true,
      barcode: "9999999999999",
      unitConversions: [],
    });

    expect(product.sku).toBe("TEST-HAPPY-0001");

    const found = await findProductBySku(companyId, "TEST-HAPPY-0001");
    expect(found?.barcodes[0]?.barcode).toBe("9999999999999");

    // cleanup
    await prisma.product.delete({ where: { id: product.id } });
  });
});

describe("createProductBranchPrice — validasi unik per product+branch", () => {
  it("menolak harga override kedua untuk kombinasi product+branch yang sama", async () => {
    const product = await findProductBySku(companyId, "OBT-0001");
    if (!product) throw new Error("Produk seed OBT-0001 tidak ditemukan");

    // Seed sudah membuat override BARAT+OBT-0001 (lihat prisma/seed.ts)
    await expect(
      createProductBranchPrice({
        productId: product.id,
        branchId: baratBranchId,
        price: 999,
        isActive: true,
      }),
    ).rejects.toThrow(/harga override/i);
  });

  it("mengizinkan harga override untuk kombinasi product+branch yang belum ada, lalu cleanup", async () => {
    const product = await findProductBySku(companyId, "OBT-0002");
    if (!product) throw new Error("Produk seed OBT-0002 tidak ditemukan");

    const branchPrice = await createProductBranchPrice({
      productId: product.id,
      branchId: pusatBranchId,
      price: 1600,
      isActive: true,
    });

    expect(branchPrice.price.toString()).toBe("1600");

    await prisma.productBranchPrice.delete({ where: { id: branchPrice.id } });
  });
});

describe("ProductBranchPrice — isolasi produk (Fase 11 hardening)", () => {
  it("getProductBranchPriceById/update/setActive menolak id milik produk LAIN", async () => {
    const productA = await findProductBySku(companyId, "OBT-0001");
    const productB = await findProductBySku(companyId, "OBT-0002");
    if (!productA || !productB) throw new Error("Produk seed tidak ditemukan");

    const branchPrice = await createProductBranchPrice({
      productId: productB.id,
      branchId: pusatBranchId,
      price: 1234,
      isActive: true,
    });

    try {
      // Baris ini milik productB — mengaksesnya lewat productA harus null,
      // BUKAN mengembalikan baris tsb hanya karena id-nya cocok.
      const foundViaWrongProduct = await getProductBranchPriceById(productA.id, branchPrice.id);
      expect(foundViaWrongProduct).toBeNull();

      const foundViaCorrectProduct = await getProductBranchPriceById(productB.id, branchPrice.id);
      expect(foundViaCorrectProduct).not.toBeNull();

      await expect(
        updateProductBranchPrice({
          id: branchPrice.id,
          productId: productA.id, // productId SALAH
          branchId: pusatBranchId,
          price: 9999,
          isActive: true,
        }),
      ).rejects.toThrow("tidak ditemukan");

      await expect(
        setProductBranchPriceActive({ id: branchPrice.id, productId: productA.id, isActive: false }),
      ).rejects.toThrow("tidak ditemukan");

      // Baris asli tidak berubah sama sekali oleh percobaan di atas.
      const unchanged = await getProductBranchPriceById(productB.id, branchPrice.id);
      expect(unchanged?.price.toString()).toBe("1234");
      expect(unchanged?.isActive).toBe(true);
    } finally {
      await prisma.productBranchPrice.delete({ where: { id: branchPrice.id } });
    }
  });
});
