import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

/**
 * Test integrasi ini membaca database PostgreSQL sungguhan (lihat
 * docker-compose.yml) yang sudah dijalankan migration + seed
 * (`npx prisma migrate dev` lalu `npx prisma db seed`). Test bersifat
 * read-only terhadap data seed, sehingga aman dijalankan berulang kali.
 */

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

describe("seed: tenant & cabang", () => {
  it("membuat tepat satu Company", async () => {
    const count = await prisma.company.count({
      where: { name: "PT Sehat Sentosa" },
    });
    expect(count).toBe(1);
  });

  it("membuat 3 cabang aktif dengan kode PUSAT/BARAT/TIMUR", async () => {
    const branches = await prisma.branch.findMany({
      where: { companyId },
      orderBy: { code: "asc" },
    });
    expect(branches.map((b) => b.code)).toEqual(["BARAT", "PUSAT", "TIMUR"]);
    expect(branches.every((b) => b.isActive)).toBe(true);
  });

  it("setiap cabang punya tepat satu warehouse default", async () => {
    const branches = await prisma.branch.findMany({ where: { companyId } });
    for (const branch of branches) {
      const defaultWarehouses = await prisma.warehouse.findMany({
        where: { branchId: branch.id, isDefault: true },
      });
      expect(defaultWarehouses).toHaveLength(1);
    }
  });
});

describe("seed: master produk", () => {
  it("membuat minimal 10 produk", async () => {
    const count = await prisma.product.count({ where: { companyId } });
    expect(count).toBeGreaterThanOrEqual(10);
  });

  it("terdapat produk resep dan nonresep", async () => {
    const prescriptionCount = await prisma.product.count({
      where: { companyId, requiresPrescription: true },
    });
    const nonPrescriptionCount = await prisma.product.count({
      where: { companyId, requiresPrescription: false },
    });
    expect(prescriptionCount).toBeGreaterThan(0);
    expect(nonPrescriptionCount).toBeGreaterThan(0);
  });

  it("setiap produk punya minimal satu barcode", async () => {
    const products = await prisma.product.findMany({
      where: { companyId },
      include: { barcodes: true },
    });
    for (const product of products) {
      expect(product.barcodes.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("seed: mitra bisnis", () => {
  it("membuat supplier dan customer contoh, termasuk customer Umum", async () => {
    const supplierCount = await prisma.supplier.count({ where: { companyId } });
    expect(supplierCount).toBeGreaterThan(0);

    const umum = await prisma.customer.findUnique({
      where: { companyId_code: { companyId, code: "UMUM" } },
    });
    expect(umum?.name).toBe("Umum");
  });
});

describe("seed: user & role", () => {
  it("membuat satu akun demo untuk setiap role", async () => {
    const allRoles = Object.values(Role);
    for (const role of allRoles) {
      const count = await prisma.user.count({ where: { companyId, role } });
      expect(count, `role ${role} harus punya minimal 1 akun demo`).toBeGreaterThanOrEqual(1);
    }
  });

  it("tidak menyimpan password dalam bentuk plain-text", async () => {
    const users = await prisma.user.findMany({ where: { companyId } });
    for (const user of users) {
      expect(user.passwordHash).not.toBe("PharmaPOS#Dev2026");
      expect(user.passwordHash.startsWith("$2")).toBe(true); // format hash bcrypt
    }
  });

  it("role cabang (bukan lintas-cabang) memiliki UserBranchAssignment", async () => {
    const kasir = await prisma.user.findUniqueOrThrow({
      where: { email: "kasir.pusat@pharmapos.local" },
      include: { branchAssignments: true },
    });
    expect(kasir.branchAssignments.length).toBeGreaterThanOrEqual(1);
  });
});
