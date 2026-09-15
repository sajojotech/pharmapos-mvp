import { describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { hasPermission, isGlobalBranchRole } from "@/lib/permissions";

describe("permission matrix", () => {
  it("CASHIER tidak memiliki permission user.manage", () => {
    expect(hasPermission(Role.CASHIER, "user.manage")).toBe(false);
  });

  it("CASHIER memiliki permission pos.sell", () => {
    expect(hasPermission(Role.CASHIER, "pos.sell")).toBe(true);
  });

  it("OWNER memiliki seluruh permission inti", () => {
    expect(hasPermission(Role.OWNER, "user.manage")).toBe(true);
    expect(hasPermission(Role.OWNER, "pos.void")).toBe(true);
    expect(hasPermission(Role.OWNER, "audit.read")).toBe(true);
  });

  it("FINANCE_AUDITOR hanya memiliki permission baca (read-only)", () => {
    expect(hasPermission(Role.FINANCE_AUDITOR, "report.read.all")).toBe(true);
    expect(hasPermission(Role.FINANCE_AUDITOR, "audit.read")).toBe(true);
    expect(hasPermission(Role.FINANCE_AUDITOR, "pos.sell")).toBe(false);
    expect(hasPermission(Role.FINANCE_AUDITOR, "master.manage")).toBe(false);
  });

  it("PHARMACIST memiliki prescription.review, CASHIER tidak", () => {
    expect(hasPermission(Role.PHARMACIST, "prescription.review")).toBe(true);
    expect(hasPermission(Role.CASHIER, "prescription.review")).toBe(false);
  });
});

describe("report permission matrix (Fase 10)", () => {
  it("CASHIER & WAREHOUSE_STAFF tidak bisa membuka laporan sama sekali", () => {
    for (const role of [Role.CASHIER, Role.WAREHOUSE_STAFF]) {
      expect(hasPermission(role, "report.read.branch")).toBe(false);
      expect(hasPermission(role, "report.read.all")).toBe(false);
    }
  });

  it("BRANCH_MANAGER & PHARMACIST punya report.read.branch TAPI BUKAN report.read.all (tidak bisa buka laporan konsolidasi)", () => {
    for (const role of [Role.BRANCH_MANAGER, Role.PHARMACIST]) {
      expect(hasPermission(role, "report.read.branch")).toBe(true);
      expect(hasPermission(role, "report.read.all")).toBe(false);
    }
  });

  it("OWNER, CENTRAL_ADMIN, FINANCE_AUDITOR punya report.read.branch DAN report.read.all", () => {
    for (const role of [Role.OWNER, Role.CENTRAL_ADMIN, Role.FINANCE_AUDITOR]) {
      expect(hasPermission(role, "report.read.branch")).toBe(true);
      expect(hasPermission(role, "report.read.all")).toBe(true);
    }
  });
});

describe("isGlobalBranchRole", () => {
  it("OWNER, CENTRAL_ADMIN, FINANCE_AUDITOR bersifat lintas-cabang", () => {
    expect(isGlobalBranchRole(Role.OWNER)).toBe(true);
    expect(isGlobalBranchRole(Role.CENTRAL_ADMIN)).toBe(true);
    expect(isGlobalBranchRole(Role.FINANCE_AUDITOR)).toBe(true);
  });

  it("BRANCH_MANAGER, PHARMACIST, CASHIER, WAREHOUSE_STAFF bersifat per-cabang", () => {
    expect(isGlobalBranchRole(Role.BRANCH_MANAGER)).toBe(false);
    expect(isGlobalBranchRole(Role.PHARMACIST)).toBe(false);
    expect(isGlobalBranchRole(Role.CASHIER)).toBe(false);
    expect(isGlobalBranchRole(Role.WAREHOUSE_STAFF)).toBe(false);
  });
});
