import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { listActiveCategories } from "@/services/category-service";
import { listActiveUnits } from "@/services/unit-service";
import { listActiveBranches } from "@/services/branch-service";
import { listActiveProducts } from "@/services/product-service";

/**
 * "Data nonaktif tidak muncul pada selector operasional default" — dites
 * dengan membuat data nonaktif khusus untuk test (bukan mengubah data seed),
 * memverifikasi tidak muncul di masing-masing listActive*, lalu membersihkan.
 */

let companyId: string;
let inactiveCategoryId: string;
let inactiveUnitId: string;
let inactiveBranchId: string;

beforeAll(async () => {
  const company = await prisma.company.findFirstOrThrow();
  companyId = company.id;

  const category = await prisma.category.create({
    data: { companyId, name: "Kategori Nonaktif (test)", isActive: false },
  });
  inactiveCategoryId = category.id;

  const unit = await prisma.unit.create({
    data: { companyId, name: "Satuan Nonaktif (test)", isActive: false },
  });
  inactiveUnitId = unit.id;

  const branch = await prisma.branch.create({
    data: {
      companyId,
      code: "TESTNONAKTIF",
      name: "Cabang Nonaktif (test)",
      address: "-",
      phone: "-",
      isActive: false,
    },
  });
  inactiveBranchId = branch.id;
});

afterAll(async () => {
  await prisma.branch.delete({ where: { id: inactiveBranchId } });
  await prisma.unit.delete({ where: { id: inactiveUnitId } });
  await prisma.category.delete({ where: { id: inactiveCategoryId } });
  await prisma.$disconnect();
});

describe("selector operasional default mengecualikan data nonaktif", () => {
  it("listActiveCategories tidak menyertakan kategori nonaktif", async () => {
    const categories = await listActiveCategories(companyId);
    expect(categories.some((c) => c.id === inactiveCategoryId)).toBe(false);
  });

  it("listActiveUnits tidak menyertakan satuan nonaktif", async () => {
    const units = await listActiveUnits(companyId);
    expect(units.some((u) => u.id === inactiveUnitId)).toBe(false);
  });

  it("listActiveBranches tidak menyertakan cabang nonaktif", async () => {
    const branches = await listActiveBranches(companyId);
    expect(branches.some((b) => b.id === inactiveBranchId)).toBe(false);
  });

  it("listActiveProducts tidak menyertakan produk nonaktif", async () => {
    const product = await prisma.product.findFirstOrThrow({ where: { companyId } });
    await prisma.product.update({
      where: { id: product.id },
      data: { isActive: false },
    });

    const products = await listActiveProducts(companyId);
    expect(products.some((p) => p.id === product.id)).toBe(false);

    // restore
    await prisma.product.update({
      where: { id: product.id },
      data: { isActive: true },
    });
  });
});
