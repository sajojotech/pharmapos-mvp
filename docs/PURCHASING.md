# Purchase Receipt / Penerimaan Barang — Fase 05

Dokumen penerimaan barang dari supplier yang menambah stok per batch+ED
secara atomic. Tidak ada POS, shift kasir, transfer antar-cabang, atau
retur di fase ini — lihat [docs/INVENTORY.md](INVENTORY.md) untuk fondasi
ledger yang dipakai ulang di fase ini.

## Alur dokumen

```
DRAFT --(post)--> POSTED
DRAFT --(cancel)--> CANCELLED
```

- **DRAFT**: header + item bisa dibuat dan diedit bebas (full-replace item
  saat update). **Belum mengubah stok sama sekali.**
- **POSTED**: hasil dari posting yang lolos seluruh validasi (lihat di
  bawah). Menambah/membuat `StockBatch` + `StockMovement` `PURCHASE_RECEIPT`
  per item, **immutable** — tidak ada edit, tidak ada hapus.
- **CANCELLED**: hanya bisa dari DRAFT (dokumen yang tidak jadi diproses).
  Karena DRAFT belum pernah menyentuh stok, membatalkannya tidak
  memerlukan reversal apa pun.
- **MVP ini sengaja TIDAK mendukung pembatalan dokumen yang sudah POSTED.**
  Tidak ada tombol untuk itu di UI. Koreksi atas dokumen yang sudah
  ter-posting (mis. salah input qty/harga) dilakukan lewat **Stock
  Adjustment** (Fase 04) pada fase berjalan ini, dan akan digantikan oleh
  alur **retur ke supplier** yang lebih formal pada fase lanjutan.

## Header & item

| Field header | Keterangan |
| --- | --- |
| `branchId` | Cabang penerima — dikunci ke cabang aktif user saat membuat (sama seperti pola Adjustment/Opname Fase 04), tervalidasi ulang di server. |
| `supplierId` | Wajib, harus aktif saat **posting** (boleh berubah status di antara draft dibuat dan diposting — divalidasi ulang saat itu). |
| `documentNumber` | Auto: `PR-000001`, dst (`lib/document-number.ts`, sama seperti `ADJ-`/`OPN-`). |
| `supplierInvoiceNumber`, `supplierInvoiceDate` | No. & tanggal faktur dari supplier (data eksternal, bukan dokumen internal kita). |
| `receivedDate` | Tanggal barang diterima — dipakai sebagai pembanding validasi ED. |

| Field item | Keterangan |
| --- | --- |
| `unitId` | Satuan **pembelian** (mis. Box), belum tentu base unit produk. Dropdown diisi dari base unit + `ProductUnitConversion` produk tsb. |
| `qty`, `unitCost` | Dalam satuan pembelian tsb (qty box, harga per box). |
| `discountAmount` | Diskon **total per baris** (Rupiah), diterapkan sebelum konversi ke base unit. |
| `batchNumber`, `expiryDate` | **Nullable di schema**, boleh dikosongkan saat DRAFT (mis. sambil menunggu info dari kemasan fisik) — **wajib divalidasi saat posting**, bukan saat create. |

## Kebijakan batch/ED untuk produk obat vs non-obat

**Keputusan: SERAGAM untuk semua produk, obat maupun non-obat — batchNumber
dan expiryDate wajib diisi sebelum posting, tanpa pengecualian kategori.**

Alasan: skema `StockBatch` (Fase 04) sudah mewajibkan `batchNumber` dan
`expiryDate` sebagai kolom **NOT NULL** untuk SEMUA batch, apa pun jenis
produknya — desain itu tidak membedakan obat/non-obat sama sekali. Karena
posting Purchase Receipt selalu berujung membuat/menambah `StockBatch`,
tidak ada jalan untuk membuat kebijakan "opsional untuk non-obat" tanpa
melanggar constraint yang sudah ada di fase sebelumnya. Kebijakan seragam
ini juga sudah sejalan dengan rekomendasi spesifikasi produk awal ("untuk
non-obat *disarankan* tetap wajib") — MVP ini mengambil opsi yang
disarankan itu sebagai satu-satunya opsi, demi kesederhanaan dan
konsistensi lintas kategori (tidak perlu field `isDrug` baru di `Product`
yang tidak diminta fase mana pun).

## Konversi satuan & diskon saat posting

Untuk tiap item, saat **posting** (bukan saat create):

1. `lineSubtotal = qty × unitCost`
2. `lineTotal = lineSubtotal − discountAmount` (ditolak bila `discountAmount > lineSubtotal`)
3. `conversionFactor` = 1 bila `unitId` sudah base unit produk; kalau
   tidak, diambil dari `ProductUnitConversion` (ditolak bila produk belum
   punya konversi ke satuan tsb).
4. `baseQty = qty × conversionFactor`
5. `baseUnitCost = lineTotal / baseQty`

`baseQty` & `baseUnitCost` inilah yang dikirim ke primitif
`receiveStockToBatch()` (Fase 04) — StockBatch selalu dalam base unit,
konsisten dengan keputusan Fase 01. Diverifikasi manual: beli 20 Strip
Paracetamol (1 Strip = 10 Tablet) @ Rp4.800/strip, diskon Rp1.000 total →
menghasilkan batch 200 Tablet dengan `unitCost` Rp475/Tablet
(`(20×4800−1000)/200`).

## Validasi saat posting (semua di satu `$transaction`)

Urutan pengecekan per item (lihat `services/purchase-receipt-service.ts::postReceipt`):

1. Dokumen harus `DRAFT` dan berada di cabang yang diizinkan pemanggil.
2. Supplier harus aktif.
3. Cabang harus punya warehouse default yang aktif.
4. Per item: produk harus ada & aktif; qty {'>'} 0; `batchNumber`/`expiryDate`
   wajib terisi; `expiryDate` harus **lebih besar** dari `receivedDate`
   dokumen; `unitCost`/`discountAmount` tidak boleh negatif; `discountAmount`
   tidak boleh melebihi subtotal baris; satuan pembelian harus punya
   konversi valid ke base unit (atau memang base unit).
5. Bila SEMUA item lolos, baru `receiveStockToBatch()` dipanggil per item
   (masing-masing membuat/menambah `StockBatch` + `StockMovement`
   `PURCHASE_RECEIPT`, referensi ke `PurchaseReceipt.id`).
6. Status dokumen → `POSTED` + `postedAt`/`postedById`, dan `AuditLog`
   ditulis — **dalam transaction yang sama** (`tx`, bukan client `prisma`
   terpisah, mengikuti perbaikan pola Fase 04).

**Kegagalan pada item mana pun (mis. item ke-2 dari 3 tidak valid) membuat
SELURUH transaction rollback** — item ke-1 yang valid TIDAK menghasilkan
batch/movement sama sekali, dan dokumen tetap `DRAFT`. Diverifikasi lewat
test khusus (lihat bagian Testing).

## RBAC & isolasi cabang

Seluruh fitur (lihat, buat, edit, post, batalkan) digerbangi permission
**`purchase.manage`** — matrix yang sama dari Fase 02, tidak berubah
(OWNER, CENTRAL_ADMIN, WAREHOUSE_STAFF). Tidak ada permission
`purchase.read` terpisah pada matrix saat ini, sehingga role lain (Branch
Manager, Pharmacist, Cashier, Finance Auditor) sama sekali tidak melihat
menu/halaman ini — keputusan ini konsisten dengan granularitas permission
yang sudah ditetapkan sejak Fase 02, bukan perubahan baru.

Pola isolasi cabang sama persis dengan Stock Adjustment/Opname (Fase 04):
`getAllowedBranchIds()` membatasi query list/get, dan `postReceipt`/
`cancelDraftReceipt` memvalidasi ulang bahwa `branchId` dokumen ada dalam
cakupan akses pemanggil SEBELUM mengubah apa pun.

## Audit log

Ditulis untuk **create, update draft, post, dan cancel draft** (persis
sesuai instruksi fase ini) lewat `services/audit-service.ts::recordAudit()`,
memakai `tx` yang sama dengan mutasi terkait untuk `post`/`cancel` (atomic).

## Hasil test

| Gate | Hasil |
| --- | --- |
| Migration | ✅ `20260906133844_phase5_purchase_receipt` diterapkan bersih |
| `npm run lint` | ✅ 0 error |
| `npm run typecheck` | ✅ |
| `npm run test` | ✅ **129/129** (10 test baru di `tests/integration/purchase-receipt.test.ts`) |
| `npm run build` | ✅ 28 route |
| QA manual browser | ✅ create→post mengonversi Strip→Tablet & diskon dengan benar (200 unit @ Rp475), saldo bertambah tepat, kartu stok mencatat `PURCHASE_RECEIPT`, tombol Post/Edit/Cancel hilang setelah POSTED, Cashier (tanpa `purchase.manage`) tidak melihat menu & ditolak akses URL langsung |

Test baru mencakup seluruh kriteria wajib fase ini:
- Draft dibuat tanpa mengubah stok.
- Posting menambah stok batch & membuat `StockMovement PURCHASE_RECEIPT`
  dengan benar (termasuk kasus konversi satuan & diskon).
- Tidak dapat post dua kali (dokumen ke-2 kalinya ditolak, tetap POSTED
  dari post pertama).
- ED ≤ tanggal penerimaan ditolak; qty 0 ditolak.
- Dokumen POSTED menolak `updateDraftReceipt`/`cancelDraftReceipt`.
- User di luar akses cabang tidak bisa melihat (`getReceiptById` → `null`)
  maupun memposting (`postReceipt` → error eksplisit) dokumen cabang lain.
- **Rollback penuh**: satu item dengan produk nonaktif menggagalkan
  seluruh posting; item lain yang valid pada dokumen yang sama TIDAK
  meninggalkan batch/movement parsial.

## Catatan penting lain

- **Vitest dikonfigurasi `fileParallelism: false`** (lihat `vitest.config.ts`)
  sejak fase ini — ditemukan saat menjalankan suite penuh bahwa file test
  integrasi yang berjalan paralel (berbagi satu database dev yang sama,
  tanpa isolasi transaction-per-test) bisa saling mengganggu (data
  sementara satu file "terlihat" oleh assertion broad di file lain).
  Menjalankan file secara sekuensial menghilangkan seluruh kelas race
  condition ini dengan trade-off waktu total sedikit lebih lama.

## Contoh data untuk pengujian fase POS berikutnya

Setelah QA manual di atas, database dev memiliki (selain seed Fase 01-04):

- **Purchase Receipt PR-000001** (POSTED), cabang PUSAT, supplier "PT
  Anugrah Pharmindo Lestari", 1 item: Paracetamol 500mg 20 Strip @ Rp4.800
  (diskon Rp1.000).
- **StockBatch baru** `QA-PR-BATCH-001` untuk Paracetamol 500mg di PUSAT:
  200 Tablet, `unitCost` Rp475, ED 31 Desember 2027, status AVAILABLE.
- Saldo Paracetamol 500mg di PUSAT sekarang **650** (450 sisa dari
  adjustment Fase 04 + 200 dari penerimaan ini) — tersebar di **dua batch**
  dengan ED berbeda (`OB-PST-0001` ED 11 Okt 2027 qty 450, dan
  `QA-PR-BATCH-001` ED 31 Des 2027 qty 200) — kondisi yang tepat untuk
  menguji **alokasi FEFO** pada fase POS berikutnya (batch dengan ED lebih
  dekat harus dialokasikan lebih dulu).
