import { isUniqueConstraintError } from "@/lib/prisma-errors";

/**
 * Generate nomor dokumen sekuensial sederhana (mis. "ADJ-000123") dan retry
 * otomatis bila terjadi tabrakan (unique constraint) akibat concurrent
 * create — cukup untuk skala dokumen admin (adjustment/opname) yang jarang
 * dibuat bersamaan dalam skala besar. `countExisting` menghitung jumlah
 * dokumen dgn prefix yang sama pada company tsb; `attemptCreate` menerima
 * nomor kandidat dan mengembalikan hasil create (harus melempar error
 * unique constraint bila nomor sudah dipakai agar retry berjalan).
 */
export async function createWithSequentialNumber<T>(params: {
  prefix: string;
  countExisting: () => Promise<number>;
  attemptCreate: (documentNumber: string) => Promise<T>;
  maxAttempts?: number;
}): Promise<T> {
  const maxAttempts = params.maxAttempts ?? 5;
  let nextSeq = (await params.countExisting()) + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const documentNumber = `${params.prefix}-${String(nextSeq).padStart(6, "0")}`;
    try {
      return await params.attemptCreate(documentNumber);
    } catch (error) {
      if (isUniqueConstraintError(error) && attempt < maxAttempts - 1) {
        nextSeq += 1;
        continue;
      }
      throw error;
    }
  }

  throw new Error("Gagal membuat nomor dokumen setelah beberapa percobaan.");
}
