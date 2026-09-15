import { Prisma, PaymentMethod } from "@prisma/client";

/**
 * Validasi & perhitungan kembalian untuk split payment — perhitungan murni
 * (tanpa I/O), diuji langsung tanpa database (lihat
 * tests/unit/pos-payment-calc.test.ts). Dipakai oleh
 * services/pos-transaction-service.ts::createPaidTransaction.
 *
 * Aturan (lihat docs/POS.md untuk penjelasan lengkap):
 * - Metode non-tunai (QRIS/BANK_TRANSFER/DEBIT_CARD/E_WALLET) tidak pernah
 *   menghasilkan kembalian — jumlahnya tidak boleh melebihi totalAmount.
 * - Metode CASH boleh di-tender lebih besar dari sisa tagihan; kelebihannya
 *   menjadi changeAmount.
 * - Total seluruh pembayaran (setelah dikurangi kembalian) harus PERSIS
 *   sama dengan totalAmount.
 */
export type PaymentInput = {
  method: PaymentMethod;
  amount: Prisma.Decimal | string | number;
  reference?: string;
};

export function validatePayments(
  totalAmount: Prisma.Decimal | string | number,
  payments: PaymentInput[],
): { changeAmount: Prisma.Decimal } {
  if (payments.length === 0) {
    throw new Error("Minimal satu metode pembayaran wajib diisi.");
  }

  const total = new Prisma.Decimal(totalAmount.toString());

  let nonCashTotal = new Prisma.Decimal(0);
  let cashTotal = new Prisma.Decimal(0);

  for (const payment of payments) {
    const amount = new Prisma.Decimal(payment.amount.toString());
    if (amount.lessThanOrEqualTo(0)) {
      throw new Error("Jumlah pembayaran harus lebih dari 0.");
    }
    if (payment.method === PaymentMethod.CASH) {
      cashTotal = cashTotal.plus(amount);
    } else {
      nonCashTotal = nonCashTotal.plus(amount);
    }
  }

  if (nonCashTotal.greaterThan(total)) {
    throw new Error(
      "Pembayaran non-tunai tidak boleh melebihi total transaksi (tidak ada kembalian untuk metode non-tunai).",
    );
  }

  const remainingAfterNonCash = total.minus(nonCashTotal);

  if (cashTotal.lessThan(remainingAfterNonCash)) {
    throw new Error("Total pembayaran kurang dari total transaksi.");
  }

  const changeAmount = cashTotal.minus(remainingAfterNonCash);

  return { changeAmount };
}
