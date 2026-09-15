/**
 * Helper timezone untuk laporan (Fase 10). Asia/Jakarta (WIB) punya offset
 * TETAP +07:00 (tidak ada DST) — jadi batas awal/akhir hari bisa dibangun
 * langsung lewat literal offset ISO, tanpa perlu database timezone/library
 * tambahan. Ini simplifikasi MVP yang disengaja & konsisten dengan default
 * `NEXT_PUBLIC_TIME_ZONE` di lib/format.ts (single-tenant, satu timezone).
 */

const JAKARTA_OFFSET = "+07:00";

/** Tanggal hari ini (format YYYY-MM-DD) sebagaimana terlihat di Asia/Jakarta. */
export function jakartaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

/** Awal hari (00:00:00.000) suatu tanggal (YYYY-MM-DD) di Asia/Jakarta, sebagai instant UTC. */
export function jakartaDayStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000${JAKARTA_OFFSET}`);
}

/** Akhir hari (23:59:59.999) suatu tanggal (YYYY-MM-DD) di Asia/Jakarta, sebagai instant UTC. */
export function jakartaDayEnd(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999${JAKARTA_OFFSET}`);
}
