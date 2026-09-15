import { describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { hasPermission } from "@/lib/permissions";

const NON_PRIVILEGED_ROLES = [
  Role.BRANCH_MANAGER,
  Role.PHARMACIST,
  Role.CASHIER,
  Role.WAREHOUSE_STAFF,
  Role.FINANCE_AUDITOR,
];

describe("master.manage — hanya Owner & Central Admin", () => {
  it("OWNER dan CENTRAL_ADMIN memiliki master.manage", () => {
    expect(hasPermission(Role.OWNER, "master.manage")).toBe(true);
    expect(hasPermission(Role.CENTRAL_ADMIN, "master.manage")).toBe(true);
  });

  it.each(NON_PRIVILEGED_ROLES)(
    "%s TIDAK memiliki master.manage (hanya read)",
    (role) => {
      expect(hasPermission(role, "master.manage")).toBe(false);
      expect(hasPermission(role, "master.read")).toBe(true);
    },
  );
});

describe("user.manage — hanya Owner & Central Admin", () => {
  it("OWNER dan CENTRAL_ADMIN memiliki user.manage", () => {
    expect(hasPermission(Role.OWNER, "user.manage")).toBe(true);
    expect(hasPermission(Role.CENTRAL_ADMIN, "user.manage")).toBe(true);
  });

  it.each(NON_PRIVILEGED_ROLES)("%s TIDAK memiliki user.manage", (role) => {
    expect(hasPermission(role, "user.manage")).toBe(false);
  });
});
