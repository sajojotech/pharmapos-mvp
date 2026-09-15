# Inventori: Batch, ED, Saldo Stok, dan Ledger — Fase 04

Fondasi stok yang traceable di level cabang+batch. Tidak ada UI POS/payment/shift/transfer
di fase ini — lihat [docs/MASTER_DATA.md](MASTER_DATA.md) dan [docs/AUTH.md](AUTH.md)
untuk fase-fase sebelumnya.

## Perubahan schema & migration

Migration: `prisma/migrations/20260906125120_phase4_inventory_core` (model baru) dan
`20260906115911_add_product_branch_price_effective_date` (Fase 03, sudah ada sebelumnya).

Model baru:

| Model | Ringkasan |
| --- | --- |
| `StockBatch` | Batch/lot fisik: cabang + warehouse + produk + no. batch + ED + qtyOnHand + unitCost + status. |
| `StockMovement` | Ledger append-only. Setiap perubahan `qtyOnHand` WAJIB punya tepat satu baris di sini. |
| `StockAdjustment` / `StockAdjustmentItem` | Dokumen koreksi manual (DRAFT → POSTED), item mengacu batch yang **sudah ada**. |
| `StockOpname` / `StockOpnameItem` | Dokumen rekonsiliasi hitung fisik vs sistem (DRAFT → POSTED). |

Enum baru: `StockBatchStatus` (AVAILABLE/QUARANTINED/BLOCKED/EXPIRED/DAMAGED),
`StockMovementType` (13 nilai sesuai spesifikasi), `StockDocumentStatus`
(DRAFT/POSTED/CANCELLED), `AdjustmentDirection` (IN/OUT).

Constraint unik penting: `StockBatch(branchId, productId, batchNumber)` — satu
nomor batch = satu baris per cabang+produk (penerimaan berikutnya dengan
nomor sama **menambah** batch yang sama, bukan duplikat — lihat
`receiveStockToBatch`). `StockAdjustment`/`StockOpname` masing-masing
`(companyId, documentNumber)` unik, dinomori otomatis (`ADJ-000001`,
`OPN-000001`) lewat `lib/document-number.ts` dengan retry saat tabrakan.

**Keputusan desain:** `StockBatch.warehouseId` **wajib** (bukan opsional) —
satu batch fisik selalu berada di satu lokasi penyimpanan tertentu; MVP ini
hanya punya satu warehouse default per cabang sehingga keputusan ini tidak
menambah beban input. `StockMovement.warehouseId` **opsional** (nullable,
`onDelete: SetNull`) — ledger tetap valid secara historis meski suatu saat
warehouse dihapus/direstruktur.

## Aturan saldo batch & ledger

1. **`qtyOnHand` adalah saldo, bukan dihitung ulang dari ledger tiap saat.**
   Setiap mutasi meng-update `StockBatch.qtyOnHand` DAN menulis satu baris
   `StockMovement` (dengan `balanceAfter` = saldo setelah mutasi) dalam
   **satu database transaction** — tidak ada jalur kode yang mengubah salah
   satu tanpa yang lain (lihat `services/stock-ledger.ts`).
2. **Stok tidak boleh minus.** Ditegakkan di level database lewat klausa
   `WHERE qtyOnHand >= qty` pada statement pengurangan (lihat bagian
   concurrency di bawah) — bukan sekadar validasi di kode aplikasi yang bisa
   punya celah balapan.
3. **Output normal (POS_SALE, TRANSFER_OUT, STOCK_ADJUSTMENT_OUT,
   STOCK_OPNAME, dst.) hanya boleh dari batch berstatus `AVAILABLE` DAN
   belum lewat ED.** Dicek terhadap `expiryDate` secara langsung (bukan
   hanya field `status`) supaya tetap benar walau job sinkronisasi status
   belum sempat berjalan.
4. **Pengecualian tunggal: `EXPIRED_WRITE_OFF` dan `DAMAGED_WRITE_OFF`.**
   Keduanya *harus* bisa mengeluarkan stok justru dari batch yang
   bermasalah (itu tujuannya) — `EXPIRED_WRITE_OFF` mensyaratkan batch
   berstatus `EXPIRED` atau memang sudah lewat ED; `DAMAGED_WRITE_OFF`
   mensyaratkan status `DAMAGED`. Tanpa pengecualian eksplisit ini, kedua
   movement type tersebut di enum tidak akan pernah bisa dieksekusi.
5. **Status batch disinkronkan berdasarkan ED di server, bukan UI.**
   `syncExpiredBatchStatus(companyId)` — dipanggil di awal setiap fungsi
   `list...` inventori (stock balance, batches, dst) — mengubah batch
   `AVAILABLE` yang `expiryDate < now()` menjadi `EXPIRED` lewat
   `updateMany`. Diverifikasi manual: batch seed `OB-PST-0002-EXPIRED`
   (ED -10 hari) otomatis tampil berstatus "Kedaluwarsa" pertama kali
   `/inventory/batches` dibuka, tanpa job terjadwal terpisah.
6. **Dokumen Adjustment/Opname POSTED bersifat immutable.** `postAdjustment`/
   `postOpname` menolak dokumen yang statusnya bukan `DRAFT`; tidak ada
   endpoint untuk mengedit dokumen POSTED — koreksi lebih lanjut harus lewat
   dokumen baru.
7. **Setiap item Adjustment/Opname yang diposting menghasilkan tepat satu
   `StockMovement`** (kecuali opname dengan selisih nol — item tsb memang
   sengaja dilewati, tidak menghasilkan movement kosong). Posting seluruh
   dokumen (semua item + audit log) berjalan dalam **satu transaction**:
   gagal di tengah berarti seluruhnya rollback (all-or-nothing), dokumen
   tetap DRAFT, dan tidak ada stok yang berubah sebagian.

## Pendekatan race condition / concurrency

**Masalah:** dua request bersamaan (mis. dua kasir menjual dari batch yang
sama secara nyaris bersamaan) yang masing-masing melakukan pola
baca-lalu-tulis ("baca qtyOnHand, validasi cukup, lalu tulis qtyOnHand baru")
rentan *lost update* — kedua transaction bisa membaca saldo yang sama
sebelum salah satu menulis, sehingga validasi "cukup/tidak" keduanya
berdasarkan data basi dan stok bisa berakhir minus.

**Solusi yang dipakai:** update **atomic tunggal** langsung di database,
bukan baca-lalu-tulis, lewat `tx.$queryRaw` (lihat
`services/stock-ledger.ts`):

```sql
UPDATE "StockBatch"
SET "qtyOnHand" = "qtyOnHand" - $qty, "updatedAt" = now()
WHERE id = $batchId AND "qtyOnHand" >= $qty
RETURNING "qtyOnHand"
```

PostgreSQL mengeksekusi `UPDATE` dengan mengambil row-lock pada baris yang
match sebelum menuliskan nilai baru. Bila dua transaction bersamaan mencoba
meng-update baris yang sama, transaction kedua **menunggu** (blocked oleh
lock) sampai transaction pertama commit/rollback, baru kemudian klausa
`WHERE qtyOnHand >= qty` dievaluasi ulang **terhadap nilai yang sudah
ter-update oleh transaction pertama** — bukan nilai basi yang dibaca di
awal. Ini setara dengan operasi "compare-and-swap" atomic di level database:
tidak mungkin dua pengurangan sama-sama lolos validasi padahal gabungan
keduanya melebihi saldo. Baris affected = 0 berarti gagal (saldo tidak
cukup PADA SAAT eksekusi, bukan pada saat dibaca aplikasi) — pemanggil
menerjemahkan ini menjadi error yang jelas (lihat `decrementBatchQtyIfSufficient`).

Pola yang sama dipakai untuk penambahan (`incrementBatchQty`) demi
konsistensi, walau race condition penambahan secara bisnis tidak
berbahaya (tidak ada batas atas) — tetap memakai atomic update supaya
tidak ada baris kode yang membaca-lalu-menulis `qtyOnHand` di mana pun
dalam service ini.

**Kenapa bukan `SERIALIZABLE` isolation atau `SELECT ... FOR UPDATE`
eksplisit?** Pola atomic-update-tunggal di atas mencapai jaminan yang sama
(tidak ada lost update, tidak ada saldo minus) dengan kompleksitas jauh
lebih rendah — tidak perlu retry loop untuk serialization failure, dan
tetap bekerja di bawah isolation level default PostgreSQL (`READ
COMMITTED`). Trade-off: pola ini secara spesifik menyelesaikan race
condition pada **satu baris** (`qtyOnHand` satu batch); operasi multi-batch
(mis. posting adjustment dengan banyak item) tetap dilindungi via
`prisma.$transaction` di level dokumen (atomicity all-or-nothing), tapi
tidak memberi jaminan serializability lintas-transaction untuk skenario
yang lebih kompleks (di luar cakupan MVP ini).

## RBAC & isolasi cabang

- Baca (`/inventory/stock`, `/batches`, `/movements`, dan daftar
  adjustment/opname): permission `inventory.read` (semua role kecuali
  murni-tidak-operasional — lihat matrix Fase 02, tidak berubah).
- Buat & posting Adjustment/Opname: permission `inventory.adjust` (OWNER,
  BRANCH_MANAGER, WAREHOUSE_STAFF — matrix Fase 02, tidak berubah).
- **Setiap** service query inventori menerima `allowedBranchIds` (dihitung
  server-side lewat `getAllowedBranchIds()`, berdasar role+assignment sesi
  user — TIDAK PERNAH dipercaya dari input client) dan membatasi
  `WHERE branchId IN (...)`. Bila user memaksa `branchId` di query
  string di luar cakupannya, hasilnya **kosong** (bukan mengembalikan
  semua data) — lihat `resolveEffectiveBranchIds()` di setiap service.
- Posting dokumen (`postAdjustment`/`postOpname`) memvalidasi ulang bahwa
  `branchId` dokumen ada di `allowedBranchIds` pemanggil SEBELUM mengubah
  stok apa pun — diuji eksplisit di
  `tests/integration/inventory-branch-scope.test.ts`.
- Audit log (`recordAudit`) untuk posting Adjustment/Opname ditulis
  **memakai `tx` yang sama** dengan mutasi stoknya (bukan client Prisma
  terpisah) — diperbaiki dari pola Fase 03 yang sebelumnya bisa membuat
  audit log "yatim" bila ada langkah lain dalam transaction yang gagal.

## Hasil test & quality gate

| Gate | Hasil |
| --- | --- |
| Migration | ✅ Diterapkan bersih (`prisma migrate dev`) |
| `npm run lint` | ✅ 0 error (1 warning informational React Compiler, sudah ada sejak Fase 03) |
| `npm run typecheck` | ✅ |
| `npm run test` | ✅ **119/119** (27 test baru fase ini) |
| `npm run build` | ✅ 24 route |
| QA manual browser | ✅ saldo teragregasi benar, EXPIRED auto-sync tanpa job terpisah, adjustment & opname create→post mengubah stok+ledger dengan benar, Cashier (tanpa `inventory.adjust`) tidak melihat tombol create dan ditolak `/forbidden` saat akses URL langsung |

Test baru (27, tersebar di 3 file):

- `tests/integration/stock-ledger.test.ts` (14) — penambahan/pengurangan
  batch, saldo tidak boleh minus, penolakan output dari batch
  QUARANTINED/BLOCKED/DAMAGED/expired, pengecualian EXPIRED_WRITE_OFF/
  DAMAGED_WRITE_OFF, penggabungan batchNumber yang sama, penolakan ED
  berbeda pada batchNumber yang sama.
- `tests/integration/stock-documents.test.ts` (6) — posting adjustment
  IN/OUT menghasilkan movement & saldo benar, penolakan OUT melebihi
  saldo (dokumen tetap DRAFT, tidak ada movement), penolakan re-post
  dokumen POSTED, opname selisih kurang/lebih/nol.
- `tests/integration/inventory-branch-scope.test.ts` (7) —
  `getAllowedBranchIds` per role, isolasi cabang pada
  `listBatchesPaginated`/`listStockBalance`/`listMovementsPaginated`
  (termasuk saat `branchId` di luar akses dipaksakan lewat parameter),
  `postAdjustment` menolak dokumen di cabang di luar akses pemanggil.

## Catatan untuk fase berikutnya (POS/purchase receipt/transfer)

- `receiveStockToBatch` dan `deductStockFromBatch` (di
  `services/stock-ledger.ts`) adalah primitif yang dirancang untuk dipakai
  ulang oleh Purchase Receipt (IN), POS (OUT, dengan alokasi FEFO memilih
  batch mana yang di-`deductStockFromBatch`), dan Transfer (OUT di cabang
  asal + IN di cabang tujuan via `receiveStockToBatch`).
- Alokasi FEFO (memilih batch berdasar ED paling dekat) **belum**
  diimplementasikan fase ini — `deductStockFromBatch` menerima
  `stockBatchId` spesifik, pemanggil (fase POS nanti) yang bertanggung
  jawab memilih batch mana secara berurutan berdasar `expiryDate ASC`.
- `listSelectableBatches(branchId, productId)` sudah mengurutkan FEFO
  (`expiryDate ASC, receivedDate ASC`) dan hanya mengembalikan batch
  `AVAILABLE` dengan qty {'>'} 0 — siap dipakai sebagai titik awal logika
  alokasi FEFO POS.
