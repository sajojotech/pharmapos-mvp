import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  findBranchByCode,
  listActiveBranches,
} from "@/services/branch-service";
import {
  findProductByBarcode,
  findProductBySku,
  listActiveProducts,
} from "@/services/product-service";

let companyId: string;

beforeAll(async () => {
  const company = await prisma.company.findUniqueOrThrow({
    where: { name: "PT Sehat Sentosa" },
  });
  companyId = company.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("branch-service", () => {
  it("listActiveBranches mengembalikan 3 cabang terurut berdasarkan kode", async () => {
    const branches = await listActiveBranches(companyId);
    expect(branches.map((b) => b.code)).toEqual(["BARAT", "PUSAT", "TIMUR"]);
  });

  it("findBranchByCode menemukan cabang Pusat", async () => {
    const branch = await findBranchByCode(companyId, "PUSAT");
    expect(branch?.name).toBe("Apotek Sehat Sentosa Pusat");
  });

  it("findBranchByCode mengembalikan null untuk kode yang tidak ada", async () => {
    const branch = await findBranchByCode(companyId, "TIDAK-ADA");
    expect(branch).toBeNull();
  });
});

describe("product-service", () => {
  it("listActiveProducts menyertakan kategori dan base unit", async () => {
    const products = await listActiveProducts(companyId);
    expect(products.length).toBeGreaterThanOrEqual(10);
    expect(products[0]?.category?.name).toBeTruthy();
    expect(products[0]?.baseUnit?.name).toBeTruthy();
  });

  it("findProductBySku menemukan Paracetamol lewat SKU", async () => {
    const product = await findProductBySku(companyId, "OBT-0001");
    expect(product?.name).toBe("Paracetamol 500mg");
    expect(product?.requiresPrescription).toBe(false);
  });

  it("findProductByBarcode menemukan produk yang sama lewat barcode fisiknya", async () => {
    const product = await findProductByBarcode("8991234500011");
    expect(product?.sku).toBe("OBT-0001");
  });

  it("findProductByBarcode mengembalikan null untuk barcode yang tidak terdaftar", async () => {
    const product = await findProductByBarcode("0000000000000");
    expect(product).toBeNull();
  });
});
