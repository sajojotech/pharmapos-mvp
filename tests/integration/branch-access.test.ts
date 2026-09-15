import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findAccessibleBranch } from "@/lib/rbac-core";
import type { SessionUser } from "@/lib/rbac-core";
import { findBranchByCode } from "@/services/branch-service";

/**
 * Menguji lapisan validasi yang sesungguhnya dipakai oleh
 * setActiveBranchAction (lib/actions/active-branch-actions.ts) tanpa harus
 * menjalankan Server Action itu sendiri — findAccessibleBranch menerima
 * `user` sebagai parameter eksplisit (bukan membaca session/cookies Next.js
 * secara langsung), sehingga bisa diuji terhadap database sungguhan tanpa
 * request context Next.js. Ini adalah bukti konkret untuk kriteria
 * "Server Action yang membutuhkan branchId menolak branchId di luar
 * assignment user".
 */

let pusatId: string;
let baratId: string;
let companyId: string;

beforeAll(async () => {
  const company = await prisma.company.findFirstOrThrow();
  companyId = company.id;
  const pusat = await findBranchByCode(companyId, "PUSAT");
  const barat = await findBranchByCode(companyId, "BARAT");
  if (!pusat || !barat) throw new Error("Seed cabang tidak ditemukan");
  pusatId = pusat.id;
  baratId = barat.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function makeUser(overrides: Partial<SessionUser>): SessionUser {
  return {
    id: "user-x",
    email: "x@pharmapos.local",
    name: "X",
    role: Role.CASHIER,
    companyId,
    assignedBranchIds: [],
    ...overrides,
  };
}

describe("findAccessibleBranch (dipakai setActiveBranchAction)", () => {
  it("cashier BISA memilih cabang yang ditugaskan (PUSAT)", async () => {
    const cashier = makeUser({ role: Role.CASHIER, assignedBranchIds: [pusatId] });
    const branch = await findAccessibleBranch(cashier, pusatId);
    expect(branch?.code).toBe("PUSAT");
  });

  it("cashier TIDAK BISA memilih cabang yang tidak ditugaskan (BARAT)", async () => {
    const cashier = makeUser({ role: Role.CASHIER, assignedBranchIds: [pusatId] });
    const branch = await findAccessibleBranch(cashier, baratId);
    expect(branch).toBeNull();
  });

  it("owner BISA memilih cabang mana pun yang tersedia di company-nya", async () => {
    const owner = makeUser({ role: Role.OWNER, assignedBranchIds: [] });
    const branchPusat = await findAccessibleBranch(owner, pusatId);
    const branchBarat = await findAccessibleBranch(owner, baratId);
    expect(branchPusat?.code).toBe("PUSAT");
    expect(branchBarat?.code).toBe("BARAT");
  });

  it("menolak branchId yang tidak ada sama sekali di database", async () => {
    const owner = makeUser({ role: Role.OWNER, assignedBranchIds: [] });
    const branch = await findAccessibleBranch(owner, "branch-tidak-ada");
    expect(branch).toBeNull();
  });
});
