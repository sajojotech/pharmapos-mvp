import { describe, expect, it } from "vitest";
import { toCsv, csvResponse } from "@/lib/csv";

describe("toCsv", () => {
  it("menghasilkan header + baris dipisah CRLF", () => {
    const csv = toCsv(["Nama", "Qty"], [["Paracetamol", 10]]);
    expect(csv).toBe("Nama,Qty\r\nParacetamol,10");
  });

  it("membungkus nilai yang mengandung koma dengan tanda kutip", () => {
    const csv = toCsv(["Alasan"], [["Rusak, dikembalikan pelanggan"]]);
    expect(csv).toBe('Alasan\r\n"Rusak, dikembalikan pelanggan"');
  });

  it("meng-escape tanda kutip ganda di dalam nilai", () => {
    const csv = toCsv(["Catatan"], [['Butuh "verifikasi" ulang']]);
    expect(csv).toBe('Catatan\r\n"Butuh ""verifikasi"" ulang"');
  });

  it("membungkus nilai yang mengandung newline dengan tanda kutip", () => {
    const csv = toCsv(["Catatan"], [["Baris satu\nBaris dua"]]);
    expect(csv).toBe('Catatan\r\n"Baris satu\nBaris dua"');
  });

  it("tidak membungkus nilai polos", () => {
    const csv = toCsv(["A", "B"], [["OBT-0001", 500]]);
    expect(csv).toBe("A,B\r\nOBT-0001,500");
  });
});

describe("csvResponse", () => {
  it("menyertakan BOM UTF-8, content-type CSV, dan Content-Disposition attachment", async () => {
    const response = csvResponse("laporan.csv", "A,B\r\n1,2");
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="laporan.csv"');

    // `.text()` men-decode & MEMBUANG BOM (perilaku standar TextDecoder) —
    // periksa byte mentah untuk membuktikan BOM UTF-8 (EF BB BF) sungguh
    // ada di body, karena itulah yang dibaca Excel/aplikasi lain.
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

    const body = await new Response(bytes.slice(3)).text();
    expect(body).toBe("A,B\r\n1,2");
  });
});
