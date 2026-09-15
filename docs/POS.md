# Shift Kasir & POS — Fase 06 & Fase 07

Shift kasir (buka/tutup laci kas, mutasi kas manual) dan transaksi
penjualan (pencarian produk, keranjang, split payment, invoice) dengan
**alokasi batch FEFO & pengurangan stok riil** (Fase 07). Tidak ada resep,
transfer antar-cabang, retur, atau void penuh di kedua fase ini (hanya
nilai enum placeholder untuk `PosTransaction.status` yang benar-benar
dibutuhkan skema) — lihat [docs/INVENTORY.md](INVENTORY.md) dan
[docs/PURCHASING.md](PURCHASING.md) untuk fondasi stok/dokumen yang dipakai
ulang di fase-fase ini.

## Keputusan desain utama (Fase 06, direvisi Fase 07)

### 1. Stok: alokasi FEFO & pengurangan stok riil (Fase 07)

> **Fase 06** sengaja HANYA memvalidasi ketersediaan tanpa memotong stok
> sama sekali (lihat riwayat git/README versi lama) — placeholder yang
> secara eksplisit direncanakan untuk diselesaikan di sini. **Fase 07
> menggantikan validasi itu dengan alokasi FEFO + pengurangan stok riil.**

Setiap `PosTransaction` `PAID` sekarang benar-benar memotong stok: untuk
tiap `PosTransactionItem`, `services/stock-batch-service.ts::planFefoAllocation`
memilih batch — `status = AVAILABLE`, `qtyOnHand > 0`,
`expiryDate >= waktu transaksi` — diurutkan `expiryDate ASC, receivedDate
ASC, createdAt ASC`, lalu mengambil qty berurutan dari batch teratas
sampai kebutuhan item terpenuhi (bisa lintas beberapa batch sekaligus bila
satu batch tidak cukup). Fungsi ini **read-only** — tidak memutasi apa pun;
eksekusinya (`services/pos-transaction-service.ts::createPaidTransaction`)
memanggil primitif Fase 04 yang sudah ada,
`services/stock-ledger.ts::deductStockFromBatch`, untuk tiap baris rencana:
primitif ini atomic (update SQL tunggal `WHERE qtyOnHand >= qty`, lihat
docs/INVENTORY.md), menegakkan ulang aturan AVAILABLE/belum-expired, dan
membuat `StockMovement` `POS_SALE`. Setiap baris rencana JUGA menghasilkan
satu baris `PosTransactionItemBatchAllocation` — traceability wajib untuk
audit/recall, menyimpan SALINAN (snapshot) `batchNumber`/`expiryDate`/
`unitCost` batch pada saat penjualan, bukan hanya FK hidup.

Bila total qty batch eligible untuk suatu item tidak mencukupi,
`planFefoAllocation` melempar error — dan karena SELURUH proses (header,
item, payment, alokasi, movement) berada dalam **satu**
`prisma.$transaction`, kegagalan di titik mana pun (termasuk item
terakhir dari banyak item) membatalkan semuanya: tidak ada dokumen/
movement/alokasi yang tersisa parsial. Ini persis pola yang sudah dipakai
`services/purchase-receipt-service.ts::postReceipt` untuk sisi masuk,
diterapkan di sini untuk sisi keluar.

**Concurrency**: dua transaksi yang berebut batch yang sama diselesaikan
oleh row-lock `UPDATE` di `deductStockFromBatch` — yang kalah mendapati
`WHERE qtyOnHand >= qty` bernilai salah (baris ter-update oleh yang menang
lebih dulu) dan gagal bersih, tidak pernah menghasilkan saldo negatif.
Diverifikasi dengan test dua `createPaidTransaction` konkuren memperebutkan
satu batch (lihat bagian Test).

**Perbaikan atomicity penomoran invoice.** Nomor invoice awalnya (rancangan
Fase 06/di awal Fase 07) dihitung dengan `COUNT(*)+1` di dalam `tx` yang
sama dengan seluruh alokasi FEFO. Ini punya bug laten: bila terjadi
tabrakan `documentNumber` (dua transaksi konkuren menghitung nomor yang
sama), Postgres MENGABORT transaction yang kalah — percobaan ulang lewat
`tx` yang SAMA (pola retry `lib/document-number.ts::createWithSequentialNumber`,
yang aman untuk dokumen yang dibuat DI LUAR `$transaction` besar seperti
Purchase Receipt) akan gagal lagi dengan error "current transaction is
aborted", BUKAN retry yang bersih. Diperbaiki dengan dua perubahan: (1)
nomor dihitung dari `MAX` nomor urut yang sudah ada (bukan `COUNT`, yang
bisa salah bila ada gap), dan (2) retry dilakukan di level
`prisma.$transaction` PALING LUAR (`retryOnDocumentNumberCollision`) —
setiap percobaan ulang benar-benar memulai transaction/koneksi baru yang
bersih, bukan melanjutkan transaction yang sudah ter-abort. Terungkap &
diperbaiki saat menulis test konkurensi Fase 07 ini.

### 2. Transaksi hanya dibuat langsung berstatus PAID (atomic)

Keranjang berada di state React sisi klien (tidak disimpan sebagai baris
DRAFT). `PosTransactionStatus` menyimpan nilai placeholder tambahan sesuai
kebutuhan skema (`DRAFT`, `PENDING_PRESCRIPTION_REVIEW`, `CANCELLED`,
`VOIDED`, `PARTIALLY_RETURNED`, `RETURNED`), tapi satu-satunya jalur yang
dipakai UI kedua fase ini adalah
`services/pos-transaction-service.ts::createPaidTransaction`, yang membuat
header + item + payment + alokasi FEFO dalam **satu** `prisma.$transaction`
langsung berstatus `PAID`. Nilai-nilai lain disiapkan untuk fitur resep/
tahan-transaksi/void/retur di fase mendatang — belum ada service/UI yang
membuat baris berstatus itu pada fase mana pun sampai saat ini.

### 3. Split payment & kembalian

Metode non-tunai (`QRIS`, `BANK_TRANSFER`, `DEBIT_CARD`, `E_WALLET`) tidak
pernah menghasilkan kembalian, sehingga jumlahnya tidak boleh melebihi
`totalAmount`. `CASH` boleh ditender lebih besar dari sisa tagihan;
kelebihannya menjadi `changeAmount`. Validasi & perhitungan murni ada di
`services/pos-payment-calc.ts::validatePayments` (diuji tanpa database di
`tests/unit/pos-payment-calc.test.ts`):

1. `nonCashTotal` tidak boleh melebihi `totalAmount`.
2. `remainingAfterNonCash = totalAmount - nonCashTotal`.
3. `cashTotal` harus `>= remainingAfterNonCash` (kalau tidak, "Total
   pembayaran kurang dari total transaksi").
4. `changeAmount = cashTotal - remainingAfterNonCash`.

### 4. Variance kas & approval saat tutup shift

```
expectedCash = openingCash + netCashSales + cashIn − cashRefunds − cashOut
```

- `netCashSales` = jumlah pembayaran `CASH` pada transaksi `PAID` di shift
  tsb, dikurangi total `changeAmount` (kembalian selalu berasal dari uang
  tunai).
- `cashRefunds` **selalu 0 pada fase ini** (belum ada retur) — suku ini
  tetap ada di rumus (`services/cashier-shift-calc.ts::computeExpectedCash`)
  supaya Fase retur tinggal mengisi nilainya tanpa mengubah rumus.
- `variance = actualCash − expectedCash`.
- Bila `|variance|` melebihi `AppSetting["CASH_VARIANCE_THRESHOLD"]`
  (sudah di-seed nilai 10000, lihat `prisma/seed.ts`), shift menjadi
  `PENDING_APPROVAL`; kalau tidak, langsung `CLOSED`. Threshold yang
  dipakai disimpan sebagai snapshot (`CashierShift.varianceThreshold`)
  supaya histori tetap akurat walau nilai `AppSetting` berubah di kemudian
  hari. Bila `AppSetting` belum diisi sama sekali, shift langsung `CLOSED`
  (dianggap "selalu lolos", bukan "selalu perlu approval").
- Persetujuan `PENDING_APPROVAL → CLOSED` (`approveShift`) sengaja
  dibatasi ke role `OWNER`/`BRANCH_MANAGER` lewat pengecekan role langsung
  (bukan permission baru di matrix, dan divalidasi ULANG di service, bukan
  hanya di Server Action) — kasir pemilik shift tidak boleh menyetujui
  selisih kasnya sendiri.

Perhitungan murni (`computeExpectedCash`, `computeVariance`,
`decideShiftStatus`) dipisah ke `services/cashier-shift-calc.ts` — pola
yang sama dengan pemisahan `lib/rbac-core.ts` (murni) vs `lib/rbac.ts`
(butuh I/O Next.js) — supaya bisa diuji tanpa database (lihat
`tests/unit/cashier-shift-calc.test.ts`).

### 5. Satu user hanya boleh satu shift OPEN (lintas cabang)

"Terminal" pada spesifikasi disederhanakan menjadi user itu sendiri — MVP
ini belum punya model Terminal fisik terpisah. Beberapa kasir boleh sama-
sama punya shift OPEN di cabang yang sama (kasir berbeda, mis. dua meja
kasir), tapi **satu user** tidak boleh membuka shift baru selama masih
punya satu yang OPEN (di cabang mana pun). Ditegakkan dua lapis:

1. **Aplikasi**: `openShift` melakukan pre-check (`getOpenShiftForUser`)
   sebelum insert, memberi pesan error yang jelas.
2. **Database**: partial unique index
   `CREATE UNIQUE INDEX ... ON "CashierShift"("userId") WHERE status =
   'OPEN'` ditambahkan manual di migration
   `20260910033643_phase6_pos_cashier_shift` (Prisma schema DSL tidak
   mendukung partial/filtered unique index) sebagai jaring pengaman
   konkurensi — analog dengan pendekatan atomic-update pada
   `services/stock-ledger.ts` (lihat docs/INVENTORY.md), hanya diterapkan
   pada constraint keberadaan baris, bukan pada aritmetika saldo.

### 6. Penjualan hanya dalam base unit produk

Belum ada pemilihan satuan jual (mis. Strip/Box) di POS — tidak diminta
pada daftar fitur `/pos` fase ini. `PosTransactionItem.unitPrice` selalu
harga per base unit produk. Kandidat fase lanjutan bila dibutuhkan.

### 7. Harga override cabang menghormati `effectiveDate`

`ProductBranchPrice` dipakai hanya bila `isActive` **dan** (`effectiveDate`
kosong **atau** sudah lewat) — kalau tidak, jatuh ke
`Product.defaultSellingPrice`. Ini memenuhi komentar skema Fase 03 yang
menyebut penerapan `effectiveDate` "ada di fase berikutnya" — POS adalah
fase itu.

### 8. Harga selalu di-resolve ulang di server

Cart di klien hanya mengirim `productId`, `qty`, `discountAmount` per
item, dan `notes` — **tidak pernah** harga. `createPaidTransaction`
me-resolve `unitPrice` server-side untuk setiap baris
(`resolveSellingPrice`), konsisten dengan prinsip proyek "otorisasi & data
integrity di server" (lihat docs/AUTH.md).

### 9. Override batch manual — disiapkan, TIDAK aktif untuk kasir normal (Fase 07)

`services/pos-transaction-service.ts::createPaidTransactionWithBatchOverride`
adalah entry point INTERNAL terpisah, berbagi validasi header/harga/
diskon/pembayaran yang sama dengan `createPaidTransaction`
(`prepareTransaction`), tapi menerima `manualAllocations: Record<itemIndex,
{stockBatchId, qty}[]>` — pilihan batch manual per item, menggantikan
`planFefoAllocation` untuk item tsb. Override HANYA memilih *batch mana*
yang dipakai; validasi kelayakan batch tetap ditegakkan penuh
(`planManualAllocation`: batch harus milik cabang+produk yang sama,
berstatus `AVAILABLE`, belum lewat ED, total qty pilihan harus PERSIS sama
dengan qty item) dan deduksinya tetap lewat `deductStockFromBatch` yang
sama (atomic, menolak batch yang sebenarnya tidak layak). Digerbangi
permission `inventory.adjust` (dicek lewat `hasPermission`, bukan
permission baru di matrix) dan mewajibkan `overrideReason` non-kosong,
dicatat sebagai `AuditLog` (`action: "PAY_WITH_BATCH_OVERRIDE"`, field
`reason` terisi).

**Tidak dipanggil dari `app/(app)/pos/actions.ts` atau halaman mana pun** —
kasir normal SELALU memakai FEFO otomatis lewat `createPaidTransaction`.
Ini murni "interface internal yang disiapkan" sesuai instruksi fase ini:
fungsinya ada, teruji (lihat bagian Test), tapi belum ada UI admin yang
memanggilnya — kandidat halaman `/inventory/*` di fase mendatang bila
dibutuhkan (mis. koreksi kasus khusus gudang).

## RBAC & isolasi cabang

- `shift.manage` (OWNER, BRANCH_MANAGER, CASHIER — matrix Fase 02, tidak
  berubah): buka/tutup shift, catat mutasi kas.
- `pos.sell` (OWNER, BRANCH_MANAGER, PHARMACIST, CASHIER — tidak berubah):
  akses `/pos` dan `/pos/transactions` (termasuk bagian internal "Alokasi
  Batch Keluar" pada detail transaksi — tidak menambah eksposur baru,
  karena role yang sama sudah bisa melihat `unitCost` batch lewat
  `/inventory/batches` via `inventory.read`, yang juga dimiliki `CASHIER`).
- Approve shift `PENDING_APPROVAL`: role `OWNER`/`BRANCH_MANAGER` langsung
  (lihat poin 4).
- Override batch manual: permission `inventory.adjust` (lihat poin 9).
- Semua service (`cashier-shift-service.ts`, `pos-transaction-service.ts`)
  menerima `allowedBranchIds` (dihitung server-side lewat
  `getAllowedBranchIds()`) dan memvalidasi ulang branchId dokumen/shift ada
  di dalamnya SEBELUM membaca/mengubah apa pun — pola yang sama dengan
  Fase 04/05.
- `createPaidTransaction` **mengambil `branchId` dari shift itu sendiri**,
  bukan dari input client — mencegah transaksi tercatat di cabang yang
  berbeda dari shift yang benar-benar dipakai. Ia juga memvalidasi
  `shift.userId === createdById` — seorang kasir hanya boleh bertransaksi
  memakai shift miliknya sendiri.

## UI: traceability batch keluar

`app/(app)/pos/transactions/[id]/page.tsx` menampilkan bagian "Alokasi
Batch Keluar (Internal)" read-only di bawah invoice cetak, dibungkus
`print:hidden` (tidak ikut tercetak ke struk customer) — per item, per
baris alokasi: no. batch, ED, qty keluar, harga pokok (semua dari kolom
snapshot `PosTransactionItemBatchAllocation`, bukan query hidup ke
`StockBatch`).

## Hasil test & quality gate

| Gate | Hasil |
| --- | --- |
| Migration Fase 06 | ✅ `20260910033643_phase6_pos_cashier_shift` |
| Migration Fase 07 | ✅ `20260910062012_phase7_fefo_batch_allocation` |
| `npm run lint` | ✅ 0 error |
| `npm run typecheck` | ✅ |
| `npm run test` | ✅ **170/170** |
| `npm run build` | ✅ 32 route |

Cakupan test Fase 07 (di `tests/integration/pos-transaction-service.test.ts`,
setiap test alokasi FEFO memakai produk & batch KHUSUS test tsb sendiri —
lihat `createFefoTestProduct` — supaya tidak ada batch dari test lain yang
ikut terlihat oleh `planFefoAllocation` dan merusak presisi asersi):

- FEFO memilih batch ber-ED terdekat yang eligible (satu batch cukup).
- Batch yang sudah lewat ED tidak teralokasi WALAU `status` masih
  `AVAILABLE` (dibuat langsung via `prisma.stockBatch.create`, bukan
  `receiveStockToBatch`, supaya bisa dikontrol persis).
- Batch `BLOCKED`/`QUARANTINED`/`DAMAGED`/qty nol tidak teralokasi (empat
  kondisi diuji sekaligus, satu batch valid di antaranya berhasil
  dialokasikan penuh).
- Qty yang melebihi batch pertama terpecah ke batch berikutnya sesuai
  urutan FEFO (2 baris alokasi, 2 `StockMovement`).
- Allocation menyimpan snapshot `batchNumber`/`expiryDate`/`qtyOut`/
  `unitCost` yang cocok persis dengan batch sumbernya.
- Stok tidak cukup → transaksi/payment/movement/allocation TIDAK ada sama
  sekali yang tersisa (dihitung sebelum-sesudah: jumlah `PosTransaction`
  & `StockMovement` tidak berubah, `qtyOnHand` batch tidak berubah).
- Dua `createPaidTransaction` konkuren memperebutkan satu batch (qty cukup
  untuk satu, tidak cukup untuk keduanya) — tepat satu berhasil, satu
  ditolak bersih dengan pesan "tidak mencukupi", saldo akhir tepat
  (`original - qty pemenang`, tidak pernah negatif/dobel-potong).
- Override batch manual: ditolak tanpa permission `inventory.adjust`,
  ditolak dengan alasan kosong, dan jalur sukses mengalokasikan ke batch
  yang dipilih manual (BUKAN batch FEFO-terdekat) + mencatat `AuditLog`
  dengan alasannya.
- Seluruh cakupan Fase 06 yang masih relevan (shift harus OPEN & milik
  pemanggil, isolasi cabang, split payment, nomor invoice unik) tetap
  lulus dengan stok sungguhan yang kini benar-benar berkurang.

## Contoh data dari QA manual (Fase 06)

QA manual Fase 06 sempat meninggalkan `CashierShift`/`PosTransaction` di
database dev yang TIDAK memiliki alokasi batch (dibuat sebelum Fase 07
ada) — dibersihkan lewat skrip sekali-pakai sebelum QA manual Fase 07,
supaya tidak ada data yang melanggar invarian baru "setiap item PAID
punya ≥1 alokasi batch". QA manual Fase 07 (lihat laporan implementasi)
menghasilkan data baru yang SESUAI invarian tsb.
