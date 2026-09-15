import { describe, expect, it } from "vitest";
import { formatDate, formatRupiah } from "@/lib/format";

describe("formatRupiah", () => {
  it("memformat angka menjadi Rupiah tanpa desimal", () => {
    expect(formatRupiah(1250000)).toBe("Rp 1.250.000");
  });

  it("memformat string numerik menjadi Rupiah", () => {
    expect(formatRupiah("50000")).toBe("Rp 50.000");
  });

  it("mengembalikan Rp 0 untuk nilai yang tidak valid", () => {
    expect(formatRupiah("bukan-angka")).toBe("Rp 0");
  });
});

describe("formatDate", () => {
  it("memformat tanggal dalam bahasa Indonesia (Asia/Jakarta)", () => {
    const date = new Date("2026-09-06T10:00:00.000Z");
    expect(formatDate(date)).toBe("06 September 2026");
  });
});
