import { describe, expect, it } from "vitest";
import { validatePayments } from "@/services/pos-payment-calc";

describe("validatePayments", () => {
  it("menolak bila tidak ada pembayaran sama sekali", () => {
    expect(() => validatePayments(100000, [])).toThrow("Minimal satu metode pembayaran");
  });

  it("menolak jumlah pembayaran <= 0", () => {
    expect(() =>
      validatePayments(100000, [{ method: "CASH", amount: 0 }]),
    ).toThrow("lebih dari 0");
  });

  it("split payment persis sama dengan total tanpa kembalian", () => {
    const result = validatePayments(100000, [
      { method: "CASH", amount: 40000 },
      { method: "QRIS", amount: 60000 },
    ]);
    expect(result.changeAmount.toString()).toBe("0");
  });

  it("cash overpay menghasilkan kembalian", () => {
    const result = validatePayments(85000, [{ method: "CASH", amount: 100000 }]);
    expect(result.changeAmount.toString()).toBe("15000");
  });

  it("cash overpay pada split payment (non-cash pas + cash lebih) menghasilkan kembalian", () => {
    const result = validatePayments(100000, [
      { method: "QRIS", amount: 60000 },
      { method: "CASH", amount: 50000 },
    ]);
    expect(result.changeAmount.toString()).toBe("10000");
  });

  it("menolak pembayaran non-tunai yang melebihi total (tidak ada kembalian non-tunai)", () => {
    expect(() =>
      validatePayments(100000, [{ method: "QRIS", amount: 120000 }]),
    ).toThrow("Pembayaran non-tunai tidak boleh melebihi total transaksi");
  });

  it("menolak total pembayaran kurang dari total transaksi", () => {
    expect(() =>
      validatePayments(100000, [{ method: "CASH", amount: 50000 }]),
    ).toThrow("Total pembayaran kurang dari total transaksi");
  });
});
