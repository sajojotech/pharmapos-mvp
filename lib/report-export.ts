import { jakartaToday } from "@/lib/timezone";

/**
 * Batas jumlah baris untuk export CSV pada laporan yang REUSE fungsi
 * `listXPaginated` yang sudah ada (stock-by-batch, near-expiry, expired,
 * kartu stok, transfer) — export memanggil fungsi yang sama dengan
 * `page:1, pageSize:EXPORT_MAX_ROWS` supaya CSV berisi SELURUH baris
 * sesuai filter (bukan cuma satu halaman tabel). Batas ini simplifikasi
 * MVP yang disengaja — lihat docs/REPORTS.md poin desain #5.
 */
export const EXPORT_MAX_ROWS = 10000;

/**
 * Resolusi rentang tanggal (YYYY-MM-DD) dengan default hari ini
 * (Asia/Jakarta) bila tidak diisi — dipakai konsisten oleh setiap halaman
 * laporan (dari `searchParams` yang sudah di-`resolve`) & route export-nya
 * (dari `URLSearchParams.get(...)`) supaya filter selalu identik. Terima
 * plain object supaya kedua pemanggil tidak perlu saling menyesuaikan
 * bentuk (Next.js Server Component searchParams BUKAN `URLSearchParams`).
 */
export function parseDateRangeParams(params: {
  dateFrom?: string;
  dateTo?: string;
}): {
  dateFrom: string;
  dateTo: string;
} {
  const today = jakartaToday();
  return {
    dateFrom: params.dateFrom || today,
    dateTo: params.dateTo || today,
  };
}
