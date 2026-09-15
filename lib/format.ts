const TIME_ZONE = process.env.NEXT_PUBLIC_TIME_ZONE || "Asia/Jakarta";

const rupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const timeFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * Format angka/Decimal-like value menjadi format Rupiah, mis. "Rp 15.000".
 * Menerima number atau string agar aman dipakai dengan Prisma.Decimal (via .toString()).
 */
export function formatRupiah(value: number | string): string {
  const numeric = typeof value === "string" ? Number(value) : value;

  if (Number.isNaN(numeric)) {
    return normalizeSpaces(rupiahFormatter.format(0));
  }

  return normalizeSpaces(rupiahFormatter.format(numeric));
}

/**
 * `Intl.NumberFormat("id-ID", { style: "currency" })` menyisipkan spasi
 * non-breaking (U+00A0) antara "Rp" dan angka. Ganti dengan spasi biasa agar
 * konsisten saat dirender/di-copy dan mudah dibandingkan pada test.
 */
function normalizeSpaces(value: string): string {
  return value.replace(/ /g, " ");
}

/**
 * Format tanggal (tanpa jam) dalam zona waktu Asia/Jakarta, mis. "06 September 2026".
 */
export function formatDate(value: Date | string): string {
  return dateFormatter.format(new Date(value));
}

/**
 * Format tanggal + jam dalam zona waktu Asia/Jakarta, mis. "06 September 2026 21:45".
 */
export function formatDateTime(value: Date | string): string {
  return dateTimeFormatter.format(new Date(value));
}

/**
 * Format jam saja dalam zona waktu Asia/Jakarta, mis. "21:45".
 */
export function formatTime(value: Date | string): string {
  return timeFormatter.format(new Date(value));
}

const qtyFormatter = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

/**
 * Format kuantitas (Prisma.Decimal via .toString()) ala Indonesia, mis.
 * "1.234" atau "12,5". Trailing zero desimal disembunyikan (Decimal
 * kuantitas kita menyimpan hingga 3 digit presisi tapi kebanyakan bulat).
 */
export function formatDecimalQty(value: number | string): string {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(numeric)) return "0";
  return normalizeSpaces(qtyFormatter.format(numeric));
}
