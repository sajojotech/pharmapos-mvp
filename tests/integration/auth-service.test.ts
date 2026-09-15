import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getAssignedBranchIds,
  verifyCredentials,
} from "@/services/auth-service";

const DEMO_PASSWORD = "PharmaPOS#Dev2026";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("verifyCredentials", () => {
  it("login sukses untuk akun demo dengan password yang benar", async () => {
    const result = await verifyCredentials(
      "kasir.pusat@pharmapos.local",
      DEMO_PASSWORD,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.email).toBe("kasir.pusat@pharmapos.local");
      expect(result.user.role).toBe("CASHIER");
    }
  });

  it("login gagal untuk password yang salah", async () => {
    const result = await verifyCredentials(
      "kasir.pusat@pharmapos.local",
      "password-salah-sekali",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("INVALID_PASSWORD");
    }
  });

  it("login gagal untuk email yang tidak terdaftar", async () => {
    const result = await verifyCredentials(
      "tidak-ada@pharmapos.local",
      DEMO_PASSWORD,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("NOT_FOUND");
    }
  });

  it("login gagal untuk akun yang dinonaktifkan", async () => {
    const inactiveEmail = "nonaktif.test@pharmapos.local";
    const existing = await prisma.user.findUnique({
      where: { email: inactiveEmail },
    });
    const company = await prisma.company.findFirstOrThrow();

    if (!existing) {
      await prisma.user.create({
        data: {
          companyId: company.id,
          email: inactiveEmail,
          name: "Akun Nonaktif (test)",
          role: "CASHIER",
          passwordHash: "$2a$12$invalidhashinvalidhashinvalidhashinvalidha",
          isActive: false,
        },
      });
    }

    const result = await verifyCredentials(inactiveEmail, DEMO_PASSWORD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("INACTIVE");
    }

    await prisma.user.delete({ where: { email: inactiveEmail } });
  });
});

describe("getAssignedBranchIds", () => {
  it("role per-cabang (kasir) memiliki minimal satu cabang ditugaskan", async () => {
    const kasir = await prisma.user.findUniqueOrThrow({
      where: { email: "kasir.pusat@pharmapos.local" },
    });
    const branchIds = await getAssignedBranchIds(kasir.id);
    expect(branchIds.length).toBeGreaterThanOrEqual(1);
  });

  it("role global (owner) tidak wajib memiliki baris UserBranchAssignment", async () => {
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: "owner@pharmapos.local" },
    });
    const branchIds = await getAssignedBranchIds(owner.id);
    expect(branchIds).toEqual([]);
  });
});
