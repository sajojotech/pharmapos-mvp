import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

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

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

describe("database constraints", () => {
  it("menolak kode Branch yang duplikat dalam satu company", async () => {
    await expect(
      prisma.branch.create({
        data: {
          companyId,
          code: "PUSAT", // sudah dipakai branch seed
          name: "Duplikat Pusat",
          address: "-",
          phone: "-",
        },
      }),
    ).rejects.toSatisfy(isUniqueConstraintError);
  });

  it("menolak email User yang duplikat", async () => {
    await expect(
      prisma.user.create({
        data: {
          companyId,
          email: "owner@pharmapos.local", // sudah dipakai seed
          name: "Duplikat Owner",
          role: "OWNER",
          passwordHash: "x",
        },
      }),
    ).rejects.toSatisfy(isUniqueConstraintError);
  });

  it("menolak barcode produk yang duplikat lintas produk", async () => {
    const product = await prisma.product.findFirstOrThrow({
      where: { companyId },
    });

    await expect(
      prisma.productBarcode.create({
        data: {
          productId: product.id,
          barcode: "8991234500011", // sudah dipakai Paracetamol
        },
      }),
    ).rejects.toSatisfy(isUniqueConstraintError);
  });

  it("menolak UserBranchAssignment duplikat pada kombinasi userId+branchId", async () => {
    const assignment = await prisma.userBranchAssignment.findFirstOrThrow({});

    await expect(
      prisma.userBranchAssignment.create({
        data: {
          userId: assignment.userId,
          branchId: assignment.branchId,
        },
      }),
    ).rejects.toSatisfy(isUniqueConstraintError);
  });

  it("menolak ProductBranchPrice duplikat pada kombinasi branchId+productId", async () => {
    const existing = await prisma.productBranchPrice.findFirstOrThrow({});

    await expect(
      prisma.productBranchPrice.create({
        data: {
          branchId: existing.branchId,
          productId: existing.productId,
          price: 999,
        },
      }),
    ).rejects.toSatisfy(isUniqueConstraintError);
  });

  it("mengizinkan qty desimal presisi pada defaultMinStock tanpa floating point drift", async () => {
    const product = await prisma.product.findFirstOrThrow({
      where: { companyId },
    });
    // Pastikan tipe yang dikembalikan adalah Prisma.Decimal, bukan number,
    // sehingga tidak ada representasi floating-point untuk nilai kuantitas.
    expect(product.defaultMinStock).toBeInstanceOf(Prisma.Decimal);
  });
});
