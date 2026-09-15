import { describe, expect, it } from "vitest";
import { productFormSchema } from "@/app/(app)/master/products/product-schema";

const validBase = {
  sku: "TEST-0001",
  barcode: "",
  name: "Produk Uji",
  genericName: "",
  brandName: "",
  categoryId: "category-1",
  baseUnitId: "unit-tablet",
  defaultSellingPrice: 1000,
  defaultMinStock: 10,
  requiresPrescription: false,
  isControlled: false,
  isActive: true,
  notes: "",
  unitConversions: [] as { unitId: string; conversionFactor: number }[],
};

describe("productFormSchema — field wajib", () => {
  it("menerima payload lengkap yang valid", () => {
    const result = productFormSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("menolak produk tanpa SKU", () => {
    const result = productFormSchema.safeParse({ ...validBase, sku: "" });
    expect(result.success).toBe(false);
  });

  it("menolak produk tanpa nama", () => {
    const result = productFormSchema.safeParse({ ...validBase, name: "" });
    expect(result.success).toBe(false);
  });

  it("menolak produk tanpa kategori", () => {
    const result = productFormSchema.safeParse({ ...validBase, categoryId: "" });
    expect(result.success).toBe(false);
  });

  it("menolak produk tanpa satuan dasar", () => {
    const result = productFormSchema.safeParse({ ...validBase, baseUnitId: "" });
    expect(result.success).toBe(false);
  });

  it("menolak harga jual negatif", () => {
    const result = productFormSchema.safeParse({
      ...validBase,
      defaultSellingPrice: -100,
    });
    expect(result.success).toBe(false);
  });

  it("menolak stok minimum negatif", () => {
    const result = productFormSchema.safeParse({
      ...validBase,
      defaultMinStock: -5,
    });
    expect(result.success).toBe(false);
  });
});

describe("productFormSchema — konversi satuan", () => {
  it("menolak faktor konversi nol atau negatif", () => {
    const result = productFormSchema.safeParse({
      ...validBase,
      unitConversions: [{ unitId: "unit-strip", conversionFactor: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("menolak satuan konversi yang sama dengan satuan dasar", () => {
    const result = productFormSchema.safeParse({
      ...validBase,
      unitConversions: [{ unitId: "unit-tablet", conversionFactor: 10 }],
    });
    expect(result.success).toBe(false);
  });

  it("menolak dua baris konversi dengan satuan yang sama (duplikat)", () => {
    const result = productFormSchema.safeParse({
      ...validBase,
      unitConversions: [
        { unitId: "unit-strip", conversionFactor: 10 },
        { unitId: "unit-strip", conversionFactor: 20 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("menerima beberapa baris konversi dengan satuan berbeda", () => {
    const result = productFormSchema.safeParse({
      ...validBase,
      unitConversions: [
        { unitId: "unit-strip", conversionFactor: 10 },
        { unitId: "unit-box", conversionFactor: 100 },
      ],
    });
    expect(result.success).toBe(true);
  });
});
