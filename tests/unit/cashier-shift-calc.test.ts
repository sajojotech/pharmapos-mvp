import { describe, expect, it } from "vitest";
import { computeExpectedCash, computeVariance, decideShiftStatus } from "@/services/cashier-shift-calc";

describe("computeExpectedCash", () => {
  it("menjumlahkan opening + netCashSales + cashIn - cashOut", () => {
    const result = computeExpectedCash({
      openingCash: 100000,
      netCashSales: 500000,
      cashIn: 50000,
      cashOut: 20000,
    });
    expect(result.toString()).toBe("630000");
  });

  it("mengabaikan cashRefunds bila tidak diisi (default 0)", () => {
    const result = computeExpectedCash({
      openingCash: 100000,
      netCashSales: 0,
      cashIn: 0,
      cashOut: 0,
    });
    expect(result.toString()).toBe("100000");
  });

  it("mengurangi cashRefunds bila diisi", () => {
    const result = computeExpectedCash({
      openingCash: 100000,
      netCashSales: 500000,
      cashIn: 0,
      cashOut: 0,
      cashRefunds: 30000,
    });
    expect(result.toString()).toBe("570000");
  });
});

describe("computeVariance", () => {
  it("actualCash - expectedCash", () => {
    expect(computeVariance(100000, 95000).toString()).toBe("5000");
    expect(computeVariance(90000, 95000).toString()).toBe("-5000");
    expect(computeVariance(95000, 95000).toString()).toBe("0");
  });
});

describe("decideShiftStatus", () => {
  it("CLOSED bila threshold tidak dikonfigurasi", () => {
    expect(decideShiftStatus(999999, null)).toBe("CLOSED");
    expect(decideShiftStatus(999999, undefined)).toBe("CLOSED");
  });

  it("CLOSED bila |variance| <= threshold (batas persis)", () => {
    expect(decideShiftStatus(10000, 10000)).toBe("CLOSED");
    expect(decideShiftStatus(-10000, 10000)).toBe("CLOSED");
    expect(decideShiftStatus(0, 10000)).toBe("CLOSED");
  });

  it("PENDING_APPROVAL bila |variance| melebihi threshold", () => {
    expect(decideShiftStatus(10000.01, 10000)).toBe("PENDING_APPROVAL");
    expect(decideShiftStatus(-10000.01, 10000)).toBe("PENDING_APPROVAL");
  });
});
