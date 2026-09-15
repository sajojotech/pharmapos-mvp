# Aturan Bisnis Inti — Referensi Konsolidasi (Fase 11)

Dokumen ini **merangkum** aturan bisnis kritis yang tersebar di
`docs/INVENTORY.md`, `docs/POS.md`, `docs/TRANSFER.md`,
`docs/PRESCRIPTION_VOID_RETURN.md`, `docs/PURCHASING.md`, dan
`docs/AUTH.md` menjadi satu referensi cepat. **Bukan pengganti** —
dokumen per-fase tetap sumber kebenaran untuk konteks/alasan desain
lengkap; dokumen ini untuk "aturan apa yang berlaku" secara ringkas dan
mudah dicari, terutama sebelum menyentuh kode `services/*.ts`.

## 1. Batch & ED (Expiry Date)

- Satu batch fisik = satu baris `StockBatch` (unique
  `branchId+productId+batchNumber`). Menerima ulang dengan nomor batch
  yang SAMA **menambah** batch yang sama (bukan duplikat), KECUALI ED
  yang dikirim berbeda dari ED batch yang sudah ada → ditolak (mencegah
  dua lot berbeda tergabung akibat salah ketik nomor batch).
- Status batch: `AVAILABLE`, `QUARANTINED`, `BLOCKED`, `EXPIRED`,
  `DAMAGED`. Hanya `AVAILABLE` yang bisa keluar untuk transaksi normal
  (POS, transfer, adjustment OUT, opname) — dan HANYA bila `expiryDate`
  belum lewat, dicek langsung terhadap tanggal (bukan hanya field
  `status`, supaya tetap benar walau sinkronisasi belum sempat jalan).
- `syncExpiredBatchStatus(companyId)` menyinkronkan `AVAILABLE` →
  `EXPIRED` berdasar ED, dipanggil di server di awal setiap query listing
  batch — tidak ada cron job terpisah.
- Pengecualian TUNGGAL: `EXPIRED_WRITE_OFF` (butuh batch `EXPIRED` atau
  ED lewat) dan `DAMAGED_WRITE_OFF` (butuh batch `DAMAGED`) — satu-satunya
  jalan resmi mengeluarkan stok dari batch bermasalah.
- Detail lengkap: [docs/INVENTORY.md](INVENTORY.md).

## 2. FEFO (First-Expired-First-Out)

- `services/stock-batch-service.ts::planFefoAllocation` memilih batch
  `AVAILABLE`, qty {'>'} 0, ED ≥ `asOf`, diurutkan
  `expiryDate ASC, receivedDate ASC, createdAt ASC` — mengambil qty
  berurutan dari batch teratas sampai kebutuhan terpenuhi. Bisa
  menghasilkan BANYAK baris alokasi bila satu batch tidak cukup.
- FUNGSI INI READ-ONLY — tidak memotong stok sama sekali. Pemanggil
  (`allocateFefoForItems` di `services/pos-transaction-service.ts`)
  mengeksekusi tiap baris rencana lewat `deductStockFromBatch` (atomic)
  DI DALAM `$transaction` yang sama — bila stok berkurang di tengah jalan
  (race concurrent), eksekusi gagal bersih di titik itu dan SELURUH
  transaksi rollback (tidak ada alokasi parsial).
- Override manual (`createPaidTransactionWithBatchOverride`,
  `planManualAllocation`) memvalidasi batch yang dipilih user tetap harus
  `AVAILABLE`+belum-ED+qty cukup — override memilih BATCH MANA, bukan
  mengizinkan batch yang tidak eligible.
- Detail lengkap: [docs/POS.md](POS.md).

## 3. Stok Keluar & Stock Ledger (atomicity)

- **Primitif tunggal untuk pengurangan stok**:
  `services/stock-ledger.ts::deductStockFromBatch` — SATU statement SQL
  atomic `UPDATE ... SET qtyOnHand = qtyOnHand - $qty WHERE id=$id AND
  qtyOnHand >= $qty`. Ini adalah compare-and-swap di level database:
  tidak mungkin dua request bersamaan sama-sama lolos validasi padahal
  gabungannya melebihi saldo. **Tidak ada jalur kode lain** yang boleh
  mengubah `StockBatch.qtyOnHand` secara langsung (baca-lalu-tulis) —
  diaudit eksplisit Fase 11, lihat docs/REPORTS.md tidak relevan di sini,
  cukup lihat catatan hardening di bawah.
- Primitif tunggal untuk penambahan: `receiveStockToBatch` (find-or-create
  by batchNumber) dan `receiveStockToExistingBatch` (batch sudah dipilih
  eksplisit) — dipakai bergantian oleh Purchase Receipt, Transfer masuk,
  Retur SELLABLE/DAMAGED/QUARANTINE, Adjustment/Opname arah IN, dan void
  (`VOID_REVERSAL`).
- **Setiap** mutasi `qtyOnHand` WAJIB disertai TEPAT SATU baris
  `StockMovement` (`balanceAfter` = saldo setelah mutasi) — ditulis dalam
  transaction yang sama, tidak pernah terpisah.
- Dokumen multi-item (Purchase Receipt post, Adjustment post, Opname
  post, Transfer ship/receive, POS pay, void, retur) SELALU dibungkus
  `prisma.$transaction(...)` — gagal di item mana pun membatalkan
  SELURUH dokumen (all-or-nothing), tidak ada state parsial.
- **Isolasi cabang/company pada ITEM dokumen** (bukan cuma header):
  setiap `stockBatchId` yang direferensikan item Adjustment/Opname/
  Transfer WAJIB divalidasi milik `branchId`+`companyId` dokumen tsb
  SEBELUM dokumen dibuat — diperbaiki Fase 11 hardening (sebelumnya
  Adjustment/Opname tidak menegakkan ini; Transfer sudah benar sejak
  Fase 08, jadi jadi pola rujukan perbaikannya).
- Detail lengkap: [docs/INVENTORY.md](INVENTORY.md) bagian "Pendekatan
  race condition/concurrency".

## 4. Retur Penjualan

- Retur mengacu ke `PosTransactionItemBatchAllocation` ASAL (bukan cuma
  item) — satu item yang dulu di-split FEFO ke >1 batch bisa
  menghasilkan >1 baris retur, masing-masing ke alokasi asalnya.
- Sisa returnable dihitung PER ALOKASI: `qtyOut` alokasi dikurangi TOTAL
  `qtyReturned` dari SEMUA retur sebelumnya terhadap alokasi itu (bukan
  hanya retur kali ini) — melebihi sisa berarti SELURUH retur ditolak
  (atomic, tidak ada retur parsial yang "sebagian berhasil").
- Kondisi barang menentukan tujuan stok:
  - `SELLABLE` → kembali ke batch ASAL apa adanya.
  - `DAMAGED`/`QUARANTINE` → batch SEGREGASI terpisah
    (`<batchNumberSnapshot>-RETURN-<condition>`, status `DAMAGED`/
    `QUARANTINED`) — SENGAJA tidak menambah stok yang bisa dijual.
- Status transaksi induk dihitung ulang dari AGREGAT seluruh retur
  historis vs qty asli tiap item → `PARTIALLY_RETURNED` atau `RETURNED`.
- Detail lengkap: [docs/PRESCRIPTION_VOID_RETURN.md](PRESCRIPTION_VOID_RETURN.md).

## 5. Void

- Hanya transaksi berstatus **PAID** persis yang boleh di-void (menolak
  VOIDED/CANCELLED/PARTIALLY_RETURNED/RETURNED — mencegah void-ulang &
  void pasca-retur).
- Permission `pos.void` (OWNER/BRANCH_MANAGER) dicek ULANG di service
  (bukan hanya action layer) — pola sama pemeriksaan elevated-privilege
  lain.
- Qty dikembalikan TEPAT ke MASING-MASING batch alokasi asal (bukan FEFO
  baru) lewat `receiveStockToExistingBatch` + `movementType:
  "VOID_REVERSAL"` — satu movement per baris alokasi.
- `Payment.isReversed=true` untuk semua payment transaksi (baris asli
  TIDAK dihapus/diedit — fakta finansial historis tetap utuh).
- Detail lengkap: [docs/PRESCRIPTION_VOID_RETURN.md](PRESCRIPTION_VOID_RETURN.md).

## 6. Transfer Antar-Cabang

- State machine: `DRAFT → REQUESTED → APPROVED/REJECTED → SHIPPED →
  RECEIVED/PARTIALLY_RECEIVED`, plus `CANCELLED` (hanya sebelum SHIPPED
  — setelah dikirim, stok sudah berpindah fisik, tidak ada pembatalan).
- Batch dipilih MANUAL saat DRAFT (bukan FEFO otomatis) — staf gudang
  yang tahu fisik lot mana yang dikirim; snapshot batchNumber/ED/unitCost
  diambil saat item dibuat.
- SHIP = `deductStockFromBatch` (movementType `TRANSFER_OUT`) di cabang
  asal; RECEIVE = `receiveStockToBatch` (movementType `TRANSFER_IN`) di
  cabang tujuan — dua primitif Fase 04 yang sama dipakai POS/Purchase
  Receipt, bukan primitif baru.
- Tidak ada model "stok in-transit" terpisah — antara SHIPPED dan
  RECEIVED, qty sudah keluar dari batch asal tapi belum masuk batch
  tujuan; status dokumen `SHIPPED` + `StockMovement TRANSFER_OUT` ITU
  SENDIRI adalah catatan resmi "sedang dalam perjalanan" (disengaja,
  lihat docs/TRANSFER.md poin 4).
- Detail lengkap: [docs/TRANSFER.md](TRANSFER.md).

## 7. Purchase Receipt

- `DRAFT` → `POSTED` (immutable setelah posted — tidak ada edit, koreksi
  lewat dokumen baru). Posting = konversi qty/harga ke base unit produk
  (via `ProductUnitConversion`) lalu `receiveStockToBatch` per item,
  seluruhnya dalam satu `$transaction`.
- ED wajib > tanggal penerimaan; qty/harga tidak boleh negatif; produk
  yang sudah nonaktif menolak posting (tidak hanya create draft).
- `productId`/`unitId`/`supplierId` item WAJIB divalidasi milik
  `companyId` dokumen SEBELUM draft dibuat (Fase 11 hardening — lihat
  `assertReceiptReferencesBelongToCompany` di
  `services/purchase-receipt-service.ts`).
- Detail lengkap: [docs/PURCHASING.md](PURCHASING.md).

## 8. RBAC & Isolasi Cabang/Company

- Permission adalah KAPABILITAS BISNIS (`master.read`, `inventory.adjust`,
  `pos.sell`, `pos.void`, `prescription.review`, `shift.manage`,
  `transfer.manage`, `report.read.branch`, `report.read.all`,
  `user.manage`, `audit.read`, dst — lihat `lib/permissions.ts`), bukan
  satu permission per halaman — matrix lengkap di
  [docs/AUTH.md](AUTH.md).
- Role global (`OWNER`, `CENTRAL_ADMIN`, `FINANCE_AUDITOR`) otomatis
  akses SELURUH cabang aktif company via `getAllowedBranchIds` — TIDAK
  bergantung baris `UserBranchAssignment`. Role lain HANYA cabang yang
  ditugaskan.
- **Setiap** service query/mutasi branch-scoped menerima
  `allowedBranchIds` yang dihitung SERVER-SIDE (dari session, lewat
  `getAllowedBranchIds(user)`) — TIDAK PERNAH memercayai `branchId` yang
  dikirim client untuk MENENTUKAN scope akses (hanya boleh dipakai untuk
  MEMPERSEMPIT hasil DI DALAM scope yang sudah diizinkan). Bila
  `branchId` yang diminta di luar `allowedBranchIds`, hasilnya KOSONG,
  bukan mengembalikan semua data.
- Detail halaman `[id]` (invoice/shift/transfer/dst): fetch WAJIB lewat
  `findFirst({where:{id, branchId:{in:allowedBranchIds}}})` (atau
  `companyId` untuk entitas company-scoped-non-branch seperti Product),
  BUKAN `findUnique({where:{id}})` — mencegah IDOR (user menebak/menaikkan
  ID di URL untuk melihat data cabang/company lain).
- Detail lengkap: [docs/AUTH.md](AUTH.md).

## Catatan Fase 11 (hardening) — perubahan aturan yang perlu diketahui

Ditemukan lewat audit menyeluruh (bukan perubahan fitur, murni
penegakan aturan yang sudah ada di atas secara konsisten):

1. `listAvailableBatchesForBranch` sekarang WAJIB `companyId` (dulu
   hanya `branchId`, celah cross-company bila pemanggil lupa validasi
   di lapisan atas).
2. `createDraftAdjustment`/`createDraftOpname` sekarang memvalidasi
   setiap `stockBatchId` item milik `branchId`+`companyId` dokumen
   (dulu tidak divalidasi sama sekali — item bisa merujuk batch cabang
   lain walau header dokumen sudah branch-scoped dengan benar).
3. `ProductBranchPrice` (get/update/setActive by id) sekarang wajib
   scoped `productId` (dulu murni `findUnique({where:{id}})`).
4. Purchase Receipt sekarang memvalidasi `productId`/`supplierId` item
   milik `companyId` sebelum draft dibuat (dulu tidak divalidasi).
5. `computeNetCashSales` (rekonsiliasi kas shift) sekarang tetap
   menghitung transaksi `PARTIALLY_RETURNED`/`RETURNED` (dulu transaksi
   yang mendapat retur sebagian hilang TOTAL dari perhitungan kas, bukan
   hanya bagian yang diretur — bug rekonsiliasi kas yang signifikan).

Lihat laporan release-readiness (dibagikan terpisah di akhir Fase 11)
untuk daftar temuan lengkap beserta severity dan status perbaikan.
