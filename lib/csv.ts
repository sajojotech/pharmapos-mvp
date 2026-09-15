/**
 * Serialisasi CSV generik (RFC 4180) untuk export laporan (Fase 10). Nilai
 * angka/uang SENGAJA dikirim mentah (bukan string "Rp 15.000") supaya bisa
 * dihitung ulang di Excel — lihat docs/REPORTS.md poin desain #6.
 */

type CsvCell = string | number;

function escapeCell(value: CsvCell): string {
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(","));
  return lines.join("\r\n");
}

/**
 * Bungkus string CSV menjadi Response siap-download. BOM UTF-8 di depan
 * supaya Excel membaca karakter non-ASCII (nama produk/pasien) dengan
 * benar, bukan hanya aplikasi yang sudah UTF-8-aware.
 */
const UTF8_BOM = "﻿";

export function csvResponse(filename: string, csv: string): Response {
  return new Response(UTF8_BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
