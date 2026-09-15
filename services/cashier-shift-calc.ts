import { Prisma } from "@prisma/client";

/**
 * Perhitungan murni (tanpa I/O) seputar shift kasir — dipisah dari
 * services/cashier-shift-service.ts (yang mengakses Prisma) supaya bisa
 * diuji langsung dengan Vitest tanpa database, mengikuti pola pemisahan
 * yang sama dengan lib/rbac-core.ts vs lib/rbac.ts.
 */

export type ExpectedCashInput = {
  openingCash: Prisma.Decimal | string | number;
  /** Total tunai bersih dari penjualan PAID di shift ini (tender CASH
   * dikurangi kembalian yang diberikan — lihat services/pos-payment-calc.ts).
   * Selalu >= 0 secara bisnis, dihitung oleh pemanggil dari data Payment. */
  netCashSales: Prisma.Decimal | string | number;
  cashIn: Prisma.Decimal | string | number;
  cashOut: Prisma.Decimal | string | number;
  /**
   * Selalu 0 pada Fase 06 (belum ada retur/refund) — parameter ini
   * disiapkan supaya rumus tidak perlu diubah saat retur ditambahkan di
   * fase lanjutan. Lihat docs/POS.md.
   */
  cashRefunds?: Prisma.Decimal | string | number;
};

/**
 * expectedCash = openingCash + netCashSales + cashIn - cashRefunds - cashOut
 */
export function computeExpectedCash(input: ExpectedCashInput): Prisma.Decimal {
  const opening = new Prisma.Decimal(input.openingCash.toString());
  const netSales = new Prisma.Decimal(input.netCashSales.toString());
  const cashIn = new Prisma.Decimal(input.cashIn.toString());
  const cashOut = new Prisma.Decimal(input.cashOut.toString());
  const refunds = new Prisma.Decimal((input.cashRefunds ?? 0).toString());

  return opening.plus(netSales).plus(cashIn).minus(refunds).minus(cashOut);
}

export function computeVariance(
  actualCash: Prisma.Decimal | string | number,
  expectedCash: Prisma.Decimal | string | number,
): Prisma.Decimal {
  return new Prisma.Decimal(actualCash.toString()).minus(
    new Prisma.Decimal(expectedCash.toString()),
  );
}

/**
 * Tentukan status akhir shift setelah ditutup: PENDING_APPROVAL bila
 * selisih absolut melebihi threshold, CLOSED bila tidak (termasuk bila
 * threshold tidak dikonfigurasi sama sekali — dianggap "selalu lolos",
 * bukan "selalu perlu approval", supaya perusahaan yang belum mengisi
 * AppSetting tidak tiba-tiba mem-block penutupan shift kasirnya).
 */
export function decideShiftStatus(
  variance: Prisma.Decimal | string | number,
  varianceThreshold: Prisma.Decimal | string | number | null | undefined,
): "PENDING_APPROVAL" | "CLOSED" {
  if (varianceThreshold === null || varianceThreshold === undefined) return "CLOSED";

  const absVariance = new Prisma.Decimal(variance.toString()).abs();
  const threshold = new Prisma.Decimal(varianceThreshold.toString());

  return absVariance.greaterThan(threshold) ? "PENDING_APPROVAL" : "CLOSED";
}
