import { describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { can, hasBranchAccess, resolveActiveBranchId } from "@/lib/rbac-core";
import type { SessionUser } from "@/lib/rbac-core";

const BRANCH_PUSAT = "branch-pusat";
const BRANCH_BARAT = "branch-barat";
const BRANCH_TIMUR = "branch-timur";

function makeUser(overrides: Partial<SessionUser>): SessionUser {
  return {
    id: "user-1",
    email: "test@pharmapos.local",
    name: "Test User",
    role: Role.CASHIER,
    companyId: "company-1",
    assignedBranchIds: [],
    ...overrides,
  };
}

describe("hasBranchAccess", () => {
  it("role global (OWNER) selalu punya akses ke cabang mana pun", () => {
    const owner = makeUser({ role: Role.OWNER, assignedBranchIds: [] });
    expect(hasBranchAccess(owner, BRANCH_BARAT)).toBe(true);
  });

  it("role per-cabang (CASHIER) hanya punya akses ke cabang yang ditugaskan", () => {
    const cashier = makeUser({
      role: Role.CASHIER,
      assignedBranchIds: [BRANCH_PUSAT],
    });
    expect(hasBranchAccess(cashier, BRANCH_PUSAT)).toBe(true);
    expect(hasBranchAccess(cashier, BRANCH_BARAT)).toBe(false);
  });
});

describe("can", () => {
  it("menolak permission yang tidak dimiliki role, terlepas dari branchId", () => {
    const cashier = makeUser({
      role: Role.CASHIER,
      assignedBranchIds: [BRANCH_PUSAT],
    });
    expect(can(cashier, "user.manage", BRANCH_PUSAT)).toBe(false);
  });

  it("mengizinkan permission yang dimiliki role untuk cabang yang ditugaskan", () => {
    const cashier = makeUser({
      role: Role.CASHIER,
      assignedBranchIds: [BRANCH_PUSAT],
    });
    expect(can(cashier, "pos.sell", BRANCH_PUSAT)).toBe(true);
  });

  it("menolak permission untuk cabang di luar assignment, walau permission dimiliki", () => {
    const cashier = makeUser({
      role: Role.CASHIER,
      assignedBranchIds: [BRANCH_PUSAT],
    });
    expect(can(cashier, "pos.sell", BRANCH_BARAT)).toBe(false);
  });

  it("role global lolos cek branchId apa pun selama permission dimiliki", () => {
    const owner = makeUser({ role: Role.OWNER, assignedBranchIds: [] });
    expect(can(owner, "pos.sell", BRANCH_BARAT)).toBe(true);
  });

  it("branchId opsional — tanpa branchId hanya cek permission", () => {
    const cashier = makeUser({ role: Role.CASHIER, assignedBranchIds: [] });
    expect(can(cashier, "pos.sell")).toBe(true);
  });
});

describe("resolveActiveBranchId", () => {
  it("user per-cabang dengan satu assignment otomatis memakai cabang itu", () => {
    const result = resolveActiveBranchId({
      role: Role.CASHIER,
      assignedBranchIds: [BRANCH_PUSAT],
      availableBranchIds: [],
      cookieBranchId: null,
    });
    expect(result).toBe(BRANCH_PUSAT);
  });

  it("mengabaikan cookie yang menunjuk cabang di luar assignment", () => {
    const result = resolveActiveBranchId({
      role: Role.CASHIER,
      assignedBranchIds: [BRANCH_PUSAT],
      availableBranchIds: [],
      cookieBranchId: BRANCH_BARAT,
    });
    expect(result).toBe(BRANCH_PUSAT);
  });

  it("role global memakai cookie bila valid di antara cabang yang tersedia", () => {
    const result = resolveActiveBranchId({
      role: Role.OWNER,
      assignedBranchIds: [],
      availableBranchIds: [BRANCH_PUSAT, BRANCH_BARAT, BRANCH_TIMUR],
      cookieBranchId: BRANCH_TIMUR,
    });
    expect(result).toBe(BRANCH_TIMUR);
  });

  it("role global tanpa cookie valid jatuh ke cabang pertama yang tersedia", () => {
    const result = resolveActiveBranchId({
      role: Role.OWNER,
      assignedBranchIds: [],
      availableBranchIds: [BRANCH_PUSAT, BRANCH_BARAT],
      cookieBranchId: null,
    });
    expect(result).toBe(BRANCH_PUSAT);
  });

  it("user per-cabang tanpa assignment sama sekali menghasilkan null", () => {
    const result = resolveActiveBranchId({
      role: Role.CASHIER,
      assignedBranchIds: [],
      availableBranchIds: [],
      cookieBranchId: null,
    });
    expect(result).toBeNull();
  });
});
